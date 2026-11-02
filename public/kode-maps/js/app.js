(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const API = "/kode-maps/api/";
  const POR_PAGINA = 100;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function api(caminho, opcoes) {
    const r = await fetch(API + caminho, Object.assign({ credentials: "include", headers: { "Content-Type": "application/json" } }, opcoes));
    if (r.status === 401) { location.href = "/"; throw new Error("Sessão expirada."); }
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(dados.error || `Erro ${r.status}`);
    return dados;
  }

  $("btnVoltar").addEventListener("click", () => { location.href = "/"; });

  // ── abas ────────────────────────────────────────────────────────────────
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === b));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.id !== "tab-" + b.dataset.tab));
    if (b.dataset.tab === "domicilios") carregarDomicilios();
    if (b.dataset.tab === "exportar") atualizarExportar();
    if (b.dataset.tab === "resumo") carregarResumo();
  }));

  // ── importação ──────────────────────────────────────────────────────────
  function logItem(classe, texto) {
    const d = document.createElement("div");
    d.className = "item " + classe;
    d.textContent = texto;
    $("logImport").appendChild(d);
    return d;
  }

  async function lerArquivo(arquivo) {
    const parsed = CsvGenericoParser.parseCsv(CsvGenericoParser.decodeArrayBuffer(await arquivo.arrayBuffer()));
    if (parsed.erro) throw new Error(parsed.erro);
    return parsed;
  }

  // Envia em lotes para não estourar o limite do corpo da requisição.
  async function enviarEmLotes(caminho, filtros, linhas, somar) {
    const total = {};
    for (let i = 0; i < linhas.length; i += 2000) {
      const r = await api(caminho, { method: "POST", body: JSON.stringify({ filtros, linhas: linhas.slice(i, i + 2000) }) });
      somar(total, r);
    }
    return total;
  }

  const soma = (acc, r) => { for (const k in r) if (typeof r[k] === "number") acc[k] = (acc[k] || 0) + r[k]; else acc[k] = r[k]; };

  async function importar(arquivos, tipo) {
    $("logImport").innerHTML = "";
    for (const arq of arquivos) {
      const item = logItem("wait", `${arq.name}: lendo…`);
      try {
        const p = await lerArquivo(arq);
        if (tipo === "territorio") {
          const r = await enviarEmLotes("importar/territorio", p.filtros, p.linhas, soma);
          item.className = "item ok";
          item.textContent = `${arq.name} — Microárea ${r.microarea}: ${r.domicilios_novos} domicílio(s) novo(s), ${r.domicilios_atualizados} atualizado(s), ${r.familias} família(s), ${r.cidadaos} cidadão(s).`;
        } else {
          const r = await enviarEmLotes("importar/vinculados", p.filtros, p.linhas, soma);
          item.className = "item ok";
          item.textContent = `${arq.name}: ${r.cidadaos} cidadão(s), ${r.ligados} ligado(s) a domicílio já existente, ${r.domicilios_novos} domicílio(s) novo(s), ${r.sem_endereco} sem endereço, ${r.fora_da_area} fora da área.`;
        }
      } catch (e) {
        item.className = "item err";
        item.textContent = `${arq.name}: ${e.message}`;
      }
    }
    carregarResumo();
  }

  function ligarDrop(dropId, inputId, tipo) {
    const drop = $(dropId), input = $(inputId);
    input.addEventListener("change", () => { if (input.files.length) importar([...input.files], tipo); input.value = ""; });
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("drag"); if (e.dataTransfer.files.length) importar([...e.dataTransfer.files], tipo); });
  }
  ligarDrop("dropTerr", "inputTerr", "territorio");
  ligarDrop("dropVinc", "inputVinc", "vinculados");

  // ── resumo ──────────────────────────────────────────────────────────────
  let microareas = [];

  async function carregarResumo() {
    const r = await api("resumo");
    microareas = r.microareas;
    const tot = r.microareas.reduce((a, m) => ({ d: a.d + m.domicilios, f: a.f + m.familias, c: a.c + m.coletados }), { d: 0, f: 0, c: 0 });
    $("resumoBox").innerHTML = [["Domicílios", tot.d], ["Famílias", tot.f], ["Com GPS", tot.c], ["Pendentes", tot.d - tot.c]]
      .map(([l, n]) => `<div class="stat-box"><div class="l">${l}</div><div class="n">${n}</div></div>`).join("");
    $("tblResumo").querySelector("tbody").innerHTML = r.microareas.map((m) => {
      const pct = m.domicilios ? Math.round((100 * m.coletados) / m.domicilios) : 0;
      return `<tr><td><b>${esc(m.microarea || "—")}</b></td><td>${m.domicilios}</td><td>${m.familias}</td><td>${m.coletados}</td><td><div class="bar"><i style="width:${pct}%"></i></div><span class="sub">${pct}%</span></td></tr>`;
    }).join("") || '<tr><td colspan="5" class="sub">Nenhum dado importado ainda.</td></tr>';
    $("semDomicilio").textContent = r.cidadaos_sem_domicilio ? `${r.cidadaos_sem_domicilio} cidadão(s) vinculado(s) sem endereço utilizável (ficaram fora do mapa).` : "";
    const opcoes = r.microareas.filter((m) => m.microarea).map((m) => `<option value="${esc(m.microarea)}">Microárea ${esc(m.microarea)}</option>`).join("");
    $("fMicro").innerHTML = '<option value="">Todas as microáreas</option>' + opcoes;
    $("exMicro").innerHTML = '<option value="">Todas</option>' + opcoes;
  }

  // ── domicílios ──────────────────────────────────────────────────────────
  let pagina = 0, ultimaLista = [], mapa = null, camadaPontos = null;

  const enderecoLinha = (d) => [[d.tipo_logradouro, d.logradouro].filter(Boolean).join(" "), d.numero].filter(Boolean).join(", ") || "(sem logradouro)";

  async function carregarDomicilios() {
    const p = new URLSearchParams({ limite: POR_PAGINA, deslocamento: pagina * POR_PAGINA });
    if ($("fMicro").value) p.set("microarea", $("fMicro").value);
    if ($("fStatus").value) p.set("status", $("fStatus").value);
    if ($("fBusca").value.trim()) p.set("q", $("fBusca").value.trim());
    const r = await api("domicilios?" + p);
    ultimaLista = r.domicilios;
    $("contagem").textContent = `${r.total} domicílio(s)`;
    $("pagInfo").textContent = `Página ${pagina + 1} de ${Math.max(1, Math.ceil(r.total / POR_PAGINA))}`;
    $("btnAnt").disabled = pagina === 0;
    $("btnProx").disabled = (pagina + 1) * POR_PAGINA >= r.total;
    $("tblDom").querySelector("tbody").innerHTML = r.domicilios.map((d, i) => {
      const resp = d.familias.map((f) => esc(f.responsavel_nome || "—")).join("<br>") || '<span class="sub">sem família</span>';
      return `<tr class="clic" data-i="${i}"><td>${esc(d.microarea || "—")}</td>
        <td><b>${esc(enderecoLinha(d))}</b>${d.complemento ? `<div class="sub">${esc(d.complemento)}</div>` : ""}${d.ponto_referencia ? `<div class="sub">Ref.: ${esc(d.ponto_referencia)}</div>` : ""}</td>
        <td>${resp}</td><td><span class="tag">${esc(d.tipo_imovel)}</span></td>
        <td>${d.lat != null ? '<span class="tag gps">GPS</span>' : '<span class="tag sem">pendente</span>'}</td>
        <td class="sub">${d.moradores} morador(es)</td></tr>`;
    }).join("");
    if (!$("mapaWrap").classList.contains("hidden")) desenharMapa();
  }

  let temporizador;
  ["fMicro", "fStatus"].forEach((id) => $(id).addEventListener("change", () => { pagina = 0; carregarDomicilios(); }));
  $("fBusca").addEventListener("input", () => { clearTimeout(temporizador); temporizador = setTimeout(() => { pagina = 0; carregarDomicilios(); }, 300); });
  $("btnAnt").addEventListener("click", () => { pagina--; carregarDomicilios(); });
  $("btnProx").addEventListener("click", () => { pagina++; carregarDomicilios(); });
  $("tblDom").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-i]"); if (tr) abrirModal(ultimaLista[Number(tr.dataset.i)]); });

  // ── mapa do painel (Leaflet, satélite Esri) ─────────────────────────────
  $("btnMapa").addEventListener("click", () => {
    $("mapaWrap").classList.toggle("hidden");
    if (!$("mapaWrap").classList.contains("hidden")) desenharMapa();
  });

  function desenharMapa() {
    if (!mapa) {
      mapa = L.map("mapa").setView([-19.98, -44.87], 13);
      const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 17, maxZoom: 20, attribution: "Esri" });
      const rel = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 17, maxZoom: 20, attribution: "Esri" });
      const rua = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" });
      sat.addTo(mapa);
      L.control.layers({ Satélite: sat, Relevo: rel, Rua: rua }).addTo(mapa);
    }
    if (camadaPontos) camadaPontos.remove();
    camadaPontos = L.layerGroup().addTo(mapa);
    const pts = [];
    ultimaLista.forEach((d, i) => {
      if (d.lat == null) return;
      pts.push([d.lat, d.lng]);
      L.circleMarker([d.lat, d.lng], { radius: 7, color: "#fff", weight: 2, fillColor: "#059669", fillOpacity: 1 })
        .bindTooltip(enderecoLinha(d)).on("click", () => abrirModal(ultimaLista[i])).addTo(camadaPontos);
    });
    setTimeout(() => { mapa.invalidateSize(); if (pts.length) mapa.fitBounds(pts, { padding: [30, 30], maxZoom: 17 }); }, 50);
  }

  // ── modal ───────────────────────────────────────────────────────────────
  let editando = null;
  const campos = { mTipo: "tipo_imovel", mMicro: "microarea", mTipoLog: "tipo_logradouro", mLog: "logradouro", mNum: "numero", mCompl: "complemento", mRef: "ponto_referencia", mBairro: "bairro", mLat: "lat", mLng: "lng", mObs: "observacao" };
  const camposEndereco = ["mMicro", "mTipoLog", "mLog", "mNum", "mBairro"];

  function famHtml(f) {
    return `<div class="fam" data-id="${esc(f.id || "")}">
      <input placeholder="Responsável familiar" value="${esc(f.responsavel_nome)}" data-k="responsavel_nome">
      <input placeholder="CPF" value="${esc(f.responsavel_cpf)}" data-k="responsavel_cpf" inputmode="numeric">
      <input placeholder="Nº prontuário" value="${esc(f.prontuario)}" data-k="prontuario">
      <button class="btn btn-ghost" type="button" title="Remover linha vazia" data-rm>✕</button></div>`;
  }

  function abrirModal(d) {
    editando = d || null;
    $("mTitulo").textContent = d ? enderecoLinha(d) : "Novo domicílio";
    const fixo = d && d.origem !== "app" && d.origem !== "painel"; // endereço importado é só leitura
    for (const [el, k] of Object.entries(campos)) {
      $(el).value = d && d[k] != null ? d[k] : (k === "tipo_imovel" ? "SEM INFO" : "");
      if (camposEndereco.includes(el)) $(el).disabled = !!fixo;
    }
    $("mFamilias").innerHTML = (d ? d.familias : []).map(famHtml).join("");
    $("mExcluir").classList.toggle("hidden", !d);
    $("mMsg").className = "msg";
    $("modal").classList.remove("hidden");
  }

  $("btnNovo").addEventListener("click", () => abrirModal(null));
  $("mCancelar").addEventListener("click", () => $("modal").classList.add("hidden"));
  $("mAddFam").addEventListener("click", () => $("mFamilias").insertAdjacentHTML("beforeend", famHtml({})));
  $("mFamilias").addEventListener("click", (e) => { if (e.target.closest("[data-rm]")) { const f = e.target.closest(".fam"); if (!f.dataset.id) f.remove(); } });

  $("mSalvar").addEventListener("click", async () => {
    const corpo = {};
    for (const [el, k] of Object.entries(campos)) {
      if ($(el).disabled) continue;
      corpo[k] = $(el).value.trim() || null;
    }
    corpo.tipo_imovel = $("mTipo").value;
    corpo.familias = [...$("mFamilias").querySelectorAll(".fam")].map((f) => {
      const o = { id: f.dataset.id || undefined };
      f.querySelectorAll("input").forEach((i) => { o[i.dataset.k] = i.value.trim(); });
      return o;
    });
    try {
      if (editando) await api("domicilios/" + editando.id, { method: "PATCH", body: JSON.stringify(corpo) });
      else await api("domicilios", { method: "POST", body: JSON.stringify(corpo) });
      $("modal").classList.add("hidden");
      carregarDomicilios();
      carregarResumo();
    } catch (e) {
      $("mMsg").textContent = e.message;
      $("mMsg").className = "msg show error";
    }
  });

  $("mExcluir").addEventListener("click", async () => {
    if (!editando || !confirm("Excluir este domicílio? Ele deixa de aparecer no painel e no app.")) return;
    await api("domicilios/" + editando.id, { method: "DELETE" });
    $("modal").classList.add("hidden");
    carregarDomicilios();
    carregarResumo();
  });

  // ── exportar ────────────────────────────────────────────────────────────
  function atualizarExportar() {
    const m = $("exMicro").value;
    $("btnBaixar").href = "api/exportar/mymaps.csv" + (m ? "?microarea=" + encodeURIComponent(m) : "");
    const linha = microareas.filter((x) => !m || x.microarea === m).reduce((a, x) => a + x.coletados, 0);
    $("exInfo").textContent = `${linha} domicílio(s) com GPS serão exportados.`;
  }
  $("exMicro").addEventListener("change", atualizarExportar);

  // session.js libera o appShell depois do /api/me; carrega os dados em paralelo.
  carregarResumo().catch(() => {});
})();
