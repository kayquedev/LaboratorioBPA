(function () {
  "use strict";

  const ICONS = { laboratorio: "🧪", oftalmo: "👁", esus_pec: "🏥", qualidade_bpa: "📊", correcao_bpa: "🛠", bolsa_familia: "👪", siaps_indicadores: "📈", datasus_sia: "💰", acompanhamento_pec: "🏘" };
  // módulos que não são páginas internas nossas, e sim links pra fora - mesmo
  // cartão/mesma regra de acesso (status live + grant), só o destino muda.
  const EXTERNAL_URLS = { siaps_indicadores: "https://siaps.kayque.site/" };

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

  // só mostra módulos (disponíveis ou "em breve") que o usuário tem
  // permissão de ver - nada de card desabilitado/"sem acesso" pra quem
  // não foi liberado.
  function renderModules(modules) {
    modulesView.innerHTML = "";
    const visiveis = modules.filter((m) => m.granted);

    if (!visiveis.length) {
      modulesView.innerHTML = '<p style="grid-column:1/-1;color:var(--text-dim);font-size:13.5px;">Nenhum módulo liberado para o seu usuário ainda — fale com o administrador.</p>';
      return;
    }

    visiveis.forEach((m) => {
      const clickable = m.status === "live";
      const externo = EXTERNAL_URLS[m.slug];
      const el = document.createElement(clickable ? "a" : "div");
      if (clickable) {
        el.href = externo || ("/" + m.slug + "/");
        if (externo) { el.target = "_blank"; el.rel = "noopener"; }
      }

      const statusClass = clickable ? "live" : "soon";
      const statusText = clickable ? "Disponível" : "Em breve";

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
