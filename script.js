const state = {
  token: localStorage.getItem("tct_token"),
  me: null,
  rooms: [],
  users: [],
  messages: [],
  privateMessages: [],
  permissions: {},
  rankBadges: {},
  currentRoom: "main",
  activeView: "chat",
  selectedPmUser: "",
  pendingAttachment: null,
};

const ranks = {
  user: "User",
  vip: "VIP",
  "s-vip": "S-VIP",
  premium: "Premium",
  moderator: "Moderator",
  admin: "Admin",
  visor: "Visor",
  superadmin: "Superadmin",
  "super visor": "Super Visor",
  chief: "Chief",
  developer: "Developer",
};
const rankOrder = Object.keys(ranks);
const adminPanelRanks = new Set(["admin", "chief", "developer"]);
const themes = ["dark", "amoled", "cyberpunk", "neon", "glass", "purple", "blue", "particles", "gradient", "image", "blur"];
const frames = ["clean", "gold", "diamond", "crown", "neon", "developer", "chief", "supervisor"];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch(path, { ...options, headers }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name) {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}

function rankClass(rank) {
  return String(rank || "user").replaceAll(" ", "-");
}

function canUseAdminPanel(user = state.me) {
  return user && adminPanelRanks.has(user.rank);
}

function canUseAnyFrame(user = state.me) {
  return ["premium", "chief", "super visor", "developer"].includes(user?.rank);
}

function canControl(targetRank) {
  if (!state.me) return false;
  if (state.me.rank === "developer") return targetRank !== "developer";
  if (state.me.rank === "chief") return rankOrder.indexOf(targetRank) < rankOrder.indexOf("chief");
  if (state.me.rank === "admin") return rankOrder.indexOf(targetRank) < rankOrder.indexOf("admin");
  return false;
}

function formatTime(value) {
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function levelInfo(xp = 0) {
  let level = 0;
  let needed = 10;
  let remaining = xp;
  while (remaining >= needed) {
    remaining -= needed;
    level += 1;
    needed += 10;
  }
  return { level, current: remaining, next: needed };
}

function userAvatar(user, size = "mini") {
  const cls = `${size}-avatar avatar-${user?.gender || "other"} frame-${user?.frame || "clean"}`;
  if (user?.avatar) return `<span class="${cls}" style="background-image:url('${user.avatar}')"></span>`;
  return `<span class="${cls}">${initials(user?.username)}</span>`;
}

function rankBadge(rank) {
  const badge = state.rankBadges?.[rank];
  if (badge) return `<span class="rank-badge rank-${rankClass(rank)}" style="--badge-color:${escapeHtml(badge.color)}">${escapeHtml(badge.label)}</span>`;
  return `<span class="rank-badge rank-${rankClass(rank)}">${ranks[rank] || rank}</span>`;
}

function withId(html, id) {
  return html.replace("<span ", `<span id="${id}" `);
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");
    if (!file.type.startsWith("image/")) return reject(new Error("Choose an image file."));
    if (file.size > 4_500_000) return reject(new Error("Image must be under 4.5 MB."));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

function buildDateSelects() {
  const day = $('[name="day"]');
  const month = $('[name="month"]');
  const year = $('[name="year"]');
  day.innerHTML = '<option value="">DD</option>' + Array.from({ length: 31 }, (_, i) => `<option>${String(i + 1).padStart(2, "0")}</option>`).join("");
  month.innerHTML = '<option value="">MM</option>' + Array.from({ length: 12 }, (_, i) => `<option>${String(i + 1).padStart(2, "0")}</option>`).join("");
  const current = new Date().getFullYear();
  year.innerHTML = '<option value="">YYYY</option>' + Array.from({ length: 90 }, (_, i) => `<option>${current - 13 - i}</option>`).join("");
}

function openApp() {
  $("#authView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
}

function openAuth() {
  $("#authView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
}

function setAuthMessage(text, bad = false) {
  $("#authMessage").textContent = text;
  $("#authMessage").classList.toggle("bad", bad);
}

function renderMe() {
  $("#topUsername").textContent = state.me.username;
  $("#topAvatar").outerHTML = withId(userAvatar(state.me, "mini"), "topAvatar");
  $("#menuAvatar").outerHTML = withId(userAvatar(state.me, "mini"), "menuAvatar");
  $("#menuUsername").textContent = state.me.username;
  $("#menuRank").outerHTML = withId(rankBadge(state.me.rank), "menuRank");
  $(".admin-only").classList.toggle("hidden", !canUseAdminPanel());
  renderProfileModal(state.me);
}

function renderRooms() {
  const allRooms = [...state.rooms.filter((room) => room.pinned), ...state.rooms.filter((room) => !room.pinned)];
  $("#roomList").innerHTML = allRooms.map((room) => `
    <button class="room-card-mini ${room.id === state.currentRoom ? "active" : ""}" data-room="${room.id}" type="button">
      <span class="room-thumb" style="background-image:url('${escapeHtml(room.image || "/assets/teen-chat-town-banner.png")}')">${room.icon}</span>
      <span><strong>${escapeHtml(room.name)}</strong><small>${escapeHtml(room.description)}</small></span>
      <em>${room.password ? "lock" : room.unread || 0}</em>
    </button>
  `).join("");

  $("#roomsGrid").innerHTML = allRooms.map((room) => `
    <article class="info-card room-tile hover-card" data-room="${room.id}">
      <div class="room-image" style="background-image:url('${escapeHtml(room.image || "/assets/teen-chat-town-banner.png")}')"></div>
      <h3>${escapeHtml(room.name)} ${room.password ? '<span class="lock-tag">Private</span>' : ""}</h3>
      <p>${escapeHtml(room.description)}</p>
      <div class="meta-row"><span>${room.online} online</span><span>${room.unread || 0} unread</span></div>
    </article>
  `).join("");

  $$("[data-room]").forEach((node) => node.addEventListener("click", () => switchRoom(node.dataset.room)));
}

function renderMessages() {
  const list = $("#messageList");
  const messages = state.messages.filter((message) => message.roomId === state.currentRoom);
  let previous = "";
  list.innerHTML = messages.map((message) => {
    const user = state.users.find((item) => item.id === message.userId) || { username: "Unknown", rank: "user", gender: "other" };
    const grouped = previous === message.userId;
    previous = message.userId;
    const own = state.me && message.userId === state.me.id;
    const attachment = message.attachment ? `<img class="message-image" src="${message.attachment.data}" alt="${escapeHtml(message.attachment.name)}" />` : "";
    return `
      <article class="message ${grouped ? "grouped" : ""}">
        ${grouped ? "<span></span>" : userAvatar(user, "mini")}
        <div class="message-body" style="--msg-text:${escapeHtml(user.textColor || "#ffffff")}">
          ${grouped ? "" : `<div class="message-meta"><strong class="name-${rankClass(user.rank)}" style="${user.usernameColor ? `color:${escapeHtml(user.usernameColor)}` : ""}">${escapeHtml(user.username)}</strong>${rankBadge(user.rank)}<time>${formatTime(message.createdAt)}</time></div>`}
          ${message.text ? `<p>${linkify(escapeHtml(message.text))}</p>` : ""}
          ${attachment}
          <div class="message-actions"><button>Reply</button><button>React</button>${own ? "<button>Edit</button><button>Delete</button>" : ""}</div>
        </div>
      </article>
    `;
  }).join("");
  list.scrollTop = list.scrollHeight;
}

function linkify(text) {
  return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function renderUsers() {
  const visible = [...state.users].sort((a, b) => Number(b.id === state.me.id) - Number(a.id === state.me.id));
  $("#onlineCount").textContent = `${visible.filter((user) => !user.banned).length} users`;
  $("#onlineUsers").innerHTML = `
    <div class="user-section-title">Online</div>
    ${visible.filter((user) => !user.banned).map(userRow).join("")}
    <div class="user-section-title">Offline</div>
    ${visible.filter((user) => user.banned).map(userRow).join("") || '<p class="hint">No offline users shown.</p>'}
  `;
  $$("[data-user]").forEach((node) => node.addEventListener("click", () => renderProfileModal(state.users.find((user) => user.id === node.dataset.user), true)));
  renderPmUsers();
}

function userRow(user) {
  return `
    <button class="user-row" data-user="${user.id}" type="button">
      <span class="status-dot ${user.banned ? "offline" : ""}"></span>
      ${userAvatar(user, "mini")}
      <span><strong class="name-${rankClass(user.rank)}">${escapeHtml(user.username)}</strong><small>${ranks[user.rank] || user.rank}</small></span>
    </button>
  `;
}

function renderProfileModal(user = state.me, open = false) {
  if (!user) return;
  $("#modalAvatar").outerHTML = withId(userAvatar(user, "large"), "modalAvatar");
  $("#modalRank").outerHTML = withId(rankBadge(user.rank), "modalRank");
  $("#modalName").textContent = user.username;
  $("#modalBio").textContent = user.bio || "New to Teen Chat Town.";
  $("#modalGold").textContent = `${user.gold || 0} Gold`;
  $("#modalDiamonds").textContent = `${user.diamonds || 0} Diamonds`;
  $("#profileEditForm").username.value = user.id === state.me.id ? user.username : "";
  $("#profileEditForm").bio.value = user.id === state.me.id ? user.bio || "" : "";
  $("#profileEditForm").aboutMe.value = user.id === state.me.id ? user.aboutMe || "" : "";
  $("#profileEditForm").mood.value = user.id === state.me.id ? user.mood || "" : "";
  $("#profileEditForm").usernameColor.value = user.id === state.me.id ? user.usernameColor || "" : "";
  $("#profileEditForm").textColor.value = user.id === state.me.id ? user.textColor || "" : "";
  $("#cancelDeleteButton").classList.toggle("hidden", !state.me.deleteRequestedAt);
  if (open) $("#profileModal").showModal();
}

function renderLeaderboards() {
  const groups = [["Top XP", "xp"], ["Top Gold", "gold"], ["Top Diamonds", "diamonds"]];
  $("#leaderboards").innerHTML = groups.map(([title, key]) => {
    const rows = [...state.users].sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, 8);
    return `<article class="panel"><h3>${title}</h3>${rows.map((user, index) => `<div class="leader-row"><span>${index + 1}</span><strong>${escapeHtml(user.username)}</strong><em>${user[key] || 0}</em></div>`).join("")}</article>`;
  }).join("");
}

function renderMarketplace() {
  const items = [
    ["Username color", "VIP and S-VIP can buy this with gold.", "250 gold"],
    ["Profile frame", "Premium, chief, super visor, and developer can use any frame.", "12 diamonds"],
    ["Room image pack", "Make your created rooms more catchy.", "80 gold"],
    ["Animated name", "Premium rainbow name effect.", "30 diamonds"],
  ];
  $("#marketplaceGrid").innerHTML = items.map(([name, text, price]) => `<article class="info-card hover-card"><h3>${name}</h3><p>${text}</p><button>${price}</button></article>`).join("");
}

function renderSettings() {
  $("#themeGrid").innerHTML = themes.map((theme) => `<button class="theme-tile" data-theme="${theme}" type="button">${theme}</button>`).join("");
  $("#frameGrid").innerHTML = frames.map((frame) => `<button class="frame-choice frame-${frame}" data-frame="${frame}" type="button"><span></span>${frame}</button>`).join("");
  $("#profileFrameSelect").innerHTML = frames.map((frame) => `<option value="${frame}">${frame}</option>`).join("");
  $$("[data-theme]").forEach((button) => button.addEventListener("click", () => document.body.dataset.theme = button.dataset.theme));
  $$("[data-accent]").forEach((button) => button.addEventListener("click", () => document.documentElement.style.setProperty("--accent", button.dataset.accent)));
  $$("[data-frame]").forEach((button) => button.addEventListener("click", () => {
    if (!canUseAnyFrame() && !["clean", "gold"].includes(button.dataset.frame)) return alert("Premium, chief, super visor, and developer can select any frame.");
    saveProfile({ frame: button.dataset.frame });
  }));
}

function renderPmUsers() {
  $("#pmUserList").innerHTML = state.users.filter((user) => user.id !== state.me.id).map((user) => `
    <button class="user-row" data-pm-user="${user.id}" type="button">${userAvatar(user, "mini")}<span><strong>${escapeHtml(user.username)}</strong><small>${ranks[user.rank]}</small></span></button>
  `).join("") || '<p class="hint">No users yet.</p>';
  $$("[data-pm-user]").forEach((button) => button.addEventListener("click", () => {
    state.selectedPmUser = button.dataset.pmUser;
    renderPmThread();
  }));
}

function renderPmThread() {
  const target = state.users.find((user) => user.id === state.selectedPmUser);
  $("#pmTitle").textContent = target ? `PM with ${target.username}` : "Select a user";
  const messages = state.privateMessages.filter((message) =>
    (message.fromId === state.me.id && message.toId === state.selectedPmUser) ||
    (message.toId === state.me.id && message.fromId === state.selectedPmUser)
  );
  $("#pmMessages").innerHTML = messages.map((message) => {
    const from = state.users.find((user) => user.id === message.fromId) || state.me;
    return `<div class="pm-bubble ${message.fromId === state.me.id ? "own" : ""}"><strong>${escapeHtml(from.username)}</strong><p>${escapeHtml(message.text)}</p><small>${formatTime(message.createdAt)}</small></div>`;
  }).join("");
}

function renderAdmin() {
  if (!canUseAdminPanel()) return;
  const tools = ["mute", "kick", "ban", "changeUsername", "changeEmail", "seeIp", "deleteAccount", "changeRank", "createRoom", "deleteRoom"];
  const editableRanks = rankOrder.filter((rank) => rank !== "developer" && (state.me.rank === "developer" || rankOrder.indexOf(rank) < rankOrder.indexOf(state.me.rank)));
  $("#permissionMatrix").innerHTML = `<div class="matrix">${editableRanks.map((rank) => `
    <div class="matrix-row"><strong>${ranks[rank]}</strong>${tools.map((tool) => `<label><input type="checkbox" data-permission-rank="${rank}" data-permission-tool="${tool}" ${state.permissions?.[rank]?.[tool] ? "checked" : ""} /> ${tool}</label>`).join("")}</div>
  `).join("")}</div>`;

  $("#adminUsers").innerHTML = state.users.map((user) => {
    const disabled = !canControl(user.rank);
    return `<div class="admin-user ${disabled ? "disabled" : ""}">
      <span><strong>${escapeHtml(user.username)}</strong><small>${escapeHtml(user.email || "email hidden")} | ${escapeHtml(user.ip || "ip hidden")}</small></span>
      <select data-rank-user="${user.id}" ${disabled ? "disabled" : ""}>${editableRanks.map((rank) => `<option value="${rank}" ${user.rank === rank ? "selected" : ""}>${ranks[rank]}</option>`).join("")}</select>
      <button data-ban-user="${user.id}" ${disabled ? "disabled" : ""}>${user.banned ? "Unban" : "Ban"}</button>
      <button data-delete-user="${user.id}" ${disabled ? "disabled" : ""}>Delete</button>
    </div>`;
  }).join("");

  const badgeSelect = $("#rankBadgeForm").rank;
  badgeSelect.innerHTML = editableRanks.map((rank) => `<option value="${rank}">${ranks[rank]}</option>`).join("");
  $("#badgePreviewList").innerHTML = rankOrder.map((rank) => `<div class="badge-preview">${rankBadge(rank)}<span>${ranks[rank]}</span></div>`).join("");

  $$("[data-permission-rank]").forEach((input) => input.addEventListener("change", () => savePermission(input.dataset.permissionRank, input.dataset.permissionTool, input.checked)));
  $$("[data-rank-user]").forEach((select) => select.addEventListener("change", () => updateUser(select.dataset.rankUser, { rank: select.value })));
  $$("[data-ban-user]").forEach((button) => button.addEventListener("click", () => updateUser(button.dataset.banUser, { toggleBan: true })));
  $$("[data-delete-user]").forEach((button) => button.addEventListener("click", () => deleteUser(button.dataset.deleteUser)));
}

function switchRoom(roomId) {
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) return;
  if (room.password) {
    const password = prompt("Enter room password");
    if (password !== room.password && state.me.rank !== "developer") return alert("Wrong room password.");
  }
  state.currentRoom = roomId;
  $("#roomTitle").textContent = room.name;
  $("#currentRoomLabel").textContent = room.name;
  $("#roomDescription").textContent = room.description;
  document.body.style.setProperty("--room-image", `url('${room.image || "/assets/teen-chat-town-banner.png"}')`);
  renderRooms();
  renderMessages();
  switchView("chat");
}

function switchView(view) {
  state.activeView = view;
  $$(".view").forEach((node) => node.classList.remove("active"));
  $(`#${view}View`)?.classList.add("active");
  $$(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
}

async function loadBootstrap() {
  const data = await api("/api/bootstrap");
  state.me = data.me;
  state.rooms = data.rooms;
  state.users = data.users;
  state.messages = data.messages;
  state.privateMessages = data.privateMessages || [];
  state.permissions = data.permissions || {};
  state.rankBadges = data.rankBadges || {};
  openApp();
  renderMe();
  renderRooms();
  renderMessages();
  renderUsers();
  renderLeaderboards();
  renderMarketplace();
  renderSettings();
  renderAdmin();
  switchRoom(state.currentRoom);
  connectEvents();
}

function connectEvents() {
  if (!window.EventSource || state.eventsConnected) return;
  state.eventsConnected = true;
  const source = new EventSource(`/api/events?token=${encodeURIComponent(state.token)}`);
  source.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    state.messages.push(message);
    if (message.roomId === state.currentRoom) renderMessages();
  });
  source.addEventListener("private-message", (event) => {
    const message = JSON.parse(event.data);
    if (message.fromId === state.me.id || message.toId === state.me.id) {
      state.privateMessages.push(message);
      renderPmThread();
    }
  });
  source.addEventListener("users", (event) => {
    state.users = JSON.parse(event.data);
    renderUsers();
    renderLeaderboards();
    renderAdmin();
  });
}

async function saveProfile(patch) {
  const data = await api("/api/me", { method: "PATCH", body: JSON.stringify(patch) });
  state.me = data.me;
  const index = state.users.findIndex((user) => user.id === state.me.id);
  if (index >= 0) state.users[index] = state.me;
  renderMe();
  renderUsers();
  renderMessages();
  $("#profileEditMessage").textContent = "Saved.";
}

async function savePermission(rank, tool, allowed) {
  state.permissions = await api("/api/admin/permissions", { method: "POST", body: JSON.stringify({ rank, tool, allowed }) });
  renderAdmin();
}

async function updateUser(userId, patch) {
  const data = await api(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(patch) });
  state.users = data.users;
  state.me = data.me;
  renderUsers();
  renderMe();
  renderLeaderboards();
  renderAdmin();
}

async function deleteUser(userId) {
  if (!confirm("Delete this account permanently?")) return;
  const data = await api(`/api/admin/users/${userId}`, { method: "DELETE" });
  state.users = data.users;
  renderUsers();
  renderAdmin();
}

async function logout() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  localStorage.removeItem("tct_token");
  state.token = null;
  location.reload();
}

function bindEvents() {
  buildDateSelects();
  $$("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => {
    $$("[data-auth-tab]").forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    $$(".auth-form").forEach((form) => form.classList.remove("active"));
    $(`#${button.dataset.authTab}Form`).classList.add("active");
  }));

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api("/api/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      state.token = data.token;
      localStorage.setItem("tct_token", state.token);
      await loadBootstrap();
    } catch (error) {
      setAuthMessage(error.message, true);
    }
  });

  $("#registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api("/api/register", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      state.token = data.token;
      localStorage.setItem("tct_token", state.token);
      await loadBootstrap();
    } catch (error) {
      setAuthMessage(error.message, true);
    }
  });

  $("#messageForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#messageInput");
    const text = input.value.trim();
    if (!text && !state.pendingAttachment) return;
    input.value = "";
    $("#charCount").textContent = "0/360";
    $("#slashSuggestions").classList.add("hidden");
    $("#attachmentPreview").classList.add("hidden");
    const attachment = state.pendingAttachment;
    state.pendingAttachment = null;
    await api("/api/messages", { method: "POST", body: JSON.stringify({ roomId: state.currentRoom, text, attachment }) });
  });

  $("#messageInput").addEventListener("input", (event) => {
    const value = event.currentTarget.value;
    $("#charCount").textContent = `${value.length}/360`;
    $("#slashSuggestions").classList.toggle("hidden", !value.startsWith("/"));
    $("#typingLine").textContent = value ? `${state.me.username} is typing...` : "No one is typing";
  });

  $("#uploadButton").addEventListener("click", () => $("#imageInput").click());
  $("#cameraButton").addEventListener("click", () => $("#imageInput").click());
  $("#imageInput").addEventListener("change", async (event) => {
    try {
      const file = event.target.files[0];
      const data = await readImage(file);
      state.pendingAttachment = { name: file.name, data };
      $("#attachmentPreview").innerHTML = `<img src="${data}" alt="" /><button type="button" id="clearAttachment">Remove</button>`;
      $("#attachmentPreview").classList.remove("hidden");
      $("#clearAttachment").addEventListener("click", () => {
        state.pendingAttachment = null;
        $("#attachmentPreview").classList.add("hidden");
        $("#imageInput").value = "";
      });
    } catch (error) {
      alert(error.message);
    }
  });

  $("#micButton").addEventListener("click", (event) => {
    const pressed = event.currentTarget.getAttribute("aria-pressed") === "true";
    event.currentTarget.setAttribute("aria-pressed", String(!pressed));
    event.currentTarget.textContent = pressed ? "Mic" : "Stop mic";
    $("#typingLine").textContent = pressed ? "No one is typing" : "Recording voice clip locally...";
  });

  $$("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#themeButton").addEventListener("click", () => document.body.classList.toggle("light"));
  $("#profileMenuButton").addEventListener("click", () => $("#accountMenu").classList.toggle("hidden"));
  $("#logoutButton").addEventListener("click", logout);
  $("#logoutButtonModal").addEventListener("click", logout);

  $$("[data-open-panel]").forEach((button) => button.addEventListener("click", () => {
    $("#accountMenu").classList.add("hidden");
    const info = levelInfo(state.me.xp);
    if (button.dataset.openPanel === "level") alert(`Level ${info.level}. ${info.current}/${info.next} XP toward level ${info.level + 1}. Level 1 needs 10 XP, level 2 needs 20 more, level 3 needs 30 more.`);
    else if (button.dataset.openPanel === "wallet") alert(`Wallet: ${state.me.gold} gold and ${state.me.diamonds} diamonds.`);
    else {
      $("#profileModal").showModal();
      $("#profileEditor").classList.remove("hidden");
      $("#editorTitle").textContent = button.textContent.trim();
    }
  }));

  $$(".profile-tab").forEach((button) => button.addEventListener("click", () => {
    $$(".profile-tab").forEach((node) => node.classList.remove("active"));
    $$(".profile-tab-panel").forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    $(`#${button.dataset.profileTab}Panel`).classList.add("active");
  }));

  $("#profileEditForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const avatar = await readImage($("#avatarInput").files[0]).catch(() => "");
    if (avatar) body.avatar = avatar;
    await saveProfile(body).catch((error) => { $("#profileEditMessage").textContent = error.message; });
  });

  $("#deleteRequestButton").addEventListener("click", async () => {
    const data = await api("/api/me/delete-request", { method: "POST" });
    state.me = data.me;
    renderMe();
    alert(data.message);
  });
  $("#cancelDeleteButton").addEventListener("click", async () => {
    const data = await api("/api/me/cancel-delete", { method: "POST" });
    state.me = data.me;
    renderMe();
    alert(data.message);
  });

  $("#pmForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = $("#pmInput").value.trim();
    if (!state.selectedPmUser || !text) return;
    $("#pmInput").value = "";
    const data = await api("/api/private-messages", { method: "POST", body: JSON.stringify({ toId: state.selectedPmUser, text }) });
    state.privateMessages.push(data.message);
    renderPmThread();
  });

  $("#roomCreateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const response = await api("/api/admin/rooms", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    state.rooms = response.rooms;
    renderRooms();
    event.currentTarget.reset();
  });

  $("#rankBadgeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.rankBadges = await api("/api/admin/rank-badges", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    renderAdmin();
    renderMessages();
    renderUsers();
  });
}

bindEvents();
if (state.token) {
  loadBootstrap().catch(() => {
    localStorage.removeItem("tct_token");
    state.token = null;
    openAuth();
  });
}
