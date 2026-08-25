(function () {
  "use strict";

  const ICONS = { laboratorio: "🧪", oftalmo: "👁", esus_pec: "🏥", qualidade_bpa: "📊", correcao_bpa: "🛠", bolsa_familia: "👪" };

  const loginView = document.getElementById("loginView");
  const modulesView = document.getElementById("modulesView");
  const sessionBar = document.getElementById("sessionBar");
  const sessionName = document.getElementById("sessionName");
  const adminLink = document.getElementById("adminLink");
  const btnLogout = document.getElementById("btnLogout");

  const loginForm = document.getElementById("loginForm");
  const loginCpf = document.getElementById("loginCpf");
  const loginSenha = document.getElementById("loginSenha");
  const loginMsg = document.getElementById("loginMsg");
  const btnLogin = document.getElementById("btnLogin");

  loginCpf.addEventListener("input", () => {
    loginCpf.value = loginCpf.value.replace(/\D/g, "").slice(0, 11);
  });

  function showError(text) {
    loginMsg.textContent = text;
    loginMsg.classList.add("show");
  }
  function clearError() {
    loginMsg.textContent = "";
    loginMsg.classList.remove("show");
  }

  function renderModules(modules) {
    modulesView.innerHTML = "";
    modules.forEach((m) => {
      const clickable = m.status === "live" && m.granted;
      const el = document.createElement(clickable ? "a" : "div");
      if (clickable) el.href = "/" + m.slug + "/";

      let statusClass = "live", statusText = "Disponível";
      if (m.status !== "live") { statusClass = "soon"; statusText = "Em breve"; }
      else if (!m.granted) { statusClass = "locked"; statusText = "Sem acesso"; }

      el.className = "mod " + (clickable ? "active" : statusClass);
      el.innerHTML =
        '<div class="mod-icon">' + (ICONS[m.slug] || "📦") + "</div>" +
        "<h2>" + escapeHtml(m.name) + "</h2>" +
        "<p>" + escapeHtml(m.description || "") + "</p>" +
        '<div class="status ' + statusClass + '">' + statusText + "</div>";
      modulesView.appendChild(el);
    });
  }

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function showApp(me) {
    loginView.classList.add("hidden");
    modulesView.classList.remove("hidden");
    sessionBar.classList.remove("hidden");
    sessionName.textContent = me.name;
    adminLink.classList.toggle("hidden", !me.isAdmin);
    renderModules(me.modules);
  }

  function showLogin() {
    modulesView.classList.add("hidden");
    sessionBar.classList.add("hidden");
    loginView.classList.remove("hidden");
    loginCpf.focus();
  }

  async function refresh() {
    try {
      const res = await fetch("/api/me", { credentials: "include" });
      if (res.ok) {
        showApp(await res.json());
      } else {
        showLogin();
      }
    } catch (err) {
      showLogin();
    }
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();
    const cpf = loginCpf.value.trim();
    const senha = loginSenha.value;
    if (!cpf || !senha) { showError("Informe CPF e senha."); return; }

    btnLogin.disabled = true;
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cpf, senha }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showError(data.error || "Não foi possível entrar.");
        return;
      }
      loginSenha.value = "";
      await refresh();
    } catch (err) {
      showError("Falha de conexão. Tente novamente.");
    } finally {
      btnLogin.disabled = false;
    }
  });

  btnLogout.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    loginCpf.value = "";
    loginSenha.value = "";
    showLogin();
  });

  refresh();
})();
