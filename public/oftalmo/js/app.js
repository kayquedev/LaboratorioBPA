(function () {
  "use strict";

  // ---------- state ----------
  let miguellinRows = [];   // { nome, nasc, comunidade }
  let esusMap = new Map();  // chave normalizada -> { nome, nasc, cns, cpf, ibge, cep, cbo, microarea, equipe }
  let esusList = [];        // array plano para busca no modal (derivado do esusMap)
  let pacientes = [];       // resultado do cruzamento
  let fileContent = "";
  let fileName = "";
  let modalTargetIdx = -1;  // índice do paciente sendo editado no modal (-1 = novo cidadão)

  // Procedimentos padrão (editáveis pelo usuário na config)
  const SIGTAP_CONSULTA_PADRAO = "0301010072";
  const SIGTAP_OCULOS_PADRAO = "0701040050";
  const CBO_OFTALMO_PADRAO = "225265";

  // ---------- helpers ----------
  function onlyDigits(s) { return String(s == null ? "" : s).replace(/\D/g, ""); }
  function stripAccents(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function padLeft(v, len, ch) { ch = ch || "0"; v = String(v); return v.length >= len ? v.slice(-len) : ch.repeat(len - v.length) + v; }
  function padRight(v, len, ch) { ch = ch || " "; v = String(v); return v.length >= len ? v.slice(0, len) : v + ch.repeat(len - v.length); }
  function setMsg(el, type, text) { el.className = "msg show " + type; el.textContent = text; }
  function clearMsg(el) { el.className = "msg"; el.textContent = ""; }
  function enableCard(id) { document.getElementById(id).classList.remove("disabled"); }
  function escapeHtml(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function normalizeNome(s) {
    return stripAccents(String(s || "").toUpperCase().trim()).replace(/\s+/g, " ");
  }

  function normalizeDataNasc(val) {
    if (val instanceof Date && !isNaN(val)) {
      const d = val.getDate(), m = val.getMonth() + 1, y = val.getFullYear();
      return padLeft(d, 2) + "/" + padLeft(m, 2) + "/" + y;
    }
    const s = String(val || "").trim();
    const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m1) return padLeft(m1[1], 2) + "/" + padLeft(m1[2], 2) + "/" + m1[3];
    if (/^\d{8}$/.test(s)) return s.slice(6, 8) + "/" + s.slice(4, 6) + "/" + s.slice(0, 4);
    return s;
  }

  function dataNascParaChave(ddmmyyyy) {
    if (!ddmmyyyy || typeof ddmmyyyy !== "string") return "";
    const parts = ddmmyyyy.split("/");
    if (parts.length !== 3) return "";
    return parts[2] + parts[1] + parts[0];
  }

  function chaveCruzamento(nome, nasc) {
    return normalizeNome(nome) + "|" + dataNascParaChave(normalizeDataNasc(nasc));
  }

  // ---------- STEP 1: Config SIGTAP ----------
  const sigtapConsultaInput = document.getElementById("sigtapConsulta");
  const sigtapOculosInput = document.getElementById("sigtapOculos");
  const cboInput = document.getElementById("cbo");
  const configMsg = document.getElementById("configMsg");

  // ---------- Upload MIGUELLIN ----------
  const dropMiguellin = document.getElementById("dropMiguellin");
  const fileMiguellin = document.getElementById("fileMiguellin");
  const fnameMiguellin = document.getElementById("fnameMiguellin");
  const msgMiguellin = document.getElementById("msgMiguellin");

  ["dragenter", "dragover"].forEach(ev => dropMiguellin.addEventListener(ev, e => { e.preventDefault(); dropMiguellin.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(ev => dropMiguellin.addEventListener(ev, e => { e.preventDefault(); dropMiguellin.classList.remove("drag"); }));
  dropMiguellin.addEventListener("drop", e => {
    if (e.dataTransfer.files.length) { fileMiguellin.files = e.dataTransfer.files; handleMiguellin(e.dataTransfer.files[0]); }
  });
  fileMiguellin.addEventListener("change", () => { if (fileMiguellin.files.length) handleMiguellin(fileMiguellin.files[0]); });

  function handleMiguellin(file) {
    fnameMiguellin.textContent = file.name;
    clearMsg(msgMiguellin);
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

        let headerIdx = -1;
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
          const r = rows[i];
          if (r && String(r[1] || "").toUpperCase().includes("PACIENTE")) { headerIdx = i; break; }
        }
        if (headerIdx < 0) throw new Error("Cabeçalho com coluna PACIENTE não encontrado nas primeiras 10 linhas.");

        miguellinRows = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const r = rows[i];
          const nome = String(r[1] || "").trim();
          const nasc = r[2];
          if (!nome) continue;
          miguellinRows.push({
            nome: nome,
            nasc: normalizeDataNasc(nasc),
            comunidade: String(r[3] || "").trim()
          });
        }

        if (miguellinRows.length === 0) throw new Error("Nenhum paciente encontrado na planilha MIGUELLIN.");
        setMsg(msgMiguellin, "ok", miguellinRows.length + " pacientes carregados da planilha MIGUELLIN.");
        enableCard("card-upload-esus");
      } catch (err) {
        setMsg(msgMiguellin, "err", "Erro ao ler MIGUELLIN: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ---------- Upload e-SUS ----------
  const dropEsus = document.getElementById("dropEsus");
  const fileEsus = document.getElementById("fileEsus");
  const fnameEsus = document.getElementById("fnameEsus");
  const msgEsus = document.getElementById("msgEsus");
  const esusFilesList = document.getElementById("esusFilesList");
  let esusTotalCount = 0;
  const btnLimparEsus = document.getElementById("btnLimparEsus");

  function atualizarBtnLimparEsus() {
    if (esusTotalCount > 0) btnLimparEsus.classList.remove("hidden");
    else btnLimparEsus.classList.add("hidden");
  }

  btnLimparEsus.addEventListener("click", () => {
    esusMap.clear();
    esusTotalCount = 0;
    fnameEsus.textContent = "";
    esusFilesList.innerHTML = "";
    clearMsg(msgEsus);
    fileEsus.value = "";
    atualizarBtnLimparEsus();
  });

  ["dragenter", "dragover"].forEach(ev => dropEsus.addEventListener(ev, e => { e.preventDefault(); dropEsus.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(ev => dropEsus.addEventListener(ev, e => { e.preventDefault(); dropEsus.classList.remove("drag"); }));
  dropEsus.addEventListener("drop", e => {
    if (e.dataTransfer.files.length) {
      fileEsus.files = e.dataTransfer.files;
      Array.from(e.dataTransfer.files).forEach(f => handleEsus(f));
    }
  });
  fileEsus.addEventListener("change", () => {
    if (fileEsus.files.length) {
      Array.from(fileEsus.files).forEach(f => handleEsus(f));
      fileEsus.value = "";
    }
  });

  function handleEsus(file) {
    clearMsg(msgEsus);
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const text = e.target.result;
        const lines = text.split(/\r?\n/);

        let headerIdx = -1;
        let cols = {};
        for (let i = 0; i < Math.min(lines.length, 30); i++) {
          const parts = lines[i].split(";");
          const norm = parts.map(p => stripAccents(String(p || "").toUpperCase().trim()));
          const idxNome = norm.findIndex(n => n === "NOME");
          const idxNasc = norm.findIndex(n => n.includes("DATA DE NASCIMENTO") || n === "DATA NASCIMENTO");
          if (idxNome >= 0 && idxNasc >= 0) {
            headerIdx = i;
            cols.nome = idxNome;
            cols.nasc = idxNasc;
            cols.cns = norm.findIndex(n => n.includes("CPF/CNS") || n === "CNS");
            cols.microarea = norm.findIndex(n => n.includes("MICROAREA") || n === "MICROÁREA");
            cols.equipe = norm.findIndex(n => n.includes("NOME EQUIPE") || n === "EQUIPE");
            cols.endereco = norm.findIndex(n => n === "ENDERECO" || n === "ENDEREÇO" || n === "LOGRADOURO" || n === "RUA" || n.includes("ENDERECO") || n.includes("LOGRADOURO"));
            cols.ibge = norm.findIndex(n => n.includes("CODIGO IBGE") || n.includes("MUNICIPIO") || n === "IBGE");
            cols.cep = norm.findIndex(n => n === "CEP");
            cols.sexo = norm.findIndex(n => n === "SEXO");
            cols.cpf = norm.findIndex(n => n === "CPF" || n.includes("CPF/CNS"));
            cols.bairro = norm.findIndex(n => n === "BAIRRO" || n.includes("BAIRRO") || n === "DISTRITO");
            cols.numero = norm.findIndex(n => n === "NUMERO" || n === "NÚMERO");
            cols.complemento = norm.findIndex(n => n === "COMPLEMENTO");
            cols.telefone = norm.findIndex(n => n === "TELEFONE" || n.includes("CELULAR"));
            break;
          }
        }
        if (headerIdx < 0) throw new Error("Cabeçalho do e-SUS não encontrado em " + file.name);

        let count = 0;
        for (let i = headerIdx + 1; i < lines.length; i++) {
          const parts = lines[i].split(";");
          const nome = String(parts[cols.nome] || "").trim();
          const nascRaw = String(parts[cols.nasc] || "").trim();
          if (!nome || !nascRaw) continue;
          const nasc = normalizeDataNasc(nascRaw);
          const chave = chaveCruzamento(nome, nasc);
          const cnsRaw = String(parts[cols.cns] || "").trim();
          let cns = cnsRaw;
          if (cnsRaw.includes("E+") || cnsRaw.includes("e+")) {
            try { cns = String(Math.round(Number(cnsRaw))); } catch (_) { /* keep raw */ }
          }
          cns = onlyDigits(cns);

          esusMap.set(chave, {
            nome: nome,
            nasc: nasc,
            cns: cns,
            microarea: String(parts[cols.microarea] || "").trim(),
            equipe: String(parts[cols.equipe] || "").trim(),
            endereco: String(parts[cols.endereco] || "").trim(),
            ibge: onlyDigits(String(parts[cols.ibge] || "").trim()),
            cep: onlyDigits(String(parts[cols.cep] || "").trim()),
            sexo: String(parts[cols.sexo] || "").trim().toUpperCase().charAt(0),
            cpf: onlyDigits(String(parts[cols.cpf] || "").trim()),
            bairro: String(parts[cols.bairro] || "").trim(),
            numero: String(parts[cols.numero] || "").trim(),
            complemento: String(parts[cols.complemento] || "").trim(),
            telefone: onlyDigits(String(parts[cols.telefone] || "").trim())
          });
          count++;
        }

        if (count === 0) throw new Error("Nenhum cidadão encontrado em " + file.name);
        esusTotalCount += count;
        fnameEsus.textContent = esusTotalCount + " cidadãos carregados";
        
        const tag = document.createElement("span");
        tag.className = "esus-file-tag";
        tag.textContent = file.name + " (" + count + ")";
        esusFilesList.appendChild(tag);

        setMsg(msgEsus, "ok", esusTotalCount + " cidadãos vinculados carregados no total.");
        atualizarBtnLimparEsus();
        enableCard("card-campos-bpa");
      } catch (err) {
        setMsg(msgEsus, "err", "Erro ao ler " + file.name + ": " + err.message);
      }
    };
    reader.readAsText(file, "latin-1");
  }

  // ---------- Cruzar dados ----------
  const btnCruzar = document.getElementById("btnCruzar");
  const camposMsg = document.getElementById("camposMsg");

  btnCruzar.addEventListener("click", () => {
    clearMsg(camposMsg);

    const cnes = onlyDigits(document.getElementById("cnes").value);
    const cbo = onlyDigits(cboInput.value);
    const compMes = document.getElementById("competencia").value;
    const folhaIni = parseInt(document.getElementById("folhaIni").value, 10) || 1;
    const ibgeGlobal = onlyDigits(document.getElementById("ibgeMunicipio")?.value || "");

    if (cnes.length !== 7) { setMsg(camposMsg, "err", "CNES deve ter 7 dígitos."); return; }
    if (cbo.length !== 6) { setMsg(camposMsg, "err", "CBO deve ter 6 dígitos."); return; }
    if (!compMes) { setMsg(camposMsg, "err", "Informe a competência."); return; }
    if (miguellinRows.length === 0) { setMsg(camposMsg, "err", "Importe a planilha MIGUELLIN primeiro."); return; }
    if (esusMap.size === 0) { setMsg(camposMsg, "err", "Importe o CSV do e-SUS primeiro."); return; }

    pacientes = miguellinRows.map((row, idx) => {
      const chave = chaveCruzamento(row.nome, row.nasc);
      const match = esusMap.get(chave);
      return {
        id: idx,
        nome: row.nome,
        nasc: row.nasc,
        comunidade: row.comunidade,
        match: !!match,
        cns: match ? match.cns : "",
        microarea: match ? match.microarea : "",
        equipe: match ? match.equipe : "",
        endereco: match ? match.endereco : "",
        ibge: (match && match.ibge) ? match.ibge : ibgeGlobal,
        cep: match ? match.cep : "",
        sexo: match ? match.sexo : "",
        cpf: match ? match.cpf : "",
        bairro: match ? match.bairro : "",
        numero: match ? match.numero : "",
        complemento: match ? match.complemento : "",
        telefone: match ? match.telefone : "",
        naoCompareceu: false,
        dataAtendimento: "", // dd/mm/yyyy - preenchido na consulta
        procedimentos: [] // Array de { sigtap, descricao }
      };
    });

    renderTriagem();
    document.getElementById("viewConfig").classList.add("hidden");
    document.getElementById("viewTriagem").classList.remove("hidden");
  });

  // ---------- Consulta ----------
  const triagemBody = document.getElementById("triagemBody");
  const fBusca = document.getElementById("fBusca");
  const btnVoltarConfig = document.getElementById("btnVoltarConfig");
  const btnGerarBpa = document.getElementById("btnGerarBpa");
  const triagemMsg = document.getElementById("triagemMsg");

  fBusca.addEventListener("input", renderTriagem);
  btnVoltarConfig.addEventListener("click", () => {
    document.getElementById("viewTriagem").classList.add("hidden");
    document.getElementById("viewConfig").classList.remove("hidden");
  });

  function renderTriagem() {
    const termo = normalizeNome(fBusca.value);
    const filtered = termo
      ? pacientes.filter(p => normalizeNome(p.nome).includes(termo))
      : pacientes;

    const totalMatch = pacientes.filter(p => p.match).length;
    const totalNoMatch = pacientes.length - totalMatch;
    document.getElementById("statTotal").textContent = pacientes.length + " total";
    document.getElementById("statMatch").textContent = totalMatch + " vinculados";
    document.getElementById("statNoMatch").textContent = totalNoMatch + " sem vínculo";
    document.getElementById("triagemTitulo").textContent = filtered.length + " paciente(s) exibido(s)";

    let html = "";
    filtered.forEach((p, idx) => {
      const realIdx = pacientes.indexOf(p);
      const disabledClass = p.naoCompareceu ? "row-disabled" : "";
      const infoExtra = p.match
        ? '<span class="lbl">CNS:</span> ' + escapeHtml(p.cns || "—") +
          '<span class="lbl">Microárea:</span> ' + escapeHtml(p.microarea || "—") +
          '<span class="lbl">Equipe:</span> ' + escapeHtml(p.equipe || "—")
        : '<span style="color:var(--warn)">⚠ Não vinculado</span>';

      let btnPreencherHtml = "";
      if (!p.match && !p.naoCompareceu) {
        btnPreencherHtml = '<button class="btn btn-primary btn-xs btn-preencher" data-idx="' + realIdx + '">+ Preencher</button>';
      }
      // Botão editar endereço se vazio
      let btnEnderecoHtml = "";
      if (!p.naoCompareceu && (!p.endereco || !p.bairro)) {
        btnEnderecoHtml = '<button class="btn btn-warn btn-xs btn-edit-end" data-idx="' + realIdx + '" title="Editar endereço">📍 Endereço</button>';
      }

      // Renderizar procedimentos como tags
      let procHtml = "";
      if (!p.naoCompareceu) {
        p.procedimentos.forEach((proc, pIdx) => {
          procHtml += '<span class="proc-tag">' + escapeHtml(proc.descricao) + 
                      ' <button class="proc-remove" data-pidx="' + realIdx + '" data-procid="' + pIdx + '">✕</button></span>';
        });
        procHtml += '<div class="proc-actions">' +
                    '<button class="btn btn-ghost-dark btn-xs btn-add-proc" data-type="consulta" data-pidx="' + realIdx + '">+ Consulta</button>' +
                    '<button class="btn btn-ghost-dark btn-xs btn-add-proc" data-type="oculos" data-pidx="' + realIdx + '">+ Óculos</button>' +
                    '<button class="btn btn-ghost-dark btn-xs btn-add-proc" data-type="retina" data-pidx="' + realIdx + '">+ Retina</button>' +
                    '<button class="btn btn-ghost-dark btn-xs btn-add-proc" data-type="cores" data-pidx="' + realIdx + '">+ Cores</button>' +
                    '<button class="btn btn-ghost-dark btn-xs btn-add-proc" data-type="ortoptico" data-pidx="' + realIdx + '">+ Ortopt.</button>' +
                    '<button class="btn btn-ghost-dark btn-xs btn-add-proc" data-type="tonometria" data-pidx="' + realIdx + '">+ Tonometria</button>' +
                    '</div>';
      } else {
        procHtml = '<span style="color:var(--text-muted);font-size:.8rem;">Não compareceu</span>';
      }

      const dataAtendVal = p.dataAtendimento || "";
      const dataAtendInput = '<input type="date" class="input-data-atend" data-id="' + p.id + '" value="' + (dataAtendVal ? dataAtendVal.split('/').reverse().join('-') : '') + '"' + (p.naoCompareceu ? ' disabled' : '') + '>';
      html += '<tr class="' + disabledClass + '" data-id="' + p.id + '">' +
        '<td class="col-data">' + dataAtendInput + '</td>' +
        '<td>' + escapeHtml(p.nome) + '</td>' +
        '<td>' + escapeHtml(p.nasc) + '</td>' +
        '<td><div class="info-extra">' + infoExtra + '</div>' + btnPreencherHtml + btnEnderecoHtml + '</td>' +
        '<td class="col-check"><div class="check-cell"><input type="checkbox" data-field="naoCompareceu" data-id="' + p.id + '"' + (p.naoCompareceu ? " checked" : "") + '></div></td>' +
        '<td class="col-procs">' + procHtml + '</td>' +
        '</tr>';
    });
    triagemBody.innerHTML = html;

    // Bind eventos
    triagemBody.querySelectorAll('.btn-preencher').forEach(btn => {
      btn.addEventListener('click', () => abrirModalOrigem(parseInt(btn.dataset.idx, 10)));
    });

    triagemBody.querySelectorAll('.btn-edit-end').forEach(btn => {
      btn.addEventListener('click', () => abrirModalEndereco(parseInt(btn.dataset.idx, 10)));
    });

    triagemBody.querySelectorAll('.btn-add-proc').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pidx = parseInt(btn.dataset.pidx, 10);
        const type = btn.dataset.type;
        adicionarProcedimento(pidx, type);
      });
    });

    triagemBody.querySelectorAll('.proc-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pidx = parseInt(btn.dataset.pidx, 10);
        const procid = parseInt(btn.dataset.procid, 10);
        removerProcedimento(pidx, procid);
      });
    });

    triagemBody.querySelectorAll('.input-data-atend').forEach(inp => {
      inp.addEventListener('change', (e) => {
        const id = parseInt(e.target.dataset.id, 10);
        const p = pacientes.find(x => x.id === id);
        if (!p) return;
        const val = e.target.value; // yyyy-mm-dd
        if (val) {
          const parts = val.split('-');
          p.dataAtendimento = parts[2] + '/' + parts[1] + '/' + parts[0];
        } else {
          p.dataAtendimento = '';
        }
      });
    });

    triagemBody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener("change", (e) => {
        const id = parseInt(e.target.dataset.id, 10);
        const field = e.target.dataset.field;
        const p = pacientes.find(x => x.id === id);
        if (!p) return;

        if (field === "naoCompareceu") {
          p.naoCompareceu = e.target.checked;
          if (p.naoCompareceu) {
            p.procedimentos = []; // Limpa procedimentos se não compareceu
          }
        }
        renderTriagem();
      });
    });
  }

  function adicionarProcedimento(pidx, type) {
    const p = pacientes[pidx];
    if (!p || p.naoCompareceu) return;

    const sigtapConsulta = onlyDigits(sigtapConsultaInput.value);
    const sigtapOculos = onlyDigits(sigtapOculosInput.value);

    let sigtap = "";
    let descricao = "";

    if (type === "consulta") {
      if (sigtapConsulta.length !== 10) { alert("Configure o SIGTAP de Consulta (10 dígitos) na tela inicial."); return; }
      sigtap = sigtapConsulta;
      descricao = "Consulta Oftalmo";
    } else if (type === "oculos") {
      if (sigtapOculos.length !== 10) { alert("Configure o SIGTAP de Óculos (10 dígitos) na tela inicial."); return; }
      sigtap = sigtapOculos;
      descricao = "Concessão Óculos";
    } else if (type === "retina") {
      sigtap = "0211060127";
      descricao = "Mapeamento Retina";
    } else if (type === "cores") {
      sigtap = "0211060224";
      descricao = "Visão de Cores";
    } else if (type === "ortoptico") {
      sigtap = "0211060232";
      descricao = "Teste Ortoptico";
    } else if (type === "tonometria") {
      sigtap = "0211060259";
      descricao = "Tonometria";
    }

    p.procedimentos.push({ sigtap, descricao });
    renderTriagem();
  }

  function removerProcedimento(pidx, procid) {
    const p = pacientes[pidx];
    if (!p) return;
    p.procedimentos.splice(procid, 1);
    renderTriagem();
  }

  // ---------- Gerar BPA-I ----------
  btnGerarBpa.addEventListener("click", () => {
    clearMsg(triagemMsg);

    const cnes = onlyDigits(document.getElementById("cnes").value);
    const cbo = onlyDigits(cboInput.value);
    const compMes = document.getElementById("competencia").value;
    const folhaIni = parseInt(document.getElementById("folhaIni").value, 10) || 1;
    const compYyyy = compMes.split("-")[0];
    const compMm = compMes.split("-")[1];
    const dataAtendPadrao = "01" + compMm + compYyyy; // fallback: primeiro dia da competência
    const cepPadrao = onlyDigits(document.getElementById('cepPadrao') ? document.getElementById('cepPadrao').value : '') || '35544000';
    const numAutorizacao = onlyDigits(document.getElementById('numAutorizacao') ? document.getElementById('numAutorizacao').value : '') || '';

    // Filtrar pacientes com procedimentos
    const ativos = pacientes.filter(p => !p.naoCompareceu && p.procedimentos.length > 0 && (p.match || p.vinculado));
    if (ativos.length === 0) {
      setMsg(triagemMsg, "err", "Nenhum paciente com procedimentos adicionados e vinculado ao e-SUS. Adicione procedimentos aos pacientes.");
      return;
    }

    // CNS Profissional obrigatório para BPA-I
    const cnsProfInput = document.getElementById('cnsProfissional');
    const cnsProf = onlyDigits(cnsProfInput ? cnsProfInput.value : '');
    if (!cnsProf || cnsProf.length !== 15) {
      setMsg(camposMsg, 'err', 'CNS Profissional é obrigatório e deve ter 15 dígitos para gerar o BPA-I.');
      if (cnsProfInput) cnsProfInput.focus();
      return;
    }

    // Validação pré-exportação: listar erros por registro
    const erros = [];
    ativos.forEach((p, idx) => {
      p.procedimentos.forEach(proc => {
        if (!proc.sigtap || proc.sigtap.length !== 10) erros.push({paciente: p.nome, erro: 'SIGTAP inválido (' + (proc.sigtap||'') + ')'});
        if (!p.dataAtendimento && !dataAtendPadrao) erros.push({paciente: p.nome, erro: 'Data de atendimento não informada'});
        if (!p.ibge || (p.ibge.length !== 6 && p.ibge.length !== 7)) erros.push({paciente: p.nome, erro: 'IBGE município inválido (' + (p.ibge||'') + '). Use 6 ou 7 dígitos.'});
        // Endereço e bairro: usar fallback do CEP padrão + município se vazios
        const endFinal = p.endereco || '';
        const baiFinal = p.bairro || '';
        if (!endFinal && !baiFinal && !cepPadrao) erros.push({paciente: p.nome, erro: 'Endereço e bairro vazios (preencha ou configure CEP padrão)'});
      });
    });
    if (erros.length > 0) {
      const msgErros = erros.slice(0, 10).map(e => e.paciente + ': ' + e.erro).join('\n');
      setMsg(triagemMsg, 'err', erros.length + ' erro(s) encontrado(s). Corrija antes de exportar:\n' + msgErros + (erros.length > 10 ? '\n...e mais ' + (erros.length - 10) : ''));
      return;
    }

    const semIdentificacao = ativos.filter(p => (!p.cns || p.cns.length < 15) && (!p.cpf || p.cpf.length < 11));
    if (semIdentificacao.length > 0) {
      setMsg(triagemMsg, 'warn', semIdentificacao.length + ' paciente(s) sem CNS nem CPF válido. Serão incluídos com identificação incompleta.');
    }

    // Agrupamento de folha/seq por chave (CNES + CBO + CNS Profissional)
    // Conforme regra SIA: mesma folha só contém registros da mesma chave
    const LINHAS_POR_FOLHA = 20;
    const linhas = [];
    let folha = folhaIni;
    let seq = 1;
    let contadorLinhaFolha = 0;
    let chaveAtual = cnes + '|' + cbo + '|' + cnsProf; // chave única por grupo

    function patchNum(line, start, len, valor) {
      let v = String(valor == null ? "" : valor).replace(/\D/g, "");
      if (!v) v = "0";
      if (v.length > len) v = v.slice(-len);
      v = v.padStart(len, "0");
      return line.slice(0, start) + v + line.slice(start + len);
    }
    function patchTxt(line, start, len, valor) {
      let v = String(valor == null ? "" : valor).toUpperCase();
      v = (v + " ".repeat(len)).slice(0, len);
      return line.slice(0, start) + v + line.slice(start + len);
    }
    // Parser de endereço: separa tipo de logradouro do nome da via
    // Ex: "Rua DR EZEQUIEL DE MACEDO" -> { tipo: "RUA", logradouro: "DR EZEQUIEL DE MACEDO" }
    const TIPOS_LOGRADOURO = ['RUA','AVENIDA','AV','TRAVESSA','TV','ALAMEDA','AL','ESTRADA','EST','RODOVIA','BR','PRACA','PC','LARGO','BECO','VIADUTO','PONTE','TUNEL','MORRO','COLINA','VALE','PARQUE','JARDIM','CONDOMINIO','CONJUNTO','RESIDENCIAL','VILA','DISTRITO','FAZENDA','SITIO','CHACARA','GLEBA','NUCLEO','SETOR','QUADRA','BLOCO','AREA'];
    function parseEndereco(enderecoCompleto) {
      if (!enderecoCompleto) return { tipo: '', logradouro: '' };
      const partes = String(enderecoCompleto).trim().split(/\s+/);
      const primeira = stripAccents(partes[0] || '').toUpperCase();
      if (TIPOS_LOGRADOURO.includes(primeira)) {
        return { tipo: primeira.substring(0, 3), logradouro: partes.slice(1).join(' ') };
      }
      return { tipo: '', logradouro: enderecoCompleto };
    }

    function montarLinhaBpaI(d) {
      let L = " ".repeat(351) + "N";
      L = patchTxt(L, 0, 2, d.tipo || "03");
      L = patchNum(L, 2, 7, d.cnes || "");
      L = patchNum(L, 9, 6, d.competencia || "");
      L = patchNum(L, 15, 15, d.cnsProfissional || "");
      L = patchNum(L, 30, 6, d.cbo || "");
      // Data no formato ddmmaaaa; se vier yyyy-mm-dd ou dd/mm/yyyy, converter
      let dt = String(d.dataAtendimento || "").replace(/\D/g, "");
      if (dt.length === 8 && parseInt(dt.slice(0,4),10) > 1900) {
        // yyyyMMdd -> ddMMyyyy
        dt = dt.slice(6,8) + dt.slice(4,6) + dt.slice(0,4);
      } else if (dt.length === 8 && parseInt(dt.slice(4,8),10) > 1900) {
        // ddMMyyyy já está correto
      } else {
        dt = "";
      }
      L = patchNum(L, 36, 8, dt);
      L = patchNum(L, 44, 3, d.folha || 1);
      L = patchNum(L, 47, 2, d.sequencia || 1);
      L = patchNum(L, 49, 10, d.sigtap || "");
      L = patchNum(L, 59, 15, d.cns || "");
      L = patchTxt(L, 74, 1, d.sexo || "");
      L = patchNum(L, 75, 6, d.ibge || "");
      L = patchTxt(L, 81, 4, d.cid || "");
      L = patchNum(L, 85, 9, d.numAutorizacao || "");
      L = patchNum(L, 94, 2, d.caraterAtendimento || "01");
      L = patchTxt(L, 112, 30, d.nome || "");
      L = patchNum(L, 142, 8, d.nasc || "");
      L = patchNum(L, 150, 2, d.racaCor || "99");
      L = patchTxt(L, 152, 4, d.etnia || "");
      L = patchNum(L, 156, 3, d.nacionalidade || "010");
      L = patchNum(L, 159, 3, d.servico || "");
      L = patchNum(L, 162, 3, d.classificacao || "");
      L = patchNum(L, 191, 8, d.cep || "");
      L = patchNum(L, 199, 3, d.codLogradouro || "");
      L = patchTxt(L, 202, 30, d.endereco || "");
      L = patchTxt(L, 232, 10, d.complemento || "");
      L = patchTxt(L, 242, 5, d.numero || "");
      L = patchTxt(L, 247, 30, d.bairro || "");
      L = patchNum(L, 277, 11, d.telefone || "");
      L = patchNum(L, 338, 11, d.cpfPaciente || "");
      return L;
    }

    ativos.forEach(p => {
      p.procedimentos.forEach(proc => {
        // Verificar se mudou a chave (não muda neste caso pois CNS Prof é global,
        // mas mantém a estrutura para quando houver múltiplos profissionais)
        const chavePaciente = cnes + '|' + cbo + '|' + cnsProf;
        if (chavePaciente !== chaveAtual) {
          folha++; seq = 1; contadorLinhaFolha = 0;
          chaveAtual = chavePaciente;
        }
        if (contadorLinhaFolha >= LINHAS_POR_FOLHA) {
          folha++; seq = 1; contadorLinhaFolha = 0;
        }

        // Separar CPF e CNS conforme regra SIA:
        // Se tem CNS válido (15 dígitos) -> pos 59; CPF vai para pos 338
        // Se NÃO tem CNS mas tem CPF -> CPF na pos 59, pos 338 vazia
        const temCnsValido = p.cns && p.cns.length === 15;
        const cnsCampo59 = temCnsValido ? p.cns : (p.cpf || '');
        const cpfCampo338 = temCnsValido ? (p.cpf || '') : '';

        // Mapa de procedimentos pré-estabelecidos com SERVIÇO, CLASSIFICAÇÃO e CID padrão
        const PROCEDIMENTOS_PRE = {
          '0701040050': { servico: '164', classificacao: '007', cid: 'H542' }, // Óculos >= 0.5 dioptrias
          '0211060127': { servico: '131', classificacao: '001', cid: '' },      // Mapeamento de retina
          '0211060224': { servico: '131', classificacao: '001', cid: '' },      // Teste de visão de cores
          '0211060232': { servico: '131', classificacao: '001', cid: '' },      // Teste ortóptico
          '0211060259': { servico: '131', classificacao: '001', cid: '' }       // Tonometria
        };
        const preDef = PROCEDIMENTOS_PRE[proc.sigtap] || {};
        const cidProc = proc.cid || preDef.cid || '';
        const servicoProc = proc.servico || preDef.servico || '';
        const classifProc = proc.classificacao || preDef.classificacao || '';

        // Parsing do endereço para separar tipo de logradouro
        const parsedEnd = parseEndereco(p.endereco);

        // Data de nascimento no formato ddmmyyyy
        let nascFmt = '';
        const nascStr = String(p.nasc || '').trim();
        const mNasc = nascStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (mNasc) {
          nascFmt = padLeft(mNasc[1], 2) + padLeft(mNasc[2], 2) + mNasc[3];
        } else {
          const mNasc2 = nascStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
          if (mNasc2) nascFmt = padLeft(mNasc2[3], 2) + padLeft(mNasc2[2], 2) + mNasc2[1];
        }

        const linha = montarLinhaBpaI({
          tipo: '03', cnes: cnes, competencia: compYyyy + compMm,
          cnsProfissional: cnsProf, cbo: cbo,
          dataAtendimento: p.dataAtendimento || dataAtendPadrao,
          folha: folha, sequencia: seq, sigtap: proc.sigtap,
          cns: cnsCampo59, sexo: p.sexo || '', ibge: p.ibge || '',
          caraterAtendimento: '01', nome: p.nome, nasc: nascFmt,
          racaCor: '03', nacionalidade: p.nacionalidade || '010',
          cep: p.cep || cepPadrao || '',
          codLogradouro: parsedEnd.tipo,
          endereco: parsedEnd.logradouro,
          complemento: p.complemento || '',
          numero: p.numero || '', bairro: p.bairro || '',
          telefone: p.telefone || '', cpfPaciente: cpfCampo338,
          numAutorizacao: numAutorizacao,
          cid: cidProc, servico: servicoProc, classificacao: classifProc
        });
        linhas.push(linha);
        seq++; contadorLinhaFolha++;
      });
    });

    const numLinhasTotal = linhas.length;
    const numFolhas = folha - folhaIni + 1;
    let headerLine = " ".repeat(349) + "N" + "  ";
    headerLine = patchTxt(headerLine, 0, 2, "01");
    headerLine = patchTxt(headerLine, 2, 5, "#BPA#");
    headerLine = patchNum(headerLine, 7, 6, compYyyy + compMm);
    headerLine = patchNum(headerLine, 13, 6, numLinhasTotal);
    headerLine = patchNum(headerLine, 19, 6, numFolhas);
    
    fileContent = headerLine + "\r\n" + linhas.join("\r\n") + "\r\n";
    fileName = "PA" + compYyyy + compMm + ".txt";

    document.getElementById("resultResumo").textContent =
      ativos.length + " paciente(s) faturado(s) em " + linhas.length + " linha(s) de produção, " + numFolhas + " folha(s).";
    
    const previewLines = linhas.slice(0, 6);
    let previewHtml = "";
    previewLines.forEach(l => { previewHtml += escapeHtml(l) + "\n"; });
    if (linhas.length > 6) previewHtml += "… mais " + (linhas.length - 6) + " linha(s) …";
    document.getElementById("rawPreview").textContent = previewHtml;
    document.getElementById("fileNameBadge").textContent = fileName;

    document.getElementById("viewTriagem").classList.add("hidden");
    document.getElementById("viewResultado").classList.remove("hidden");

    document.getElementById("btnDownload").onclick = () => {
      const blob = new Blob([fileContent], { type: "text/plain;charset=iso-8859-1" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg(document.getElementById("resultMsg"), "ok", "Arquivo baixado: " + fileName);
    };
  });

  // ---------- Modal Origem ----------
  function abrirModalOrigem(idx) {
    modalTargetIdx = idx;
    const p = idx >= 0 ? pacientes[idx] : null;
    const refHtml = p
      ? '<strong>' + escapeHtml(p.nome) + '</strong> · Nasc: ' + escapeHtml(p.nasc) + (p.comunidade ? ' · Comunidade: ' + escapeHtml(p.comunidade) : '')
      : '<strong>Novo cidadão</strong>';
    document.getElementById('modalOrigemTitulo').textContent = p ? 'Preencher dados' : 'Adicionar Cidadão';
    document.getElementById('modalOrigemLead').textContent = p
      ? 'Este paciente não foi encontrado nos arquivos do e-SUS. Escolha como deseja preencher os dados:'
      : 'Adicione um cidadão que não consta na planilha MIGUELLIN mas precisa ser incluído no BPA-I.';
    document.getElementById('manualRefInfo').innerHTML = refHtml;
    document.getElementById('esusRefInfo').innerHTML = refHtml;
    document.getElementById('modalOrigem').classList.remove('hidden');
  }

  function fecharTodosModais() {
    document.getElementById('modalOrigem').classList.add('hidden');
    document.getElementById('modalManual').classList.add('hidden');
    document.getElementById('modalEsus').classList.add('hidden');
    modalTargetIdx = -1;
  }

  ['btnFecharOrigem','btnFecharManual','btnCancelarManual','btnFecharEsus','btnCancelarEsus'].forEach(id => {
    document.getElementById(id).addEventListener('click', fecharTodosModais);
  });
  ['modalOrigem','modalManual','modalEsus'].forEach(id => {
    document.getElementById(id).addEventListener('click', (e) => { if (e.target.id === id) fecharTodosModais(); });
  });

  // ---------- Opção MANUAL ----------
  document.getElementById('btnOpcaoManual').addEventListener('click', () => {
    document.getElementById('modalOrigem').classList.add('hidden');
    limparFormManual();
    if (modalTargetIdx >= 0 && pacientes[modalTargetIdx]) {
      const p = pacientes[modalTargetIdx];
      document.getElementById('manNome').value = p.nome || '';
      document.getElementById('manNasc').value = p.nasc || '';
    }
    clearMsg(document.getElementById('manualMsg'));
    document.getElementById('modalManual').classList.remove('hidden');
  });

  function limparFormManual() {
    ['manNome','manNasc','manCns','manMicroarea','manEquipe','manEndereco'].forEach(id => {
      document.getElementById(id).value = '';
    });
  }

  document.getElementById('btnSalvarManual').addEventListener('click', () => {
    const nome = document.getElementById('manNome').value.trim();
    const nasc = normalizeDataNasc(document.getElementById('manNasc').value.trim());
    const cns = onlyDigits(document.getElementById('manCns').value);
    if (!nome) { setMsg(document.getElementById('manualMsg'), 'err', 'Nome é obrigatório.'); return; }
    if (!nasc || nasc.length < 8) { setMsg(document.getElementById('manualMsg'), 'err', 'Data de nascimento inválida.'); return; }
    aplicarDadosPaciente(modalTargetIdx, {
      nome, nasc, cns: cns || '',
      microarea: document.getElementById('manMicroarea').value.trim(),
      equipe: document.getElementById('manEquipe').value.trim(),
      endereco: document.getElementById('manEndereco').value.trim(),
      origem: 'manual'
    });
    fecharTodosModais();
    renderTriagem();
  });

  // ---------- Opção ESUS PEC ----------
  document.getElementById('btnOpcaoEsus').addEventListener('click', () => {
    document.getElementById('modalOrigem').classList.add('hidden');
    esusList = [];
    esusMap.forEach(v => esusList.push(v));
    document.getElementById('buscaEsus').value = '';
    renderListaEsus(esusList);
    clearMsg(document.getElementById('esusModalMsg'));
    document.getElementById('modalEsus').classList.remove('hidden');
    setTimeout(() => document.getElementById('buscaEsus').focus(), 100);
  });

  function renderListaEsus(lista) {
    const tbody = document.getElementById('esusListaBody');
    tbody.innerHTML = '';
    if (lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:2rem;">Nenhum cidadão encontrado.</td></tr>';
      return;
    }
    lista.slice(0, 200).forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(c.nome) + '</td>' +
        '<td>' + escapeHtml(c.nasc) + '</td>' +
        '<td>' + escapeHtml(c.cns || '') + '</td>' +
        '<td class="col-check"><button class="btn btn-primary btn-xs btn-vincular-esus">Vincular</button></td>';
      tr.querySelector('.btn-vincular-esus').addEventListener('click', () => {
        aplicarDadosPaciente(modalTargetIdx, {
          nome: c.nome, nasc: c.nasc, cns: c.cns || '', cpf: c.cpf || '',
          ibge: c.ibge || '', cep: c.cep || '', cbo: c.cbo || '',
          microarea: c.microarea || '', equipe: c.equipe || '',
          origem: 'esus'
        });
        fecharTodosModais();
        renderTriagem();
      });
      tbody.appendChild(tr);
    });
    if (lista.length > 200) {
      setMsg(document.getElementById('esusModalMsg'), 'warn', 'Mostrando 200 de ' + lista.length + ' resultados. Refine a busca.');
    } else {
      clearMsg(document.getElementById('esusModalMsg'));
    }
  }

  document.getElementById('buscaEsus').addEventListener('input', (e) => {
    const q = stripAccents(e.target.value.trim().toLowerCase());
    if (!q) { renderListaEsus(esusList); return; }
    const filtrados = esusList.filter(c =>
      stripAccents(c.nome || '').toLowerCase().includes(q) ||
      (c.cns || '').includes(q) ||
      (c.cpf || '').includes(q)
    );
    renderListaEsus(filtrados);
  });

  // ---------- Aplicar dados ao paciente ----------
  function aplicarDadosPaciente(idx, dados) {
    if (idx >= 0 && pacientes[idx]) {
      const p = pacientes[idx];
      p.nome = dados.nome || p.nome;
      p.nasc = dados.nasc || p.nasc;
      p.cns = dados.cns || p.cns || '';
      p.cpf = dados.cpf || p.cpf || '';
      p.ibge = dados.ibge || p.ibge || '';
      p.cep = dados.cep || p.cep || '';
      p.cbo = dados.cbo || p.cbo || '';
      p.microarea = dados.microarea || p.microarea || '';
      p.equipe = dados.equipe || p.equipe || '';
      p.match = true;
      p.vinculado = true;
      p.origemVinculo = dados.origem || 'manual';
    } else {
      pacientes.push({
        id: pacientes.length,
        nome: dados.nome, nasc: dados.nasc,
        cns: dados.cns || '', cpf: dados.cpf || '',
        ibge: dados.ibge || '', cep: dados.cep || '',
        cbo: dados.cbo || '', microarea: dados.microarea || '',
        equipe: dados.equipe || '', comunidade: '',
        match: true, vinculado: true,
        origemVinculo: dados.origem || 'manual',
        naoCompareceu: false, procedimentos: []
      });
    }
  }

  // ---------- Botão + Adicionar Cidadão ----------
  document.getElementById('btnAddCidadao').addEventListener('click', () => {
    abrirModalOrigem(-1);
  });

  // ---------- Voltar à consulta ----------
  document.getElementById('btnVoltarTriagem').addEventListener('click', () => {
    document.getElementById('viewResultado').classList.add('hidden');
    document.getElementById('viewTriagem').classList.remove('hidden');
  });

  // ---------- Modal Info SIGTAP ----------
  const MAPA_SIGTAP_DESCRICAO = {
    '0301010072': 'Consulta Médica em Atenção Especializada (Oftalmologia)',
    '0701040050': 'Concessão de Óculos com Lentes Corretivas (>= 0,5 dioptrias)',
    '0211060127': 'Mapeamento de Retina',
    '0211060224': 'Teste de Visão de Cores (Ishihara)',
    '0211060232': 'Teste Ortoptico / Avaliação Sensorial Motora',
    '0211060259': 'Tonometria de Aplanação'
  };

  function abrirModalInfoSigtap() {
    const tbody = document.getElementById('infoSigtapBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Coletar SIGTAPs únicos utilizados nos pacientes ativos ou na config
    const sigtapsUsados = new Set();
    const sCons = document.getElementById('sigtapConsulta')?.value?.trim();
    const sOcul = document.getElementById('sigtapOculos')?.value?.trim();
    if (sCons) sigtapsUsados.add(sCons);
    if (sOcul) sigtapsUsados.add(sOcul);
    pacientes.forEach(p => {
      if (p.procedimentos) p.procedimentos.forEach(proc => {
        if (proc.sigtap) sigtapsUsados.add(proc.sigtap);
      });
    });

    // Ordenar e renderizar
    const lista = Array.from(sigtapsUsados).sort();
    if (lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;padding:16px;">Nenhum procedimento registrado.</td></tr>';
    } else {
      lista.forEach(cod => {
        const desc = MAPA_SIGTAP_DESCRICAO[cod] || 'Procedimento não catalogado nesta versão.';
        const tr = document.createElement('tr');
        tr.innerHTML = '<td style="font-family:monospace;font-weight:600;white-space:nowrap;">' + escapeHtml(cod) + '</td>' +
                       '<td>' + escapeHtml(desc) + '</td>';
        tbody.appendChild(tr);
      });
    }

    document.getElementById('modalInfoSigtap').classList.remove('hidden');
  }

  function fecharModalInfoSigtap() {
    document.getElementById('modalInfoSigtap').classList.add('hidden');
  }

  const btnInfo = document.getElementById('btnInfoSigtap');
  if (btnInfo) btnInfo.addEventListener('click', abrirModalInfoSigtap);
  const btnFecharInfo = document.getElementById('btnFecharInfoSigtap');
  if (btnFecharInfo) btnFecharInfo.addEventListener('click', fecharModalInfoSigtap);

  // ---------- Modal Editar Endereço ----------
  let idxEditEnd = -1;
  function abrirModalEndereco(idx) {
    idxEditEnd = idx;
    const p = pacientes[idx];
    if (!p) return;
    document.getElementById('endPacienteNome').textContent = p.nome + ' (' + p.nasc + ')';
    document.getElementById('editEndLogradouro').value = p.endereco || '';
    document.getElementById('editEndNumero').value = p.numero || '';
    document.getElementById('editEndComplemento').value = p.complemento || '';
    document.getElementById('editEndBairro').value = p.bairro || '';
    document.getElementById('editEndCep').value = p.cep || document.getElementById('cepPadrao')?.value || '';
    document.getElementById('modalEditEndereco').classList.remove('hidden');
  }
  function salvarEndereco() {
    if (idxEditEnd < 0) return;
    const p = pacientes[idxEditEnd];
    if (!p) return;
    p.endereco = document.getElementById('editEndLogradouro').value.trim();
    p.numero = document.getElementById('editEndNumero').value.trim();
    p.complemento = document.getElementById('editEndComplemento').value.trim();
    p.bairro = document.getElementById('editEndBairro').value.trim();
    p.cep = onlyDigits(document.getElementById('editEndCep').value);
    fecharModalEndereco();
    renderTriagem();
  }
  function fecharModalEndereco() {
    idxEditEnd = -1;
    document.getElementById('modalEditEndereco').classList.add('hidden');
  }
  const btnSalvarEnd = document.getElementById('btnSalvarEndereco');
  if (btnSalvarEnd) btnSalvarEnd.addEventListener('click', salvarEndereco);
  const btnCancelarEnd = document.getElementById('btnCancelarEndereco');
  if (btnCancelarEnd) btnCancelarEnd.addEventListener('click', fecharModalEndereco);
  const btnFecharEnd = document.getElementById('btnFecharEndereco');
  if (btnFecharEnd) btnFecharEnd.addEventListener('click', fecharModalEndereco);
  const btnOkInfo = document.getElementById('btnOkInfoSigtap');
  if (btnOkInfo) btnOkInfo.addEventListener('click', fecharModalInfoSigtap);

})();