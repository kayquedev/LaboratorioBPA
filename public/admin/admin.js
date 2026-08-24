(function () {
  "use strict";

  let modules = [];
  let editingId = null;

  const form = document.getElementById("userForm");
  const userId = document.getElementById("userId");
  const fName = document.getElementById("fName");
  const fEmail = document.getElementById("fEmail");
  const fCpf = document.getElementById("fCpf");
  const fSenha = document.getElementById("fSenha");
  const fIsAdmin = document.getElementById("fIsAdmin");
  const modulesCheck = document.getElementById("modulesCheck");
  const formMsg = document.getElementById("formMsg");
  const formTitle = document.getElementById("formTitle");
  const btnSubmit = document.getElementById("btnSubmit");
  const btnCancel = document.getElementById("btnCancel");
  const usersBody = document.getElementById("usersBody");

  fCpf.addEventListener("input", () => { fCpf.value = fCpf.value.replace(/\D/g, "").slice(0, 11); });

  function setMsg(type, text) {
    formMsg.className = "msg show " + type;
    formMsg.textContent = text;
  }
  function clearMsg() {
    formMsg.className = "msg";
    formMsg.textContent = "";
  }
  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderModulesCheck(selectedSlugs) {
    selectedSlugs = selectedSlugs || [];
    modulesCheck.innerHTML = "";
    modules.forEach((m) => {
      const id = "modChk_" + m.slug;
      const wrap = document.createElement("label");
      wrap.innerHTML =
        '<input type="checkbox" value="' + m.slug + '" id="' + id + '" ' +
        (selectedSlugs.includes(m.slug) ? "checked" : "") + "> " + escapeHtml(m.name);
      modulesCheck.appendChild(wrap);
    });
  }

  function getSelectedModules() {
    return Array.from(modulesCheck.querySelectorAll("input[type=checkbox]:checked")).map((c) => c.value);
  }

  function enterEditMode(user) {
    editingId = user.id;
    userId.value = user.id;
    fName.value = user.name;
    fEmail.value = user.email || "";
    fCpf.value = user.cpf;
    fSenha.value = "";
    fSenha.placeholder = "Deixe em branco para manter a senha atual";
    fIsAdmin.checked = user.isAdmin;
    renderModulesCheck(user.modules);
    formTitle.innerHTML = '<span id="formIcon">✎</span> Editando: ' + escapeHtml(user.name);
    btnSubmit.textContent = "Salvar alterações";
    btnCancel.classList.remove("hidden");
    clearMsg();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    editingId = null;
    form.reset();
    userId.value = "";
    fSenha.placeholder = "";
    renderModulesCheck([]);
    formTitle.innerHTML = '<span id="formIcon">＋</span> Cadastrar usuário';
    btnSubmit.textContent = "Cadastrar usuário";
    btnCancel.classList.add("hidden");
    clearMsg();
  }

  function renderUsers(users) {
    usersBody.innerHTML = "";
    if (!users.length) {
      usersBody.innerHTML = '<tr><td colspan="4" style="color:var(--cinza-600);">Nenhum usuário cadastrado.</td></tr>';
      return;
    }
    users.forEach((u) => {
      const tr = document.createElement("tr");
      const modBadges = u.modules.length
        ? u.modules.map((slug) => {
            const mod = modules.find((m) => m.slug === slug);
            return '<span class="badge">' + escapeHtml(mod ? mod.name : slug) + "</span>";
          }).join("")
        : "—";
      tr.innerHTML =
        "<td>" + escapeHtml(u.name) + (u.isAdmin ? ' <span class="badge">admin</span>' : "") + "</td>" +
        "<td>" + escapeHtml(u.cpf) + "</td>" +
        "<td>" + modBadges + "</td>" +
        '<td class="row-actions"><button data-action="edit">Editar</button><button data-action="del" class="danger">Excluir</button></td>';
      tr.querySelector('[data-action="edit"]').addEventListener("click", () => enterEditMode(u));
      tr.querySelector('[data-action="del"]').addEventListener("click", () => deleteUser(u));
      usersBody.appendChild(tr);
    });
  }

  async function loadAll() {
    const [modRes, userRes] = await Promise.all([
      fetch("/api/admin/modules", { credentials: "include" }),
      fetch("/api/admin/users", { credentials: "include" }),
    ]);
    modules = await modRes.json();
    const users = await userRes.json();
    if (!editingId) renderModulesCheck([]);
    renderUsers(users);
  }

  async function deleteUser(u) {
    if (!confirm('Remover o usuário "' + u.name + '"?')) return;
    const res = await fetch("/api/admin/users/" + u.id, { method: "DELETE", credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { alert(data.error || "Não foi possível remover."); return; }
    if (editingId === u.id) resetForm();
    renderUsers(data.users);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg();

    const payload = {
      name: fName.value.trim(),
      email: fEmail.value.trim(),
      cpf: fCpf.value.trim(),
      senha: fSenha.value,
      isAdmin: fIsAdmin.checked,
      modules: getSelectedModules(),
    };

    if (!payload.name || payload.cpf.length !== 11 || (!editingId && !payload.senha)) {
      setMsg("error", "Confira nome, CPF (11 dígitos)" + (!editingId ? " e senha." : "."));
      return;
    }

    const url = editingId ? "/api/admin/users/" + editingId : "/api/admin/users";
    const method = editingId ? "PUT" : "POST";

    btnSubmit.disabled = true;
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setMsg("error", data.error || "Não foi possível salvar."); return; }
      renderUsers(data.users);
      const wasEditing = !!editingId;
      resetForm();
      setMsg("ok", wasEditing ? "Usuário atualizado com sucesso." : "Usuário cadastrado com sucesso.");
    } finally {
      btnSubmit.disabled = false;
    }
  });

  btnCancel.addEventListener("click", resetForm);

  loadAll();
})();
