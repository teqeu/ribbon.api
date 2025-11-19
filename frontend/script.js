const API_URL = "http://YOUR_LINUX_IP:3000"; // replace with your Linux Mint IP
const userIds = ["1270223423594954777", "1437696382155886713"]; // Discord user IDs to track

const container = document.getElementById("users-container");

// Render a user card
function renderUser(userId, data) {
  let card = document.getElementById(userId);
  if (!card) {
    card = document.createElement("div");
    card.className = "user-card";
    card.id = userId;
    container.appendChild(card);
  }

  const avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${data.avatarHash}.png`;
  const statusClass = `status-${data.status || "offline"}`;
  const customStatus = data.customStatus ? `${data.customStatus.emoji || ""} ${data.customStatus.text || ""}` : "";

  let activitiesHtml = "";
  data.activities.forEach(a => {
    let assetImg = a.assets?.largeImage
      ? `<img src="https://cdn.discordapp.com/app-assets/${a.applicationId}/${a.assets.largeImage}.png" alt="" width="50" />`
      : "";
    activitiesHtml += `<div class="activity">${assetImg} <strong>${a.name}</strong> - ${a.details || ""} ${a.state || ""}</div>`;
  });

  card.innerHTML = `
    <img src="${avatarUrl}" alt="${data.username}" />
    <h3>${data.username}#${data.discriminator}</h3>
    <p class="${statusClass}">${data.status.toUpperCase()}</p>
    <p>${customStatus}</p>
    ${activitiesHtml}
  `;
}

// Initial fetch
async function fetchUsers() {
  const res = await fetch(`${API_URL}/users?ids=${userIds.join(",")}`);
  const data = await res.json();
  for (const id of userIds) {
    if (data[id]) renderUser(id, data[id]);
  }
}

// WebSocket for live updates
const ws = new WebSocket(`ws://${API_URL.replace("http://","")}`);
ws.onmessage = (event) => {
  const { userId, data } = JSON.parse(event.data);
  if (userIds.includes(userId)) renderUser(userId, data);
};

// Refresh every 10 seconds as fallback
setInterval(fetchUsers, 10000);

// Initial load
fetchUsers();
