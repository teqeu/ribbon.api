const API_URL = "http://192.168.1.194:3000"; // Your server IP
const userIds = ["1270223423594954777", "1437696382155886713"]; // Users to track

const container = document.getElementById("users-container");

// Render a user card safely
function renderUser(userId, data) {
  let card = document.getElementById(userId);
  if (!card) {
    card = document.createElement("div");
    card.className = "user-card";
    card.id = userId;
    container.appendChild(card);
  }

  const avatarUrl = data.avatarHash
    ? `https://cdn.discordapp.com/avatars/${userId}/${data.avatarHash}.png`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;

  const status = data.status || "offline";
  const statusClass = `status-${status}`;

  const customStatus = data.customStatus
    ? `${data.customStatus.emoji || ""} ${data.customStatus.text || ""}`
    : "";

  let activitiesHtml = "";

  if (Array.isArray(data.activities) && data.activities.length > 0) {
    data.activities.forEach(a => {
      let assetImg = "";

      if (a.assets?.largeImage && a.applicationId) {
        assetImg = `
          <img 
            src="https://cdn.discordapp.com/app-assets/${a.applicationId}/${a.assets.largeImage}.png"
            alt=""
            width="50"
          />
        `;
      }

      activitiesHtml += `
        <div class="activity">
          ${assetImg}
          <strong>${a.name}</strong> 
          ${a.details || ""} 
          ${a.state || ""}
        </div>
      `;
    });
  } else {
    activitiesHtml = `<div class="activity none">No activities</div>`;
  }

  card.innerHTML = `
    <img src="${avatarUrl}" alt="${data.username}" />
    <h3>${data.username}#${data.discriminator}</h3>
    <p class="${statusClass}">${status.toUpperCase()}</p>
    <p>${customStatus}</p>
    ${activitiesHtml}
  `;
}

// Fetch users once
async function fetchUsers() {
  try {
    const res = await fetch(`${API_URL}/users?ids=${userIds.join(",")}`);
    const data = await res.json();

    userIds.forEach(id => {
      if (data[id]) renderUser(id, data[id]);
    });
  } catch (e) {
    console.log("Failed to load users");
  }
}

// WebSocket auto-connect
const ws = new WebSocket(`ws://${API_URL.split("://")[1]}`);

ws.onmessage = (event) => {
  const { userId, data } = JSON.parse(event.data);
  if (userIds.includes(userId)) renderUser(userId, data);
};

// Backup refresh every 10s
setInterval(fetchUsers, 10000);

// First load
fetchUsers();
