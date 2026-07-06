(function(){
  "use strict";

  // ---------- state ----------
  let rows = [];          // {sigtap, descricao, quantidade}
  let skippedCount = 0;
  let workbookHeaderInfo = "";

  // ---------- helpers ----------
  function onlyDigits(s){ return String(s == null ? "" : s).replace(/\D/g,""); }
  function stripAccents(s){ return String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,""); }
  function padLeft(v, len, ch){ ch = ch || "0"; v = String(v); return v.length >= len ? v.slice(-len) : ch.repeat(len - v.length) + v; }
  function padRight(v, len, ch){ ch = ch || " "; v = String(v); return v.length >= len ? v.slice(0, len) : v + ch.repeat(len - v.length); }
  function setMsg(el, type, text){
    el.className = "msg show " + type;
    el.textContent = text;
  }
  function clearMsg(el){ el.className = "msg"; el.textContent = ""; }
  function enableCard(id){ document.getElementById(id).classList.remove("disabled"); }

  // ---------- STEP 1: upload ----------
  const drop = document.getElementById("drop");
  const fileInput = document.getElementById("fileInput");
  const fname = document.getElementById("fname");
  const uploadMsg = document.getElementById("uploadMsg");

  ["dragenter","dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave","drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", e => {
    if (e.dataTransfer.files.length){ fileInput.files = e.dataTransfer.files; handleFile(e.dataTransfer.files[0]); }
  });
  fileInput.addEventListener("change", () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });

  let parsedRaw = null; // {sigtapCol, quantCol, descCol, dataRows}

  function handleFile(file){
    fname.textContent = file.name;
    clearMsg(uploadMsg);
    const reader = new FileReader();
    reader.onload = function(e){
      try{
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const arr = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });

        // locate header row containing "SIGTAP"
        let headerRowIdx = -1, sigtapCol = -1, quantCol = -1, descCol = -1;
        for (let i = 0; i < arr.length; i++){
          const row = arr[i];
          for (let j = 0; j < row.length; j++){
            const cell = String(row[j]).trim().toUpperCase();
            if (cell === "SIGTAP"){ headerRowIdx = i; sigtapCol = j; }
          }
          if (headerRowIdx === i){
            for (let j = 0; j < row.length; j++){
              const cell = String(row[j]).trim().toUpperCase();
              if (cell.indexOf("QUANT") === 0) quantCol = j;
              if (cell.indexOf("DESCR") === 0) descCol = j;
            }
            break;
          }
        }

        if (headerRowIdx === -1 || quantCol === -1){
          setMsg(uploadMsg, "error", "Não encontrei as colunas \"SIGTAP\" e \"QUANTIDADE\" na planilha. Verifique se o cabeçalho da tabela está presente.");
          return;
        }

        const dataRows = arr.slice(headerRowIdx + 1);
        parsedRaw = { sigtapCol, quantCol, descCol, dataRows };
        workbookHeaderInfo = sheetName;

        setMsg(uploadMsg, "ok", "Planilha carregada: \"" + sheetName + "\". Colunas identificadas — SIGTAP (col. " + (sigtapCol+1) + "), QUANTIDADE (col. " + (quantCol+1) + ")" + (descCol>-1 ? ", Descrição (col. " + (descCol+1) + ")" : "") + ".");
        enableCard("card-fields");
      } catch(err){
        setMsg(uploadMsg, "error", "Não foi possível ler o arquivo. Confirme que é um .xlsx válido. (" + err.message + ")");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ---------- STEP 2: campos + processar ----------
  const cnesInput = document.getElementById("cnes");
  const cboInput = document.getElementById("cbo");
  const compInput = document.getElementById("competencia");
  const folhaIniInput = document.getElementById("folhaIni");
  const fieldsMsg = document.getElementById("fieldsMsg");

  cnesInput.addEventListener("input", () => cnesInput.value = onlyDigits(cnesInput.value).slice(0,7));
  cboInput.addEventListener("input", () => cboInput.value = onlyDigits(cboInput.value).slice(0,6));

  document.getElementById("btnProcess").addEventListener("click", () => {
    clearMsg(fieldsMsg);
    let ok = true;
    const markInvalid = (fieldId, invalid) => {
      const el = document.getElementById(fieldId);
      el.classList.toggle("invalid", invalid);
    };

    const cnes = cnesInput.value;
    const cbo = cboInput.value;
    const comp = compInput.value;
    const folhaIni = parseInt(folhaIniInput.value || "1", 10);

    markInvalid("f-cnes", cnes.length !== 7); if (cnes.length !== 7) ok = false;
    markInvalid("f-cbo", cbo.length !== 6); if (cbo.length !== 6) ok = false;
    markInvalid("f-comp", !comp); if (!comp) ok = false;
    markInvalid("f-folha", !(folhaIni >= 1 && folhaIni <= 999)); if (!(folhaIni >= 1 && folhaIni <= 999)) ok = false;

    if (!parsedRaw){
      setMsg(fieldsMsg, "error", "Envie a planilha antes de processar.");
      return;
    }
    if (!ok){
      setMsg(fieldsMsg, "error", "Confira os campos destacados: CNES (7 dígitos), CBO (6 dígitos), competência e folha inicial.");
      return;
    }

    // build rows from parsedRaw
    rows = [];
    skippedCount = 0;
    parsedRaw.dataRows.forEach(row => {
      const rawSig = row[parsedRaw.sigtapCol];
      const rawQty = row[parsedRaw.quantCol];
      const digits = onlyDigits(rawSig);
      const qty = Math.round(Number(rawQty));

      if (!digits || digits.length > 10 || !qty || qty <= 0 || isNaN(qty)){
        if (String(rawSig).trim() !== "" || String(rawQty).trim() !== "") skippedCount++;
        return;
      }
      rows.push({
        sigtap: padLeft(digits, 10),
        descricao: parsedRaw.descCol > -1 ? String(row[parsedRaw.descCol] || "").trim() : "",
        quantidade: Math.min(qty, 999999)
      });
    });

    rows.sort((a,b) => a.sigtap.localeCompare(b.sigtap));

    if (rows.length === 0){
      setMsg(fieldsMsg, "error", "Nenhuma linha válida encontrada (código SIGTAP + quantidade). Confira a planilha.");
      return;
    }

    setMsg(fieldsMsg, "ok", rows.length + " procedimentos identificados" + (skippedCount ? " — " + skippedCount + " linha(s) ignorada(s) por falta de código ou quantidade." : "."));
    assignFolhas();
    renderPreview();
    enableCard("card-preview");
    document.getElementById("card-preview").scrollIntoView({behavior:"smooth", block:"start"});
  });

  function assignFolhas(){
    const folhaIni = parseInt(folhaIniInput.value || "1", 10);
    rows.forEach((r, idx) => {
      r.folha = folhaIni + Math.floor(idx / 20);
      r.seq = (idx % 20) + 1;
    });
  }

  // ---------- STEP 3: preview / edição ----------
  const previewBody = document.getElementById("previewBody");
  const previewMsg = document.getElementById("previewMsg");

  function renderPreview(){
    assignFolhas();
    previewBody.innerHTML = "";
    const cbo = cboInput.value;
    let totalQty = 0;

    rows.forEach((r, idx) => {
      totalQty += r.quantidade;
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td class="num">' + padLeft(r.folha,3) + '</td>' +
        '<td class="num">' + padLeft(r.seq,2) + '</td>' +
        '<td class="num">' + r.sigtap + '</td>' +
        '<td class="desc">' + (r.descricao || "—") + '</td>' +
        '<td class="num">' + cbo + '</td>' +
        '<td><input class="qty" type="number" min="1" max="999999" data-idx="' + idx + '" value="' + r.quantidade + '"></td>' +
        '<td><button class="rm-btn" data-idx="' + idx + '" title="Remover linha">✕</button></td>';
      previewBody.appendChild(tr);
    });

    document.getElementById("statCount").textContent = rows.length;
    document.getElementById("statQty").textContent = totalQty.toLocaleString("pt-BR");
    document.getElementById("statFolhas").textContent = Math.ceil(rows.length / 20);
    document.getElementById("statSkipped").textContent = skippedCount;

    previewBody.querySelectorAll("input.qty").forEach(inp => {
      inp.addEventListener("change", () => {
        const i = parseInt(inp.dataset.idx, 10);
        let v = Math.round(Number(inp.value));
        if (!v || v <= 0) v = 1;
        v = Math.min(v, 999999);
        rows[i].quantidade = v;
        inp.value = v;
        renderPreview();
      });
    });
    previewBody.querySelectorAll(".rm-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.idx, 10);
        rows.splice(i, 1);
        renderPreview();
      });
    });
  }

  // ---------- STEP 4: gerar arquivo ----------
  document.getElementById("btnGenerate").addEventListener("click", () => {
    clearMsg(previewMsg);
    if (rows.length === 0){
      setMsg(previewMsg, "error", "Não há procedimentos para gerar o arquivo.");
      return;
    }

    const cnes = cnesInput.value;
    const cbo = cboInput.value;
    const competencia = compInput.value.replace("-", ""); // AAAAMM

    const orgOrigem = stripAccents(document.getElementById("orgOrigem").value || "").toUpperCase();
    const siglaOrigem = stripAccents(document.getElementById("siglaOrigem").value || "").toUpperCase();
    const cgcCpf = onlyDigits(document.getElementById("cgcCpf").value || "");
    const orgDestino = stripAccents(document.getElementById("orgDestino").value || "").toUpperCase();
    const indDestino = document.getElementById("indDestino").value || "M";
    const versaoSis = stripAccents(document.getElementById("versaoSis").value || "").toUpperCase();

    // --- linhas de produção (tipo 02) ---
    const detailLines = rows.map(r => {
      return "02"
        + padLeft(cnes, 7)
        + padLeft(competencia, 6)
        + padLeft(cbo, 6)
        + padLeft(r.folha, 3)
        + padLeft(r.seq, 2)
        + padLeft(r.sigtap, 10)
        + "000"                              // idade — não exigida para a maioria dos exames laboratoriais
        + padLeft(r.quantidade, 6)
        + "BPA";
    });

    const numLinhas = detailLines.length;
    const numFolhas = Math.max.apply(null, rows.map(r => r.folha)) - parseInt(folhaIniInput.value || "1", 10) + 1;
    const CTRL = "1111"; // valor padrão dentro do domínio [1111..2221]

    const headerLine =
      "01" + "#BPA#"
      + padLeft(competencia, 6)
      + padLeft(numLinhas, 6)
      + padLeft(numFolhas, 6)
      + CTRL
      + padRight(orgOrigem, 30)
      + padRight(siglaOrigem, 6)
      + padLeft(cgcCpf, 14)
      + padRight(orgDestino, 40)
      + indDestino
      + padRight(versaoSis, 7)
      + "   ";

    const fileLines = [headerLine].concat(detailLines);
    const fileContent = fileLines.join("\r\n") + "\r\n";
    const fileName = "BPAC_" + cnes + "_" + competencia + ".txt";

    // raw preview
    const rawEl = document.getElementById("rawPreview");
    const rulerTop = "         1         2         3         4";
    const rulerBot = "1234567890123456789012345678901234567890";
    let previewLines = fileLines.slice(0, 6);
    let html = '<span class="ruler">' + rulerTop + '\n' + rulerBot + '</span>\n';
    previewLines.forEach((l, i) => {
      html += '<span class="l">' + padLeft(i, 2) + '</span>' + escapeHtml(l) + "\n";
    });
    if (fileLines.length > 6) html += '<span class="ruler">… mais ' + (fileLines.length - 6) + ' linha(s) …</span>';
    rawEl.innerHTML = html;

    document.getElementById("fileNameBadge").textContent = fileName;
    enableCard("card-result");
    document.getElementById("card-result").scrollIntoView({behavior:"smooth", block:"start"});

    document.getElementById("btnDownload").onclick = () => {
      const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg(document.getElementById("resultMsg"), "ok", "Arquivo baixado: " + fileName + " — " + numLinhas + " linhas de produção em " + numFolhas + " folha(s).");
    };
  });

  function escapeHtml(s){
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

})();
