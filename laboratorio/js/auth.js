(function(){
  "use strict";

  const ADMIN_USER = "admin";
  const ADMIN_PASS = "adminsgp";
  const USERS_KEY = "bpaUsers";
  const SESSION_KEY = "bpaSession";

  // Usuários fixos: sempre disponíveis, mesmo se o localStorage for limpo.
  const FIXED_USERS = [
    { name: "DANIELA", password: "saudesgp" }
  ];

  const loginScreen = document.getElementById("loginScreen");
  const appShell = document.getElementById("appShell");
  const loginForm = document.getElementById("loginForm");
  const loginUser = document.getElementById("loginUser");
  const loginPass = document.getElementById("loginPass");
  const loginMsg = document.getElementById("loginMsg");
  const topbarUsername = document.getElementById("topbarUsername");
  const btnLogout = document.getElementById("btnLogout");
  const tabUsuariosBtn = document.getElementById("tabUsuariosBtn");

  function setMsg(el, type, text){
    el.className = "msg show " + type;
    el.textContent = text;
  }
  function clearMsg(el){ el.className = "msg"; el.textContent = ""; }

  function getUsers(){
    try{ return JSON.parse(localStorage.getItem(USERS_KEY)) || []; }
    catch(e){ return []; }
  }
  function saveUsers(list){ localStorage.setItem(USERS_KEY, JSON.stringify(list)); }
  function getAllUsers(){ return FIXED_USERS.concat(getUsers()); }

  function getSession(){
    try{ return JSON.parse(sessionStorage.getItem(SESSION_KEY)); }
    catch(e){ return null; }
  }
  function setSession(session){ sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
  function clearSession(){ sessionStorage.removeItem(SESSION_KEY); }

  function showApp(session){
    loginScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
    topbarUsername.textContent = session.name + " · " + (session.role === "admin" ? "Administrador" : "Usuário");
    tabUsuariosBtn.style.display = session.role === "admin" ? "" : "none";
    if (session.role === "admin"){
      renderUsers();
      activateTab("gerador");
    } else {
      activateTab("gerador");
    }
  }

  function showLogin(){
    appShell.classList.add("hidden");
    loginScreen.classList.remove("hidden");
    loginUser.value = "";
    loginPass.value = "";
    clearMsg(loginMsg);
    loginUser.focus();
  }

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    clearMsg(loginMsg);
    const user = loginUser.value.trim();
    const pass = loginPass.value;

    if (!user || !pass){
      setMsg(loginMsg, "error", "Informe usuário e senha.");
      return;
    }

    if (user.toLowerCase() === ADMIN_USER && pass === ADMIN_PASS){
      const session = { name: "admin", role: "admin" };
      setSession(session);
      showApp(session);
      return;
    }

    const users = getAllUsers();
    const found = users.find(u => u.name.toLowerCase() === user.toLowerCase() && u.password === pass);
    if (found){
      const session = { name: found.name, role: "user" };
      setSession(session);
      showApp(session);
      return;
    }

    setMsg(loginMsg, "error", "Usuário ou senha inválidos.");
  });

  btnLogout.addEventListener("click", () => {
    clearSession();
    location.reload();
  });

  // ---------- tabs ----------
  const tabButtons = document.querySelectorAll(".tab-btn");
  function activateTab(name){
    tabButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach(panel => {
      panel.style.display = (panel.id === "tab" + name.charAt(0).toUpperCase() + name.slice(1)) ? "" : "none";
    });
  }
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  // ---------- admin: cadastro de usuários ----------
  const newUserName = document.getElementById("newUserName");
  const newUserPass = document.getElementById("newUserPass");
  const btnAddUser = document.getElementById("btnAddUser");
  const userMsg = document.getElementById("userMsg");
  const usersBody = document.getElementById("usersBody");

  function renderUsers(){
    const fixed = FIXED_USERS;
    const stored = getUsers();
    usersBody.innerHTML = "";

    if (fixed.length === 0 && stored.length === 0){
      usersBody.innerHTML = '<tr><td colspan="2" style="color:var(--cinza-600);">Nenhum usuário cadastrado ainda.</td></tr>';
      return;
    }

    fixed.forEach(u => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td>' + escapeHtml(u.name) + ' <span class="badge">fixo</span></td>' +
        '<td></td>';
      usersBody.appendChild(tr);
    });

    stored.forEach((u, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td>' + escapeHtml(u.name) + '</td>' +
        '<td><button class="rm-btn" data-idx="' + idx + '" title="Remover usuário">✕</button></td>';
      usersBody.appendChild(tr);
    });
    usersBody.querySelectorAll(".rm-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.idx, 10);
        const list = getUsers();
        list.splice(i, 1);
        saveUsers(list);
        renderUsers();
      });
    });
  }

  btnAddUser.addEventListener("click", () => {
    clearMsg(userMsg);
    const name = newUserName.value.trim();
    const pass = newUserPass.value;

    if (!name || !pass){
      setMsg(userMsg, "error", "Informe nome e senha do usuário.");
      return;
    }
    if (name.toLowerCase() === ADMIN_USER){
      setMsg(userMsg, "error", "Esse nome é reservado para o administrador.");
      return;
    }
    if (getAllUsers().some(u => u.name.toLowerCase() === name.toLowerCase())){
      setMsg(userMsg, "error", "Já existe um usuário cadastrado com esse nome.");
      return;
    }

    const users = getUsers();
    users.push({ name, password: pass });
    saveUsers(users);
    newUserName.value = "";
    newUserPass.value = "";
    setMsg(userMsg, "ok", "Usuário \"" + name + "\" cadastrado com sucesso.");
    renderUsers();
  });

  function escapeHtml(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  // ---------- boot ----------
  const existingSession = getSession();
  if (existingSession && existingSession.name){
    showApp(existingSession);
  } else {
    showLogin();
  }

})();
