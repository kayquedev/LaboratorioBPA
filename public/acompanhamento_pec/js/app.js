(function () {
  "use strict";

  const csv = window.CsvGenericoParser;

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function setMsg(el, type, text) { el.className = "msg show " + type; el.textContent = text; }
  function clearMsg(el) { el.className = "msg"; el.textContent = ""; }
  function fmtPct(n, total) { return total ? Math.round((n / total) * 100) : 0; }

  // -------- normalização / documentos --------
  function normalizarDocumento(v) { return (v || "").replace(/\D/g, ""); }
  function separarCpfCns(bruto) {
    const d = normalizarDocumento(bruto);
    if (d.length === 11) return { cpf: d, cns: "" };
    if (d.length === 15) return { cpf: "", cns: d };
    return { cpf: "", cns: "" };
  }
  function normalizarNome(nome) {
    return (nome || "")
      .normalize("NFD").replace(/\p{M}/gu, "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }
  function normalizarData(d) {
    // aceita "19/07/1998" (vinculados/condições) e "19-07-1998" (território)
    const m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec((d || "").trim());
    return m ? m[1] + "/" + m[2] + "/" + m[3] : "";
  }
  function chaveNome(nome, dataNascimento) {
    return normalizarNome(nome) + "|" + normalizarData(dataNascimento);
  }
  function parseDataBr(d) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((d || "").trim());
    if (!m) return null;
    return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  }

  const MICROAREA_INCONSISTENTE = new Set(["", "-", "NAO INFORMADA", "FA", "00", "--"]);
  function microareaInconsistente(m) { return MICROAREA_INCONSISTENTE.has(normalizarNome(m)); }

  // -------- cruzamento cascata CPF -> CNS -> nome+nascimento (condições de saúde) --------
  function construirMapas(linhas, getCpf, getCns, getNome, getNascimento) {
    const porCpf = new Map(), porCns = new Map(), porNome = new Map();
    linhas.forEach((l) => {
      const cpf = normalizarDocumento(getCpf(l));
      const cns = normalizarDocumento(getCns(l));
      const nome = getNome(l);
      if (!nome || nome === "-") return;
      if (cpf) porCpf.set(cpf, l);
      if (cns) porCns.set(cns, l);
      porNome.set(chaveNome(nome, getNascimento(l)), l);
    });
    return { porCpf, porCns, porNome };
  }
  function buscarCorrespondencia(mapas, cpf, cns, nome, nascimento) {
    if (cpf && mapas.porCpf.has(cpf)) return mapas.porCpf.get(cpf);
    if (cns && mapas.porCns.has(cns)) return mapas.porCns.get(cns);
    return mapas.porNome.get(chaveNome(nome, nascimento)) || null;
  }

  // -------- idade / faixa etária --------
  function idadeAnos(textoIdade) {
    const m = /^(\d+)\s*anos?/i.exec((textoIdade || "").trim());
    return m ? parseInt(m[1], 10) : 0;
  }
  function faixaEtaria(textoIdade) {
    const a = idadeAnos(textoIdade);
    if (a <= 4) return "0-4";
    if (a <= 9) return "5-9";
    if (a <= 14) return "10-14";
    if (a <= 19) return "15-19";
    if (a <= 39) return "20-39";
    if (a <= 59) return "40-59";
    return "60+";
  }

  // -------- ficha desatualizada: mais de 1 ano sem atualização cadastral --------
  function fichaDesatualizada(dataStr) {
    const d = parseDataBr(dataStr);
    if (!d) return false;
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    return d < cutoff;
  }

  // -------- território: domicílios, famílias, multi-domicílio --------
  function chaveEndereco(l) {
    return [l["TIPO DE LOGRADOURO"], l["LOGRADOURO"], l["NÚMERO"], l["COMPLEMENTO"], normalizarDocumento(l["CEP"])]
      .map((v) => (v || "").trim().toUpperCase()).join("|");
  }
  function enderecoLegivel(l) {
    const rua = [l["TIPO DE LOGRADOURO"], l["LOGRADOURO"]].filter((v) => v && v !== "-").join(" ");
    const numero = l["NÚMERO"] && l["NÚMERO"] !== "-" ? l["NÚMERO"] : "s/n";
    const compl = l["COMPLEMENTO"] && l["COMPLEMENTO"] !== "-" ? " - " + l["COMPLEMENTO"] : "";
    const bairro = l["BAIRRO"] && l["BAIRRO"] !== "-" ? " · " + l["BAIRRO"] : "";
    return (rua || "(sem logradouro)") + ", " + numero + compl + bairro;
  }
  // agrupa as linhas do território por domicílio (endereço) e por pessoa (documento, ou
  // nome+nascimento quando a linha não tem documento) - usado pra achar domicílio sem
  // morador, famílias e vínculo a mais de um domicílio ao mesmo tempo.
  function analisarTerritorio(linhas) {
    const porEndereco = new Map();
    linhas.forEach((l) => {
      const k = chaveEndereco(l);
      (porEndereco.get(k) || porEndereco.set(k, []).get(k)).push(l);
    });
    const enderecosVazios = [];
    let totalMoradores = 0;
    const familias = new Set();
    porEndereco.forEach((arr, k) => {
      const moradores = arr.filter((l) => l["NOME CIDADÃO"] && l["NOME CIDADÃO"] !== "-");
      if (!moradores.length) { enderecosVazios.push({ chave: k, linha: arr[0] }); return; }
      totalMoradores += moradores.length;
      moradores.forEach((l) => {
        const respDoc = normalizarDocumento(l["CPF/CNS RESPONSÁVEL FAMILIAR"]) || k;
        familias.add(k + "|" + respDoc);
      });
    });
    const porPessoa = new Map();
    linhas.forEach((l) => {
      const nome = l["NOME CIDADÃO"];
      if (!nome || nome === "-") return;
      const doc = normalizarDocumento(l["CPF"]) || normalizarDocumento(l["CNS"]);
      const chave = doc || ("NB:" + chaveNome(nome, l["DATA DE NASCIMENTO"]));
      let info = porPessoa.get(chave);
      if (!info) { info = { enderecos: new Set(), linhas: [] }; porPessoa.set(chave, info); }
      info.enderecos.add(chaveEndereco(l));
      info.linhas.push(l);
    });
    return {
      porEndereco, enderecosVazios, porPessoa,
      totalEnderecos: porEndereco.size,
      totalFamilias: familias.size,
      totalMoradores,
    };
  }
  function buscarPessoaTerritorio(analise, cpf, cns, nome, nascimento) {
    if (!analise) return null;
    if (cpf && analise.porPessoa.has(cpf)) return analise.porPessoa.get(cpf);
    if (cns && analise.porPessoa.has(cns)) return analise.porPessoa.get(cns);
    return analise.porPessoa.get("NB:" + chaveNome(nome, nascimento)) || null;
  }

  // -------- catálogo de pendências (regras sobre o cadastro do cidadão) --------
  const PENDENCIA_CATALOG = {
    SEM_CPF_SEM_CNS: { sev: "erro", texto: "Sem CPF e sem CNS", fonte: "Condições de Saúde",
      explicacao: "Nenhum documento (CPF ou CNS) está registrado para este cidadão.",
      resolver: "Providencie o CNS (cartão SUS) ou o CPF do cidadão — sem documento o cadastro não pode ser vinculado corretamente." },
    SOMENTE_CNS: { sev: "aviso", texto: "Somente CNS (sem CPF)", fonte: "Condições de Saúde / Vinculados",
      explicacao: "O cadastro tem CNS mas não tem CPF registrado.",
      resolver: "Colete o CPF do cidadão no próximo atendimento ou na visita domiciliar." },
    CNS_PROVISORIO: { sev: "aviso", texto: "CNS provisório", fonte: "Condições de Saúde / Vinculados",
      explicacao: "O CNS cadastrado não segue o padrão de CNS definitivo (início \"7\").",
      resolver: "Confirme o CNS definitivo do cidadão no CADSUS / Cartão Nacional de Saúde." },
    MICROAREA_INCONSISTENTE: { sev: "erro", texto: "Microárea inconsistente (FA/NI)", fonte: "Vinculados",
      explicacao: "A microárea do cadastro está em branco, \"Não informada\" ou marcada como Fora de Área (FA).",
      resolver: "Defina a microárea correta na Ficha de Cadastro Individual, ou registre a saída se o cidadão não reside mais na área." },
    SEM_ENDERECO: { sev: "erro", texto: "Sem endereço cadastrado", fonte: "Vinculados",
      explicacao: "Nenhum endereço foi informado no cadastro.",
      resolver: "Colete o endereço do cidadão (ou registre situação de rua, se for o caso)." },
    ENDERECO_INCOMPLETO: { sev: "aviso", texto: "Endereço incompleto", fonte: "Condições de Saúde / Vinculados",
      explicacao: "Falta CEP, logradouro, bairro ou número no endereço cadastrado.",
      resolver: "Complete o endereço na Ficha de Cadastro Individual." },
    FICHA_DESATUALIZADA: { sev: "aviso", texto: "Ficha desatualizada (+1 ano)", fonte: "Vinculados",
      explicacao: "A última atualização cadastral tem mais de 1 ano.",
      resolver: "Revise e atualize a Ficha de Cadastro Individual (FCI) na próxima visita ou atendimento." },
    SEM_ATENDIMENTO: { sev: "erro", texto: "Sem nenhum atendimento registrado", fonte: "Condições de Saúde",
      explicacao: "Nenhum atendimento médico, de enfermagem, odontológico ou visita domiciliar encontrado no acompanhamento de condições de saúde.",
      resolver: "Verifique se o cidadão ainda reside na área; se sim, programe busca ativa." },
    SEM_FCI_APROXIMADO: { sev: "aviso", texto: "Sem FCI (aproximado)", fonte: "Condições de Saúde",
      explicacao: "O cidadão está vinculado, mas não aparece no relatório de Condições de Saúde — indício de que a Ficha de Cadastro Individual pode estar ausente. Este módulo não lê a FCI completa, só relatórios agregados do e-SUS, então é uma aproximação.",
      resolver: "Confira diretamente no e-SUS PEC se existe FCI cadastrada para este cidadão." },
    SEM_VINCULO_DOMICILIAR: { sev: "aviso", texto: "Sem vínculo domiciliar ativo", fonte: "Território",
      explicacao: "O cadastro está ativo mas não foi encontrado em nenhuma ficha de família/domicílio do território carregado.",
      resolver: "Verifique se o cidadão ainda reside na área e se o domicílio dele está mapeado no território." },
    MULTI_DOMICILIO: { sev: "erro", texto: "Vinculado a mais de 1 domicílio", fonte: "Território",
      explicacao: "O mesmo cidadão aparece em mais de uma ficha de domicílio ativa ao mesmo tempo, em endereços diferentes.",
      resolver: "Confira qual domicílio está correto e encerre o vínculo com o domicílio antigo no e-SUS PEC." },
    SEM_RESPONSAVEL_FAMILIAR: { sev: "aviso", texto: "Sem responsável familiar", fonte: "Território",
      explicacao: "O cidadão não está marcado como responsável familiar e a ficha de domicílio não informa o CPF/CNS de quem é.",
      resolver: "Confirme o responsável familiar na ficha de domicílio (FCD) no e-SUS PEC." },
  };
  const ORDEM_PENDENCIAS = [
    "SEM_CPF_SEM_CNS", "SOMENTE_CNS", "CNS_PROVISORIO", "MICROAREA_INCONSISTENTE",
    "SEM_ENDERECO", "ENDERECO_INCOMPLETO", "FICHA_DESATUALIZADA",
    "SEM_ATENDIMENTO", "SEM_FCI_APROXIMADO",
    "SEM_VINCULO_DOMICILIAR", "MULTI_DOMICILIO", "SEM_RESPONSAVEL_FAMILIAR",
  ];

  // -------- catálogo de duplicidades (comparação por texto exato, nunca CPF/CNS/fuzzy) --------
  const DUPLICIDADE_CATALOG = {
    NOME_NASCIMENTO: { texto: "Nome e data de nascimento iguais", prioridade: "media",
      explicacao: "Dois ou mais cidadãos vinculados têm o mesmo nome e a mesma data de nascimento, com documentos diferentes.",
      conduta: "Confirme CPF, CNS e telefone com o ACS/equipe responsável antes de unificar — pode ser coincidência real entre duas pessoas." },
    DOCUMENTO_IDENTICO: { texto: "Mesmo CPF/CNS em nomes diferentes", prioridade: "critica",
      explicacao: "O mesmo CPF ou CNS aparece vinculado a nomes diferentes.",
      conduta: "Verifique qual cadastro está correto e corrija/unifique diretamente no e-SUS PEC." },
  };

  // -------- estado --------
  const viewUpload = document.getElementById("viewUpload");
  const viewDashboard = document.getElementById("viewDashboard");
  const viewTabela = document.getElementById("viewTabela");
  const btnVoltar = document.getElementById("btnVoltarDashboard");
  const msgUpload = document.getElementById("msgUpload");

  let arquivoVinc = null;
  let arquivoCond = null;
  let arquivosTerr = [];
  let vinculados = [];
  let condicoesLinhas = [];
  let territorioLinhas = [];
  let indicadores = [];
  let duplicidades = [];
  let analiseTerritorioAtual = null;

  function lerTexto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function wireUpload(dropId, inputId, fnameId, multiplo, onFiles) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    const fname = fnameId ? document.getElementById(fnameId) : null;
    drop.addEventListener("click", () => input.click());
    ["dragover", "dragleave", "drop"].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.toggle("drag", ev === "dragover");
        if (ev === "drop" && e.dataTransfer.files.length) {
          onFiles(multiplo ? Array.from(e.dataTransfer.files) : [e.dataTransfer.files[0]]);
          if (fname) fname.textContent = Array.from(e.dataTransfer.files).map((f) => f.name).join(", ");
        }
      });
    });
    input.addEventListener("change", () => {
      if (!input.files.length) return;
      onFiles(multiplo ? Array.from(input.files) : [input.files[0]]);
      if (fname) fname.textContent = Array.from(input.files).map((f) => f.name).join(", ");
      input.value = "";
    });
  }

  const btnGerarPainel = document.getElementById("btnGerarPainel");

  wireUpload("dropVinc", "inputVinc", "fnameVinc", false, (files) => { arquivoVinc = files[0]; clearMsg(msgUpload); });
  wireUpload("dropCond", "inputCond", "fnameCond", false, (files) => { arquivoCond = files[0]; clearMsg(msgUpload); });
  wireUpload("dropTerr", "inputTerr", "fnameTerr", true, (files) => { arquivosTerr = arquivosTerr.concat(files); clearMsg(msgUpload); });
  wireUpload("dropTerrDashboard", "inputTerrDashboard", null, true, (files) => { arquivosTerr = arquivosTerr.concat(files); processar(); });

  btnGerarPainel.addEventListener("click", () => {
    if (!arquivoVinc) {
      setMsg(msgUpload, "error", "Selecione ao menos o arquivo de cidadãos vinculados antes de gerar o painel.");
      return;
    }
    processar();
  });

  function processar() {
    if (!arquivoVinc) return;
    clearMsg(msgUpload);

    const tarefas = [lerTexto(arquivoVinc).then((buf) => ({ tipo: "vinc", buf }))];
    if (arquivoCond) tarefas.push(lerTexto(arquivoCond).then((buf) => ({ tipo: "cond", buf })));
    arquivosTerr.forEach((f) => tarefas.push(lerTexto(f).then((buf) => ({ tipo: "terr", buf, nome: f.name }))));

    Promise.all(tarefas)
      .then((resultados) => {
        const rVinc = resultados.find((r) => r.tipo === "vinc");
        const parsedVinc = csv.parseCsv(csv.decodeArrayBuffer(rVinc.buf));
        if (parsedVinc.erro) { setMsg(msgUpload, "error", parsedVinc.erro); return; }
        if (!parsedVinc.linhas.length) {
          setMsg(msgUpload, "error", "Não encontrei nenhum cidadão vinculado no arquivo — confirme se é o export \"Acompanhamento de cidadãos vinculados\" correto.");
          return;
        }
        vinculados = parsedVinc.linhas;

        const rCond = resultados.find((r) => r.tipo === "cond");
        if (rCond) {
          const parsedCond = csv.parseCsv(csv.decodeArrayBuffer(rCond.buf));
          if (parsedCond.erro) { setMsg(msgUpload, "error", parsedCond.erro); return; }
          condicoesLinhas = parsedCond.linhas;
        } else {
          condicoesLinhas = [];
        }

        territorioLinhas = [];
        const rsTerr = resultados.filter((r) => r.tipo === "terr");
        rsTerr.forEach((r) => {
          const parsedTerr = csv.parseCsv(csv.decodeArrayBuffer(r.buf));
          if (parsedTerr.erro) return;
          const microarea = (parsedTerr.filtros["Microárea"] || "").trim();
          parsedTerr.linhas.forEach((l) => { l.__microareaArquivo = microarea; l.__arquivo = r.nome; });
          territorioLinhas = territorioLinhas.concat(parsedTerr.linhas);
        });

        renderDashboard();
        showDashboard();
      })
      .catch((err) => {
        setMsg(msgUpload, "error", "Erro ao ler o(s) arquivo(s): " + (err && err.message ? err.message : err));
      });
  }

  // -------- cálculo dos indicadores por vinculado --------
  function calcularIndicadores() {
    const mapasCond = condicoesLinhas.length
      ? construirMapas(condicoesLinhas, (l) => l["CPF"], (l) => l["CNS"], (l) => l["Nome"], (l) => l["Data de nascimento"])
      : null;

    return vinculados.map((v) => {
      const nome = v["Nome"];
      const nascimento = v["Data de nascimento"];
      const { cpf: cpfAprox, cns: cnsAprox } = separarCpfCns(v["CPF/CNS"]);
      const matchCond = mapasCond ? buscarCorrespondencia(mapasCond, cpfAprox, cnsAprox, nome, nascimento) : null;

      let cpf = cpfAprox, cns = cnsAprox;
      if (matchCond) { cpf = normalizarDocumento(matchCond["CPF"]); cns = normalizarDocumento(matchCond["CNS"]); }

      const somenteCns = !cpf && !!cns;
      const semCpfSemCns = !!matchCond && !cpf && !cns;
      const cnsProvisorio = !!cns && cns[0] !== "7";

      const endereco = (v["Endereço"] || "").trim();
      const semEndereco = !endereco || endereco === "-";
      let enderecoIncompleto = false;
      if (!semEndereco) {
        if (matchCond) {
          enderecoIncompleto = ["Rua", "Número", "Bairro", "CEP"].some((c) => !matchCond[c] || matchCond[c] === "-");
        } else {
          const temCep = /\d{5}-?\d{3}/.test(endereco);
          const temNumero = /,\s*\d+/.test(endereco) || /\bS\/?N\b/i.test(endereco);
          enderecoIncompleto = !temCep || !temNumero;
        }
      }

      const microareaRuim = microareaInconsistente(v["Microárea"]);
      const desatualizada = fichaDesatualizada(v["Última atualização cadastral"]);

      let semAtendimento = false, semFci = false;
      if (mapasCond) {
        if (matchCond) {
          const camposAtend = [
            "Dias desde o último atendimento médico", "Dias desde o último atendimento de enfermagem",
            "Dias desde o último atendimento odontológico", "Dias desde a última visita domiciliar",
          ];
          semAtendimento = camposAtend.every((campo) => !matchCond[campo] || matchCond[campo] === "-");
        } else {
          semFci = true; // nem aparece no relatorio de condicoes de saude
        }
      }

      let semVinculoDomiciliar = false, multiDomicilio = false, semResponsavelFamiliar = false;
      if (analiseTerritorioAtual) {
        const pessoaTerr = buscarPessoaTerritorio(analiseTerritorioAtual, cpf, cns, nome, nascimento);
        semVinculoDomiciliar = !pessoaTerr;
        if (pessoaTerr) {
          multiDomicilio = pessoaTerr.enderecos.size > 1;
          const linhaRef = pessoaTerr.linhas[0];
          const ehResp = (linhaRef["É O RESPONSÁVEL FAMILIAR?"] || "").trim().toUpperCase() === "SIM";
          const respDoc = normalizarDocumento(linhaRef["CPF/CNS RESPONSÁVEL FAMILIAR"]);
          semResponsavelFamiliar = !ehResp && !respDoc;
        }
      }

      const pendencias = [];
      if (semCpfSemCns) pendencias.push("SEM_CPF_SEM_CNS");
      else if (somenteCns) pendencias.push("SOMENTE_CNS");
      if (cnsProvisorio) pendencias.push("CNS_PROVISORIO");
      if (microareaRuim) pendencias.push("MICROAREA_INCONSISTENTE");
      if (semEndereco) pendencias.push("SEM_ENDERECO");
      else if (enderecoIncompleto) pendencias.push("ENDERECO_INCOMPLETO");
      if (desatualizada) pendencias.push("FICHA_DESATUALIZADA");
      if (semAtendimento) pendencias.push("SEM_ATENDIMENTO");
      if (semFci) pendencias.push("SEM_FCI_APROXIMADO");
      if (semVinculoDomiciliar) pendencias.push("SEM_VINCULO_DOMICILIAR");
      if (multiDomicilio) pendencias.push("MULTI_DOMICILIO");
      if (semResponsavelFamiliar) pendencias.push("SEM_RESPONSAVEL_FAMILIAR");

      return {
        raw: v, nome, microarea: v["Microárea"], origem: v["Origem"], sexo: v["Sexo"],
        idade: v["Idade"], faixaEtaria: faixaEtaria(v["Idade"]), ultimaAtualizacao: v["Última atualização cadastral"],
        endereco, cpf, cns, semEndereco, desatualizado: desatualizada, semAtendimento, semDomicilio: semVinculoDomiciliar,
        pendencias,
      };
    });
  }

  // -------- duplicidades (nome+nascimento exato; documento repetido em nomes diferentes) --------
  function calcularDuplicidades() {
    const grupos = [];

    const porNomeNasc = new Map();
    vinculados.forEach((v) => {
      const nome = normalizarNome(v["Nome"]);
      const nasc = normalizarData(v["Data de nascimento"]);
      if (!nome || !nasc) return;
      const k = nome + "|" + nasc;
      (porNomeNasc.get(k) || porNomeNasc.set(k, []).get(k)).push(v);
    });
    porNomeNasc.forEach((arr) => {
      if (arr.length < 2) return;
      const docs = new Set(arr.map((v) => normalizarDocumento(v["CPF/CNS"])).filter(Boolean));
      if (docs.size >= 2) grupos.push({ tipo: "NOME_NASCIMENTO", pessoas: arr });
    });

    const porDoc = new Map();
    vinculados.forEach((v) => {
      const d = normalizarDocumento(v["CPF/CNS"]);
      if (!d) return;
      (porDoc.get(d) || porDoc.set(d, []).get(d)).push(v);
    });
    porDoc.forEach((arr) => {
      const nomes = new Set(arr.map((v) => normalizarNome(v["Nome"])));
      if (arr.length >= 2 && nomes.size >= 2) grupos.push({ tipo: "DOCUMENTO_IDENTICO", pessoas: arr });
    });

    return grupos;
  }

  // -------- dashboard: cards genéricos --------
  function cardHtml(opts) {
    const badge = opts.badge || "";
    const inner = '<div class="ind-card-top">' + badge + "</div>" +
      '<div class="valor" style="' + (opts.cor ? "color:" + opts.cor : "") + '">' + opts.valor + "</div>" +
      '<div class="titulo">' + opts.titulo + "</div>" +
      '<div class="desc">' + (opts.desc || "") + "</div>" +
      (opts.link ? '<div class="link">' + opts.link + " →</div>" : "");
    if (opts.onClick) return '<a class="ind-card" href="javascript:void(0)" data-card="' + opts.id + '">' + inner + "</a>";
    return '<div class="ind-card">' + inner + "</div>";
  }

  // -------- aba: visão geral (KPIs, gráficos, top pendências) --------
  const ORDEM_FAIXA = ["0-4", "5-9", "10-14", "15-19", "20-39", "40-59", "60+"];
  const CORES_SEXO = { FEMININO: "var(--pink)", MASCULINO: "var(--blue-link)" };
  const PILL_ICONES = {
    SEM_CPF_SEM_CNS: "🪪", SOMENTE_CNS: "🆔", CNS_PROVISORIO: "🆔",
    MICROAREA_INCONSISTENTE: "📍", SEM_ENDERECO: "🏠", ENDERECO_INCOMPLETO: "🏠",
    FICHA_DESATUALIZADA: "📅", SEM_ATENDIMENTO: "🩺", SEM_FCI_APROXIMADO: "📋",
    SEM_VINCULO_DOMICILIAR: "🔗", MULTI_DOMICILIO: "🏘️", SEM_RESPONSAVEL_FAMILIAR: "👪",
  };

  function kpiCardHtml(cor, bg, icone, label, valor, desc) {
    return '<div class="kpi-card" style="border-left-color:' + cor + '">' +
      '<div class="kpi-top"><div class="kpi-icone" style="background:' + bg + '">' + icone + '</div><div class="kpi-label">' + label + "</div></div>" +
      '<div class="kpi-valor">' + valor + "</div>" +
      '<div class="kpi-desc">' + desc + "</div></div>";
  }

  function renderKpis() {
    const total = indicadores.length;
    const semPendencia = indicadores.filter((i) => !i.pendencias.length).length;
    const pct = total ? Math.round((semPendencia / total) * 100) : 0;
    const pendCriticas = indicadores.filter((i) => i.pendencias.some((p) => PENDENCIA_CATALOG[p].sev === "erro")).length;
    const microareas = new Set(indicadores.map((i) => i.microarea)).size;
    const desatualizados = indicadores.filter((i) => i.desatualizado).length;
    const cds = indicadores.filter((i) => (i.origem || "").toUpperCase() === "CDS").length;
    const pec = indicadores.filter((i) => (i.origem || "").toUpperCase() === "PEC").length;
    const corMeter = pct >= 80 ? "var(--teal)" : pct >= 50 ? "var(--amber)" : "var(--red)";
    const bgMeter = pct >= 80 ? "var(--teal-bg)" : pct >= 50 ? "var(--amber-bg)" : "var(--red-bg)";

    const meterHtml = '<div class="kpi-card" style="border-left-color:' + corMeter + '">' +
      '<div class="kpi-top"><div class="kpi-icone" style="background:' + bgMeter + '">✅</div><div class="kpi-label">Qualidade dos dados</div></div>' +
      '<div class="kpi-valor" style="color:' + corMeter + '">' + pct + '%</div>' +
      '<div class="meter-track"><div class="meter-fill" style="width:' + pct + '%;background:' + corMeter + '"></div></div>' +
      '<div class="meter-legenda"><span>sem pendência</span><span>' + (100 - pct) + "% com pendência</span></div></div>";

    document.getElementById("kpiGrid").innerHTML = [
      kpiCardHtml("var(--blue-link)", "var(--blue-bg)", "👥", "Total de cidadãos", String(total),
        total ? fmtPct(cds, total) + "% CDS · " + fmtPct(pec, total) + "% PEC" : "—"),
      meterHtml,
      kpiCardHtml("var(--red)", "var(--red-bg)", "⚠️", "Pendências críticas", String(pendCriticas),
        fmtPct(pendCriticas, total) + "% dos vinculados com ao menos 1 erro"),
      kpiCardHtml("var(--teal)", "var(--teal-bg)", "🏘️", "Cobertura do território", String(microareas),
        "microárea(s) distinta(s) com cadastro"),
      kpiCardHtml("var(--amber)", "var(--amber-bg)", "📅", "Registros desatualizados", String(desatualizados),
        "última atualização há mais de 1 ano"),
      kpiCardHtml("var(--violet)", "var(--violet-bg)", "📄", "Duplicidades potenciais", String(duplicidades.length),
        "grupos de possível duplicidade de cadastro"),
    ].join("");
  }

  function renderGraficosGerais() {
    const total = indicadores.length;

    // distribuição por sexo (barra empilhada, categórico)
    const porSexo = new Map();
    indicadores.forEach((i) => { const s = (i.sexo || "").trim() || "—"; porSexo.set(s, (porSexo.get(s) || 0) + 1); });
    const entradasSexo = [...porSexo.entries()].sort((a, b) => b[1] - a[1]);
    const segmentosHtml = entradasSexo.map(([s, n]) => {
      const cor = CORES_SEXO[s.toUpperCase()] || "var(--text-dim-2)";
      return '<div class="stackbar-seg" style="width:' + fmtPct(n, total) + '%;background:' + cor + '" title="' + escapeHtml(s) + ": " + n + '"></div>';
    }).join("");
    const legendaSexoHtml = entradasSexo.map(([s, n]) => {
      const cor = CORES_SEXO[s.toUpperCase()] || "var(--text-dim-2)";
      return '<div class="stackbar-legenda-item"><span class="stackbar-legenda-dot" style="background:' + cor + '"></span>' + escapeHtml(s) + ": <b>" + n + "</b> (" + fmtPct(n, total) + "%)</div>";
    }).join("");
    const painelSexo = '<div class="painel"><h3>Distribuição por sexo</h3><div class="stackbar">' + segmentosHtml + '</div><div class="stackbar-legenda">' + legendaSexoHtml + "</div></div>";

    // distribuição por faixa etária (barras, hue único - magnitude, não identidade)
    const porFaixa = new Map();
    indicadores.forEach((i) => porFaixa.set(i.faixaEtaria, (porFaixa.get(i.faixaEtaria) || 0) + 1));
    const maxFaixa = Math.max(1, ...ORDEM_FAIXA.map((f) => porFaixa.get(f) || 0));
    const barrasHtml = ORDEM_FAIXA.map((f) => {
      const n = porFaixa.get(f) || 0;
      return '<div class="barchart-col"><div class="barchart-valor">' + n + '</div>' +
        '<div class="barchart-bar" style="height:' + Math.round((n / maxFaixa) * 100) + '%"></div>' +
        '<div class="barchart-label">' + f + "</div></div>";
    }).join("");
    const painelFaixa = '<div class="painel"><h3>Distribuição por faixa etária</h3><div class="barchart">' + barrasHtml + "</div></div>";

    // qualidade por microárea (lista com indicador de status, no lugar de mapa geográfico -
    // este módulo não tem os limites geográficos do território pra desenhar um mapa de verdade)
    const porMicroarea = new Map();
    indicadores.forEach((i) => {
      const ma = i.microarea || "—";
      const atual = porMicroarea.get(ma) || { total: 0, semPendencia: 0 };
      atual.total++;
      if (!i.pendencias.length) atual.semPendencia++;
      porMicroarea.set(ma, atual);
    });
    const listaMicroarea = [...porMicroarea.entries()]
      .map(([ma, v]) => ({ ma, pct: fmtPct(v.semPendencia, v.total), total: v.total }))
      .sort((a, b) => a.pct - b.pct);
    const microareaHtml = listaMicroarea.length
      ? '<div class="microarea-quali-list">' + listaMicroarea.map((m) => {
          const dot = m.pct >= 80 ? "dot-ok" : m.pct >= 50 ? "dot-aviso" : "dot-erro";
          return '<div class="microarea-quali-item"><span class="situacao-dot ' + dot + '"></span>' +
            '<span class="microarea-quali-nome">' + escapeHtml(m.ma) + " (" + m.total + ")</span>" +
            '<span class="microarea-quali-pct">' + m.pct + "%</span></div>";
        }).join("") + "</div>"
      : '<p class="vazio">Sem dados.</p>';
    const painelMicroarea = '<div class="painel"><h3>Qualidade por microárea</h3>' + microareaHtml + "</div>";

    document.getElementById("graficosGerais").innerHTML = painelSexo + painelFaixa + painelMicroarea;
  }

  function renderPillStripPendencias() {
    const counts = contarPendencias();
    const codigos = ORDEM_PENDENCIAS.filter((c) => counts[c]);
    const total = indicadores.length;
    const el = document.getElementById("pillStripPendencias");
    if (!codigos.length) {
      el.innerHTML = '<div class="bloco-vazio"><b>Nenhuma pendência encontrada</b><br>Todos os cidadãos vinculados passaram nas regras verificadas.</div>';
      return;
    }
    el.innerHTML = codigos.map((cod) => {
      const info = PENDENCIA_CATALOG[cod];
      const cor = info.sev === "erro" ? "var(--red)" : "var(--amber)";
      const bg = info.sev === "erro" ? "var(--red-bg)" : "var(--amber-bg)";
      return '<a class="pill-card" href="javascript:void(0)" data-pill="' + cod + '">' +
        '<div class="pill-icone" style="background:' + bg + ";color:" + cor + '">' + (PILL_ICONES[cod] || "•") + "</div>" +
        '<div class="pill-info"><div class="pill-titulo">' + escapeHtml(info.texto) + '</div>' +
        '<div class="pill-valor">' + counts[cod] + '</div>' +
        '<div class="pill-pct">' + fmtPct(counts[cod], total) + "% dos vinculados</div></div></a>";
    }).join("");
    el.querySelectorAll("[data-pill]").forEach((a) => a.addEventListener("click", () => showTabela({ pendencia: a.dataset.pill })));
  }

  // -------- aba: pendências cadastrais --------
  function contarPendencias() {
    const counts = {};
    indicadores.forEach((i) => i.pendencias.forEach((p) => { counts[p] = (counts[p] || 0) + 1; }));
    return counts;
  }

  function renderPendencias() {
    const counts = contarPendencias();
    const codigos = ORDEM_PENDENCIAS.filter((c) => counts[c]);
    const total = indicadores.length;
    document.getElementById("countPendencias").textContent = String(indicadores.filter((i) => i.pendencias.length).length);

    document.getElementById("cardsPendencias").innerHTML = codigos.map((cod) => {
      const info = PENDENCIA_CATALOG[cod];
      return cardHtml({
        id: cod, onClick: true,
        valor: String(counts[cod]), titulo: info.texto, desc: "Fonte: " + info.fonte,
        cor: info.sev === "erro" ? "var(--red)" : "var(--amber)",
        badge: '<span class="badge ' + (info.sev === "erro" ? "sev-erro" : "sev-aviso") + ' pct-badge">' + fmtPct(counts[cod], total) + "%</span>",
        link: "Ver cidadãos",
      });
    }).join("") || '<div class="bloco-vazio"><b>Nenhuma pendência encontrada</b><br>Todos os cidadãos vinculados passaram nas regras verificadas.</div>';
    document.querySelectorAll("#cardsPendencias .ind-card[data-card]").forEach((el) => {
      el.addEventListener("click", () => showTabela({ pendencia: el.dataset.card }));
    });

    document.getElementById("glossarioPendencias").innerHTML = codigos.map((cod) => {
      const info = PENDENCIA_CATALOG[cod];
      return '<a class="gloss-item" href="javascript:void(0)" data-gloss="' + cod + '"><span class="badge ' + (info.sev === "erro" ? "sev-erro" : "sev-aviso") + '">' + (info.sev === "erro" ? "Crítico" : "Atenção") + '</span>' +
        '<div class="gloss-body">' +
        '<div class="gloss-titulo">' + escapeHtml(info.texto) + ' <span class="gloss-count">— ' + counts[cod] + " ocorrência(s) · fonte: " + escapeHtml(info.fonte) + "</span></div>" +
        '<div class="gloss-explicacao">' + escapeHtml(info.explicacao) + "</div>" +
        '<div class="gloss-resolver"><b>Como resolver:</b> ' + escapeHtml(info.resolver) + "</div>" +
        "</div></a>";
    }).join("");
    document.querySelectorAll("#glossarioPendencias [data-gloss]").forEach((el) => {
      el.addEventListener("click", () => showTabela({ pendencia: el.dataset.gloss }));
    });
  }

  // -------- aba: duplicidades --------
  function renderDuplicidades() {
    document.getElementById("countDuplicidades").textContent = String(duplicidades.length);
    const criticas = duplicidades.filter((g) => DUPLICIDADE_CATALOG[g.tipo].prioridade === "critica").length;
    const medias = duplicidades.length - criticas;
    document.getElementById("cardsDuplicidades").innerHTML = [
      cardHtml({ valor: String(duplicidades.length), titulo: "Casos encontrados", desc: "Grupos de possível duplicidade de cadastro entre os cidadãos vinculados." }),
      cardHtml({ valor: String(criticas), titulo: "Prioridade crítica", cor: "var(--red)", desc: "Mesmo CPF/CNS vinculado a nomes diferentes.",
        badge: criticas ? '<span class="badge sev-erro">Crítica</span>' : "" }),
      cardHtml({ valor: String(medias), titulo: "Prioridade média", cor: "var(--amber)", desc: "Nome e data de nascimento iguais, documentos diferentes.",
        badge: medias ? '<span class="badge sev-aviso">Média</span>' : "" }),
    ].join("");

    const lista = document.getElementById("listaDuplicidades");
    if (!duplicidades.length) {
      lista.innerHTML = '<div class="bloco-vazio"><b>Nenhuma duplicidade encontrada</b><br>Nenhum cidadão vinculado bateu nos critérios de nome+nascimento ou documento repetido.</div>';
      return;
    }
    lista.innerHTML = duplicidades.map((g, idx) => {
      const info = DUPLICIDADE_CATALOG[g.tipo];
      const pessoasHtml = g.pessoas.map((p) =>
        '<div class="dup-item-pessoa">' + escapeHtml(p["Nome"]) +
        ' <span class="doc">' + escapeHtml(p["Data de nascimento"] || "—") + " · " + escapeHtml(p["CPF/CNS"] || "—") +
        " · Microárea " + escapeHtml(p["Microárea"] || "—") + "</span></div>"
      ).join("");
      return '<div class="dup-item prioridade-' + info.prioridade + '">' +
        '<div class="dup-item-top"><span class="dup-item-tipo">' + escapeHtml(info.texto) + '</span>' +
        '<span class="badge ' + (info.prioridade === "critica" ? "sev-erro" : "sev-aviso") + '">' + (info.prioridade === "critica" ? "Crítica" : "Média") + "</span></div>" +
        '<div class="dup-item-pessoas">' + pessoasHtml + "</div>" +
        '<div class="dup-item-conduta"><b>Conduta sugerida:</b> ' + escapeHtml(info.conduta) + "</div>" +
        '<div class="dup-item-acoes"><label><input type="checkbox" data-marcar-ok="' + idx + '"> Marcar como não é duplicidade</label></div>' +
        "</div>";
    }).join("");
    lista.querySelectorAll("[data-marcar-ok]").forEach((chk) => {
      chk.addEventListener("change", () => chk.closest(".dup-item").classList.toggle("marcado-ok", chk.checked));
    });
  }

  // -------- aba: território --------
  function renderTerritorio() {
    const btnTab = document.getElementById("tabBtnTerritorio");
    if (!analiseTerritorioAtual) { btnTab.classList.add("hidden"); return; }
    btnTab.classList.remove("hidden");
    const t = analiseTerritorioAtual;

    document.getElementById("cardsTerritorio").innerHTML = [
      cardHtml({ valor: String(t.totalEnderecos), titulo: "Domicílios mapeados", desc: "Endereços distintos encontrados no(s) arquivo(s) de território carregado(s)." }),
      cardHtml({
        valor: String(t.enderecosVazios.length), titulo: "Domicílios sem morador",
        cor: t.enderecosVazios.length ? "var(--amber)" : "var(--teal)",
        desc: "Endereço mapeado no território mas sem nenhum cidadão vinculado a ele.",
        badge: '<span class="badge ' + (t.enderecosVazios.length ? "sev-aviso" : "b-ok") + ' pct-badge">' + fmtPct(t.enderecosVazios.length, t.totalEnderecos) + "%</span>",
      }),
      cardHtml({ valor: String(t.totalFamilias), titulo: "Famílias mapeadas", desc: "Agrupadas pelo responsável familiar dentro de cada domicílio." }),
      cardHtml({ valor: t.totalFamilias ? (t.totalMoradores / t.totalFamilias).toFixed(1) : "—", titulo: "Média de moradores por família", desc: "Total de moradores dividido pelo total de famílias mapeadas." }),
    ].join("");

    const painelVazios = t.enderecosVazios.length
      ? '<div class="painel"><h3>Domicílios sem morador</h3><table><tbody>' +
        t.enderecosVazios.slice(0, 20).map((e) => "<tr><td>" + escapeHtml(enderecoLegivel(e.linha)) + "</td></tr>").join("") +
        "</tbody></table>" + (t.enderecosVazios.length > 20 ? '<p class="vazio">+ ' + (t.enderecosVazios.length - 20) + " outro(s).</p>" : "") + "</div>"
      : '<div class="painel"><h3>Domicílios sem morador</h3><p class="vazio">Nenhum domicílio vazio encontrado.</p></div>';
    document.getElementById("paineisTerritorio").innerHTML = '<div class="paineis-grid">' + painelVazios + "</div>";
  }

  // -------- aba: exportações --------
  function baixarCsv(nomeArquivo, cabecalho, linhas) {
    const texto = [cabecalho].concat(linhas).map((row) =>
      row.map((v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"').join(";")
    ).join("\r\n");
    const blob = new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nomeArquivo;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function textoPendencias(i) {
    return i.pendencias.length ? i.pendencias.map((p) => PENDENCIA_CATALOG[p].texto).join(" | ") : "Nenhuma";
  }
  function exportarPendenciasCsv() {
    const comPendencia = indicadores.filter((i) => i.pendencias.length);
    baixarCsv("pendencias_cadastrais.csv",
      ["Nome", "Microárea", "Origem", "Última atualização", "Endereço", "Pendências"],
      comPendencia.map((i) => [i.nome, i.microarea, i.origem, i.ultimaAtualizacao, i.semEndereco ? "Sem endereço" : i.endereco, textoPendencias(i)]));
  }
  function exportarDuplicidadesCsv() {
    const linhas = [];
    duplicidades.forEach((g) => {
      g.pessoas.forEach((p) => linhas.push([DUPLICIDADE_CATALOG[g.tipo].texto, DUPLICIDADE_CATALOG[g.tipo].prioridade, p["Nome"], p["Data de nascimento"], p["CPF/CNS"], p["Microárea"]]));
    });
    baixarCsv("possiveis_duplicidades.csv", ["Tipo", "Prioridade", "Nome", "Data de nascimento", "Documento", "Microárea"], linhas);
  }
  function exportarVinculadosCsv() {
    baixarCsv("cidadaos_vinculados.csv",
      ["Nome", "Microárea", "Origem", "Sexo", "Idade", "Última atualização", "Endereço", "Documento", "Pendências"],
      indicadores.map((i) => [i.nome, i.microarea, i.origem, i.sexo, i.idade, i.ultimaAtualizacao, i.semEndereco ? "Sem endereço" : i.endereco, i.cpf ? "CPF" : i.cns ? "CNS" : "—", textoPendencias(i)]));
  }

  function renderExportacoes() {
    const itens = [
      { titulo: "Pendências cadastrais (.csv)", desc: "Lista nominal de todos os cidadãos com pelo menos uma pendência, com o tipo de cada uma.", onClick: exportarPendenciasCsv, disabled: !indicadores.some((i) => i.pendencias.length) },
      { titulo: "Possíveis duplicidades (.csv)", desc: "Lista dos grupos de duplicidade encontrados (nome+nascimento e documento repetido).", onClick: exportarDuplicidadesCsv, disabled: !duplicidades.length },
      { titulo: "Cidadãos vinculados — completo (.csv)", desc: "Todos os vinculados importados, com as pendências calculadas.", onClick: exportarVinculadosCsv },
      { titulo: "Relatório em PDF", desc: "Gera o PDF consolidado com todos os cidadãos vinculados carregados.", onClick: () => exportarPdf(indicadores) },
    ];
    document.getElementById("exportacoesGrid").innerHTML = itens.map((it, idx) =>
      '<div class="exportacao-item"><div class="titulo">' + it.titulo + '</div><div class="desc">' + it.desc + '</div>' +
      '<button class="btn btn-ghost-dark" data-exportar="' + idx + '"' + (it.disabled ? " disabled" : "") + '>⬇ Baixar</button></div>'
    ).join("");
    document.querySelectorAll("#exportacoesGrid [data-exportar]").forEach((btn) => {
      btn.addEventListener("click", () => itens[+btn.dataset.exportar].onClick());
    });
  }

  function renderArquivos() {
    const linhas = [];
    linhas.push('<div class="fonte-row"><div class="fonte-info"><span class="fonte-nome">' + escapeHtml(arquivoVinc.name) + '</span><span class="fonte-count">cidadãos vinculados · ' + vinculados.length + " registro(s)</span></div></div>");
    if (arquivoCond) linhas.push('<div class="fonte-row"><div class="fonte-info"><span class="fonte-nome">' + escapeHtml(arquivoCond.name) + '</span><span class="fonte-count">condições de saúde · ' + condicoesLinhas.length + " registro(s)</span></div></div>");
    arquivosTerr.forEach((f) => {
      const qtd = territorioLinhas.filter((l) => l.__arquivo === f.name).length;
      linhas.push('<div class="fonte-row"><div class="fonte-info"><span class="fonte-nome">' + escapeHtml(f.name) + '</span><span class="fonte-count">território · ' + qtd + " registro(s)</span></div></div>");
    });
    document.getElementById("fontesResumo").innerHTML = linhas.join("");
  }

  function renderAvisoEscopo() {
    const el = document.getElementById("avisoDadosAusentes");
    el.classList.remove("hidden");
    el.innerHTML = "<b>Fora do escopo deste módulo</b> — dependem de outro export do e-SUS que este módulo não lê: " +
      "óbito inconsistente (saída de cadastro), \"Individual incompleto\" (campos clínicos/sociais completos da FCI), " +
      "inconsistência / completude / geolocalização do domicílio, e duplicidade por nome da mãe.";
  }

  function renderDashboard() {
    analiseTerritorioAtual = territorioLinhas.length ? analisarTerritorio(territorioLinhas) : null;
    indicadores = calcularIndicadores();
    duplicidades = calcularDuplicidades();
    renderAvisoEscopo();
    renderKpis();
    renderGraficosGerais();
    renderPillStripPendencias();
    renderPendencias();
    renderDuplicidades();
    renderTerritorio();
    renderExportacoes();
    renderArquivos();
  }

  // -------- abas do dashboard --------
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("hidden")) return;
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      const alvo = "tab" + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1);
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === alvo));
    });
  });

  // -------- filtros / tabela --------
  const fMicroarea = document.getElementById("fMicroarea");
  const fOrigem = document.getElementById("fOrigem");
  const fSexo = document.getElementById("fSexo");
  const fPendencia = document.getElementById("fPendencia");
  const fBusca = document.getElementById("fBusca");
  const fSoComPendencia = document.getElementById("fSoComPendencia");
  const filterMsg = document.getElementById("filterMsg");

  function popularFiltros() {
    const microareas = [...new Set(indicadores.map((i) => i.microarea))].sort();
    fMicroarea.innerHTML = '<option value="">Todas</option>' + microareas.map((m) => '<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + "</option>").join("");
    const sexos = [...new Set(indicadores.map((i) => i.sexo).filter(Boolean))].sort();
    fSexo.innerHTML = '<option value="">Todos</option>' + sexos.map((s) => '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + "</option>").join("");

    const counts = contarPendencias();
    const codigos = ORDEM_PENDENCIAS.filter((c) => counts[c]);
    fPendencia.innerHTML = '<option value="">Todas</option>' + codigos.map((cod) => {
      const info = PENDENCIA_CATALOG[cod];
      return '<option value="' + cod + '">' + (info.sev === "erro" ? "Crítico" : "Atenção") + " · " + escapeHtml(info.texto) + " (" + counts[cod] + ")</option>";
    }).join("");
  }

  function filtrados() {
    const microarea = fMicroarea.value, origem = fOrigem.value, sexo = fSexo.value, pendencia = fPendencia.value;
    const busca = fBusca.value.trim().toLowerCase();
    return indicadores.filter((i) => {
      if (microarea && i.microarea !== microarea) return false;
      if (origem && (i.origem || "").toUpperCase() !== origem) return false;
      if (sexo && i.sexo !== sexo) return false;
      if (pendencia && i.pendencias.indexOf(pendencia) === -1) return false;
      if (fSoComPendencia.checked && !i.pendencias.length) return false;
      if (busca && i.nome.toLowerCase().indexOf(busca) === -1) return false;
      return true;
    });
  }

  function pendenciasDetalheHtml(i) {
    if (!i.pendencias.length) return '<span class="ok-txt">—</span>';
    return '<div class="problema-list">' + i.pendencias.map((p) => {
      const info = PENDENCIA_CATALOG[p];
      return '<div class="probitem probitem-' + info.sev + '">' + escapeHtml(info.texto) + "</div>";
    }).join("") + "</div>";
  }
  function situacaoDotHtml(i) {
    if (!i.pendencias.length) return '<span class="situacao-dot dot-ok" title="Sem pendências"></span>';
    const pior = i.pendencias.some((p) => PENDENCIA_CATALOG[p].sev === "erro") ? "dot-erro" : "dot-aviso";
    return '<span class="situacao-dot ' + pior + '" title="' + i.pendencias.length + ' pendência(s)"></span>';
  }

  // -------- ordenação da tabela (clique no cabeçalho) --------
  let ordenacaoAtual = { campo: null, dir: 1 };
  function ordenar(lista) {
    if (!ordenacaoAtual.campo) return lista;
    const campo = ordenacaoAtual.campo, dir = ordenacaoAtual.dir;
    const copia = lista.slice();
    copia.sort((a, b) => {
      let va, vb;
      if (campo === "pendencias") { va = a.pendencias.length; vb = b.pendencias.length; }
      else if (campo === "ultimaAtualizacao") { va = parseDataBr(a.ultimaAtualizacao) || new Date(0); vb = parseDataBr(b.ultimaAtualizacao) || new Date(0); }
      else { va = (a[campo] || "").toString().toLowerCase(); vb = (b[campo] || "").toString().toLowerCase(); }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return copia;
  }
  document.querySelectorAll("th.sortavel").forEach((th) => {
    th.addEventListener("click", () => {
      const campo = th.dataset.sort;
      ordenacaoAtual = ordenacaoAtual.campo === campo ? { campo, dir: -ordenacaoAtual.dir } : { campo, dir: 1 };
      document.querySelectorAll("th.sortavel .seta").forEach((s) => { s.textContent = ""; });
      th.querySelector(".seta").textContent = ordenacaoAtual.dir === 1 ? "▲" : "▼";
      renderTabela();
    });
  });

  function renderTabela() {
    const lista = ordenar(filtrados());
    const MAX = 800;
    document.getElementById("sidebarCount").textContent = lista.length.toLocaleString("pt-BR");
    document.getElementById("tabelaBody").innerHTML = lista.slice(0, MAX).map((i) => (
      "<tr><td>" + situacaoDotHtml(i) + "</td>" +
      "<td>" + escapeHtml(i.nome) + "</td>" +
      "<td>" + escapeHtml(i.microarea) + "</td>" +
      "<td>" + escapeHtml(i.origem) + "</td>" +
      "<td>" + escapeHtml(i.ultimaAtualizacao) + (i.desatualizado ? ' <span class="badge sev-aviso">+1 ano</span>' : "") + "</td>" +
      "<td>" + (i.semEndereco ? '<span class="badge sev-erro">Sem endereço</span>' : escapeHtml(i.endereco)) + "</td>" +
      "<td>" + (i.cpf ? "CPF" : i.cns ? "CNS" : "—") + "</td>" +
      "<td>" + pendenciasDetalheHtml(i) + "</td>" +
      "</tr>"
    )).join("");
    clearMsg(filterMsg);
    if (lista.length === 0) setMsg(filterMsg, "warn", "Nenhum cidadão corresponde aos filtros aplicados.");
    else if (lista.length > MAX) setMsg(filterMsg, "warn", lista.length + " encontrados — mostrando os primeiros " + MAX + ".");
  }
  [fMicroarea, fOrigem, fSexo, fPendencia, fBusca, fSoComPendencia].forEach((el) => el.addEventListener("input", renderTabela));

  // -------- exportação PDF --------
  const COLUNAS_PDF = [
    { titulo: "Nome", get: (i) => i.nome },
    { titulo: "Microárea", get: (i) => i.microarea },
    { titulo: "Origem", get: (i) => i.origem },
    { titulo: "Última atualização", get: (i) => i.ultimaAtualizacao + (i.desatualizado ? " (+1 ano)" : "") },
    { titulo: "Endereço", get: (i) => (i.semEndereco ? "Sem endereço" : i.endereco) },
    { titulo: "Documento", get: (i) => (i.cpf ? "CPF" : i.cns ? "CNS" : "—") },
    { titulo: "Pendências", get: (i) => textoPendencias(i) },
  ];

  function nomeArquivoPdf() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return "acompanhamento_pec_" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".pdf";
  }

  function exportarPdf(lista) {
    const doc = new window.jspdf.jsPDF({ orientation: "landscape" });
    const dataHora = new Date().toLocaleString("pt-BR");
    const usuario = document.getElementById("topbarUsername").textContent || "";

    doc.setFontSize(13);
    doc.text("Acompanhamento Cidadãos PEC", 14, 14);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text("Gerado em " + dataHora + " por " + usuario + " · " + lista.length + " cidadão(s)", 14, 20);

    const idxEndereco = COLUNAS_PDF.findIndex((c) => c.titulo === "Endereço");

    doc.autoTable({
      startY: 25,
      head: [COLUNAS_PDF.map((c) => c.titulo)],
      body: lista.map((i) => COLUNAS_PDF.map((c) => c.get(i) || "")),
      theme: "grid",
      styles: { fontSize: 6.5, cellPadding: 1.5, lineWidth: 0.1, lineColor: [200, 200, 200] },
      headStyles: { fillColor: [15, 23, 42] },
      columnStyles: idxEndereco === -1 ? {} : { [idxEndereco]: { cellWidth: 45, fontSize: 5.5 } },
      didDrawPage: () => {
        const pageCount = doc.internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(
          "Página " + doc.internal.getCurrentPageInfo().pageNumber + " de " + pageCount,
          doc.internal.pageSize.getWidth() - 30,
          doc.internal.pageSize.getHeight() - 8
        );
      },
    });
    doc.save(nomeArquivoPdf());
  }
  document.getElementById("btnExportarPdf").addEventListener("click", () => exportarPdf(filtrados()));

  // -------- navegação --------
  function showDashboard() {
    viewUpload.classList.add("hidden");
    viewTabela.classList.add("hidden");
    viewDashboard.classList.remove("hidden");
    btnVoltar.classList.add("hidden");
    document.querySelectorAll(".tab-btn").forEach((b, idx) => b.classList.toggle("active", idx === 0));
    document.querySelectorAll(".tab-panel").forEach((p, idx) => p.classList.toggle("active", idx === 0));
  }
  function showTabela(preset) {
    viewUpload.classList.add("hidden");
    viewDashboard.classList.add("hidden");
    viewTabela.classList.remove("hidden");
    btnVoltar.classList.remove("hidden");
    popularFiltros();
    if (preset) {
      fMicroarea.value = ""; fOrigem.value = ""; fSexo.value = ""; fBusca.value = "";
      fPendencia.value = preset.pendencia || "";
      fSoComPendencia.checked = !!preset.pendencia;
    }
    renderTabela();
  }
  document.getElementById("btnVerTabela").addEventListener("click", () => showTabela());
  btnVoltar.addEventListener("click", showDashboard);

  viewUpload.classList.remove("hidden");
})();
