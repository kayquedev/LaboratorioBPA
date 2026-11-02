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
    // Aceita Date, string dd/mm/aaaa, string aaaammdd
    if (val instanceof Date && !isNaN(val)) {
      const d = val.getDate(), m = val.getMonth() + 1, y = val.getFullYear();
      return padLeft(d, 2) + "/" + padLeft(m, 2) + "/" + y;
    }
    const s = String(val || "").trim();
    // dd/mm/aaaa ou dd-mm-aaaa
    const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m1) return padLeft(m1[1], 2) + "/" + padLeft(m1[2], 2) + "/" + m1[3];
    // aaaammdd
    if (/^\d{8}$/.test(s)) return s.slice(6, 8) + "/" + s.slice(4, 6) + "/" + s.slice(0, 4);
    return s;
  }

  function dataNascParaChave(ddmmyyyy) {
    // dd/mm/aaaa -> aaaammdd
    if (!ddmmyyyy || typeof ddmmyyyy !== "string") return "";
    const parts = ddmmyyyy.split("/");
    if (parts.length !== 3) return "";
    return parts[2] + parts[1] + parts[0];
  }

  function chaveCruzamento(nome, nasc) {
    return normalizeNome(nome) + "|" + dataNascParaChave(normalizeDataNasc(nasc));
  }

  // ---------- STEP 1: Config SIGTAP ----------
  const sigtapCompareceuInput = document.getElementById("sigtapCompareceu");
  const sigtapOculosInput = document.getElementById("sigtapOculos");
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

        // Header na linha 2 (0-indexed): QUANT | PACIENTE | NASC | COMUNIDADE
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

        // Encontrar header: linha com "Nome" e "Data de nascimento"
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
            cols.endereco = norm.findIndex(n => n === "ENDERECO" || n === "ENDEREÇO");
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
            endereco: String(parts[cols.endereco] || "").trim()
          });
          count++;
        }

        if (count === 0) throw new Error("Nenhum cidadão encontrado em " + file.name);
        esusTotalCount += count;
        fnameEsus.textContent = esusTotalCount + " cidadãos carregados";
        
        // Adicionar à lista visual de arquivos
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

    const sigtapComp = onlyDigits(sigtapCompareceuInput.value);
    const sigtapOcul = onlyDigits(sigtapOculosInput.value);
    const cnes = onlyDigits(document.getElementById("cnes").value);
    const cbo = onlyDigits(document.getElementById("cbo").value);
    const compMes = document.getElementById("competencia").value; // yyyy-mm
    const folhaIni = parseInt(document.getElementById("folhaIni").value, 10) || 1;

    if (sigtapComp.length !== 10) { setMsg(camposMsg, "err", "SIGTAP Compareceu deve ter 10 dígitos."); return; }
    if (sigtapOcul.length > 0 && sigtapOcul.length !== 10) { setMsg(camposMsg, "err", "SIGTAP Recebeu Óculos deve ter 10 dígitos (ou deixe vazio)."); return; }
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
        compareceu: false,
        naoCompareceu: false,
        recebeuOculos: false
      };
    });

    renderTriagem();
    document.getElementById("viewConfig").classList.add("hidden");
    document.getElementById("viewTriagem").classList.remove("hidden");
  });

  // ---------- Triagem ----------
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

      // Botão + Preencher para não vinculados (e não desabilitados por não-comparecimento)
      let btnPreencherHtml = "";
      if (!p.match && !p.naoCompareceu) {
        btnPreencherHtml = '<button class="btn btn-primary btn-xs btn-preencher" data-idx="' + realIdx + '">+ Preencher</button>';
      }

      html += '<tr class="' + disabledClass + '" data-id="' + p.id + '">' +
        '<td>' + escapeHtml(p.nome) + '</td>' +
        '<td>' + escapeHtml(p.nasc) + '</td>' +
        '<td><div class="info-extra">' + infoExtra + '</div>' + btnPreencherHtml + '</td>' +
        '<td class="col-check"><div class="check-cell"><input type="checkbox" data-field="compareceu" data-id="' + p.id + '"' + (p.compareceu ? " checked" : "") + '></div></td>' +
        '<td class="col-check"><div class="check-cell"><input type="checkbox" data-field="naoCompareceu" data-id="' + p.id + '"' + (p.naoCompareceu ? " checked" : "") + '></div></td>' +
        '<td class="col-check"><div class="check-cell"><input type="checkbox" data-field="recebeuOculos" data-id="' + p.id + '"' +
        (p.recebeuOculos ? " checked" : "") +
        (!p.compareceu ? " disabled" : "") +
        '></div></td>' +
        '</tr>';
    });
    triagemBody.innerHTML = html;

    // Bind eventos dos botões + Preencher
    triagemBody.querySelectorAll('.btn-preencher').forEach(btn => {
      btn.addEventListener('click', () => {
        abrirModalOrigem(parseInt(btn.dataset.idx, 10));
      });
    });

    // Bind eventos dos checkboxes
    triagemBody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener("change", (e) => {
        const id = parseInt(e.target.dataset.id, 10);
        const field = e.target.dataset.field;
        const p = pacientes.find(x => x.id === id);
        if (!p) return;

        if (field === "compareceu") {
          p.compareceu = e.target.checked;
          if (p.compareceu) {
            p.naoCompareceu = false;
          } else {
            // Desmarcou compareceu -> limpa e desabilita recebeuOculos
            p.recebeuOculos = false;
          }
        } else if (field === "naoCompareceu") {
          p.naoCompareceu = e.target.checked;
          if (p.naoCompareceu) {
            p.compareceu = false;
            p.recebeuOculos = false;
          }
        } else if (field === "recebeuOculos") {
          p.recebeuOculos = e.target.checked;
        }

        renderTriagem();
      });
    });
  }

  // ---------- Gerar BPA-I ----------
  btnGerarBpa.addEventListener("click", () => {
    clearMsg(triagemMsg);

    const sigtapComp = onlyDigits(sigtapCompareceuInput.value);
    const sigtapOcul = onlyDigits(sigtapOculosInput.value);
    const cnes = onlyDigits(document.getElementById("cnes").value);
    const cbo = onlyDigits(document.getElementById("cbo").value);
    const compMes = document.getElementById("competencia").value; // yyyy-mm
    const folhaIni = parseInt(document.getElementById("folhaIni").value, 10) || 1;
    const compYyyy = compMes.split("-")[0];
    const compMm = compMes.split("-")[1];
    // Data de atendimento padrão: primeiro dia da competência (formato ddmmaaaa)
    const dataAtendPadrao = "01" + compMm + compYyyy;

    // Filtrar apenas pacientes que compareceram
    const ativos = pacientes.filter(p => p.compareceu && (p.match || p.vinculado));
    if (ativos.length === 0) {
      setMsg(triagemMsg, "err", "Nenhum paciente com 'Compareceu' marcado e vinculado ao e-SUS. Marque pelo menos um paciente como Compareceu.");
      return;
    }

    // Verificar se há pacientes sem CNS
    const semCns = ativos.filter(p => !p.cns || p.cns.length < 15);
    if (semCns.length > 0) {
      setMsg(triagemMsg, "warn", semCns.length + " paciente(s) sem CNS válido serão incluídos com CNS em branco. Verifique os dados no e-SUS.");
    }

    // Construir linhas BPA-I
    // Formato BPA-I magnético (tipo 03) conforme layout DATASUS/SIA
    // Offsets validados contra parser.js / writer.js e arquivo real PA202606.txt
    const linhas = [];
    let seq = 1;
    let folha = folhaIni;
    const linhasPorFolha = 50;
    let contadorLinhaFolha = 0;

    ativos.forEach(p => {
      // Procedimento Compareceu
      const linhaComp = montarLinhaBpaI({
        tipo: "03",
        cnes: cnes,
        competencia: compYyyy + compMm,
        cnsProfissional: "",
        cbo: cbo,
        dataAtendimento: dataAtendPadrao,
        folha: padLeft(folha, 3),
        sequencia: padLeft(seq, 2),
        sigtap: sigtapComp,
        cns: p.cns || "",
        sexo: p.sexo || "",
        ibge: p.ibge || "",
        caraterAtendimento: "01",
        nome: p.nome,
        nasc: dataNascParaChave(p.nasc),
        racaCor: p.racaCor || "99",
        nacionalidade: p.nacionalidade || "010",
        cep: p.cep || "",
        codLogradouro: p.codLogradouro || "",
        endereco: p.endereco || "",
        complemento: p.complemento || "",
        numero: p.numero || "",
        bairro: p.bairro || "",
        telefone: p.telefone || "",
        cpfPaciente: p.cpf || ""
      });
      linhas.push(linhaComp);
      seq++;
      contadorLinhaFolha++;

      // Procedimento Recebeu Óculos (se marcado)
      if (p.recebeuOculos && sigtapOcul.length === 10) {
        if (contadorLinhaFolha >= linhasPorFolha) {
          folha++;
          contadorLinhaFolha = 0;
        }
        const linhaOcul = montarLinhaBpaI({
          tipo: "03",
          cnes: cnes,
          competencia: compYyyy + compMm,
          cnsProfissional: "",
          cbo: cbo,
          dataAtendimento: dataAtendPadrao,
          folha: padLeft(folha, 3),
          sequencia: padLeft(seq, 2),
          sigtap: sigtapOcul,
          cns: p.cns || "",
          sexo: p.sexo || "",
          ibge: p.ibge || "",
          caraterAtendimento: "01",
          nome: p.nome,
          nasc: dataNascParaChave(p.nasc),
          racaCor: p.racaCor || "99",
          nacionalidade: p.nacionalidade || "010",
          cep: p.cep || "",
          codLogradouro: p.codLogradouro || "",
          endereco: p.endereco || "",
          complemento: p.complemento || "",
          numero: p.numero || "",
          bairro: p.bairro || "",
          telefone: p.telefone || "",
          cpfPaciente: p.cpf || ""
        });
        linhas.push(linhaOcul);
        seq++;
        contadorLinhaFolha++;
      }

      if (contadorLinhaFolha >= linhasPorFolha) {
        folha++;
        contadorLinhaFolha = 0;
      }
    });

    // Montar cabeçalho (tipo 01) obrigatório no BPA magnético
    // Layout real: 01(2) + #BPA#(5) + competencia(6=aaaamm) + numLinhas(6) + numFolhas(6)
    // + codUnidade(4) + nomeUnidade(30) + cnesOrigem(7) + sistema(20)
    const numLinhasTotal = linhas.length;
    const numFolhas = folha - folhaIni + 1;
    const codUnidade = "1352"; // código da unidade (fixo ou configurável)
    const nomeUnidade = "SECRETARIA SAUDE";
    const cnesOrigem = cnes || "0000000";
    const sistema = "MANALYTICS";
    function padR(s, len) { let v = String(s == null ? "" : s); return v.length >= len ? v.slice(0, len) : v.padEnd(len, " "); }
    const headerLine = "01" +
      "#BPA#" +
      padLeft(compYyyy + compMm, 6) +
      padLeft(numLinhasTotal, 6) +
      padLeft(numFolhas, 6) +
      padR(codUnidade, 4) +
      padR(nomeUnidade, 30) +
      padLeft(cnesOrigem, 7) +
      padR(sistema, 20);
    fileContent = headerLine + "\r\n" + linhas.join("\r\n") + "\r\n";
    fileName = "PA" + compYyyy + compMm + ".txt";

    // Mostrar resultado
    document.getElementById("resultResumo").textContent =
      ativos.length + " paciente(s) faturado(s) em " + linhas.length + " linha(s) de produção, " + numFolhas + " folha(s).";
    
    // Prévia
    const previewLines = linhas.slice(0, 6);
    let previewHtml = "";
    previewLines.forEach(l => {
      previewHtml += escapeHtml(l) + "\n";
    });
    if (linhas.length > 6) previewHtml += "… mais " + (linhas.length - 6) + " linha(s) …";
    document.getElementById("rawPreview").textContent = previewHtml;
    document.getElementById("fileNameBadge").textContent = fileName;

    document.getElementById("viewTriagem").classList.add("hidden");
    document.getElementById("viewResultado").classList.remove("hidden");

    // Download button
    document.getElementById("btnDownload").onclick = () => {
      // BPA magnético usa encoding latin-1 (ISO-8859-1), não UTF-8
      const blob = new Blob([fileContent], { type: "text/plain;charset=iso-8859-1" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg(document.getElementById("resultMsg"), "ok", "Arquivo baixado: " + fileName);
    };
  });

  function montarLinhaBpaI(d) {
    // Layout BPA-I magnético (tipo 03) - offsets exatos do parser.js / writer.js
    // Total: 352 bytes (349 dados + sufixo 'N' + padding). Gaps preenchidos com espaços.
    const buf = [];
    for (let i = 0; i < 352; i++) buf[i] = " ";
    function set(start, len, val, type) {
      let s = String(val == null ? "" : val);
      if (type === "num") s = s.replace(/\D/g, "");
      if (s.length > len) s = s.slice(0, len);
      else if (s.length < len) s = type === "num" ? s.padStart(len, "0") : s.padEnd(len, " ");
      for (let i = 0; i < len; i++) buf[start + i] = s[i];
    }
    set(0, 2, d.tipo || "03", "txt");           // tipo registro
    set(2, 7, d.cnes || "", "num");              // CNES
    set(9, 6, d.competencia || "", "num");       // competência aaaamm
    set(15, 15, d.cnsProfissional || "", "num"); // CNS profissional
    set(30, 6, d.cbo || "", "num");              // CBO
    set(36, 8, d.dataAtendimento || "", "num");  // data atendimento ddmmaaaa
    set(44, 3, d.folha || "001", "num");         // folha
    set(47, 2, d.sequencia || "01", "num");      // sequência
    set(49, 10, d.sigtap || "", "num");          // SIGTAP procedimento
    set(59, 15, d.cns || "", "num");             // CNS paciente
    set(74, 1, d.sexo || "", "txt");             // sexo (M/F)
    set(75, 6, d.ibge || "", "num");             // município IBGE
    set(81, 4, d.cid || "", "txt");              // CID-10
    // pos 85-93: reservado (espaços)
    set(94, 2, d.caraterAtendimento || "01", "num"); // caráter atendimento
    // pos 96-111: reservado (espaços)
    set(112, 30, d.nome || "", "txt");           // nome paciente
    set(142, 8, d.nasc || "", "num");            // data nascimento aaaammdd
    set(150, 2, d.racaCor || "99", "num");       // raça/cor
    set(152, 4, d.etnia || "", "txt");           // etnia
    set(156, 3, d.nacionalidade || "010", "num");// nacionalidade
    set(159, 3, d.servico || "", "num");         // serviço
    set(162, 3, d.classificacao || "", "num");   // classificação
    // pos 165-190: reservado (espaços)
    set(191, 8, d.cep || "", "num");             // CEP
    set(199, 3, d.codLogradouro || "", "num");   // código logradouro
    set(202, 30, d.endereco || "", "txt");       // endereço
    set(232, 10, d.complemento || "", "txt");    // complemento
    set(242, 5, d.numero || "", "txt");          // número
    set(247, 30, d.bairro || "", "txt");         // bairro
    set(277, 11, d.telefone || "", "num");       // telefone
    // pos 288-337: reservado (espaços)
    set(338, 11, d.cpfPaciente || "", "num");    // CPF paciente
    // Sufixo padrão do BPA-I magnético
    buf[349] = "N";
    return buf.join("");
  }

  // ---------- Modal Origem (escolha Manual vs e-SUS) ----------
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

  // ---------- Opção ESUS PEC (busca) ----------
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
      if (p.status === 'pendente') p.status = 'compareceu';
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
        compareceu: true, naoCompareceu: false, recebeuOculos: false
      });
    }
  }

  // ---------- Botão + Adicionar Cidadão (footer da triagem) ----------
  document.getElementById('btnAddCidadao').addEventListener('click', () => {
    abrirModalOrigem(-1);
  });

  // ---------- Voltar à triagem ----------
  document.getElementById('btnVoltarTriagem').addEventListener('click', () => {
    document.getElementById('viewResultado').classList.add('hidden');
    document.getElementById('viewTriagem').classList.remove('hidden');
  });

})();