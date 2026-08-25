(function (root) {
  "use strict";

  // Parseia o relatório RSPROCED do SIA/DATASUS ("Sintético de
  // Procedimentos por Unidade/CMP") - um relatório de impressão em texto
  // (largura fixa, cabeçalho repetido a cada página), não um CSV. Mostra,
  // por procedimento SIGTAP e por unidade, o valor PRODUZIDO (submetido no
  // BPA/FPO) x o valor APROVADO (efetivamente pago) na competência - a
  // diferença é a glosa.

  const MESES = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };

  const RE_CABECALHO = /^(\d{2}\/\d{2}\/\d{4})\s+SINTETICO DE PROCEDIMENTOS POR UNIDADE\/CMP - (\w{3})\/(\d{4})\s+(\d{2}:\d{2})\s*$/i;
  const RE_UNIDADE = /^Unidade\s+(\d{7})\s+(.+)$/;
  const RE_PROCEDIMENTO = /^\s*(\d{9}-\d)\s+(.+?)\s{2,}([\d.,]+)\s+([\d.,]+)\s*$/;
  const RE_TOTAL_UNIDADE = /^TOTAL DA UNIDADE\s+([\d.,]+)\s+([\d.,]+)\s*$/;
  const RE_TOTAL_GERAL = /^TOTAL GERAL\s+([\d.,]+)\s+([\d.,]+)\s*$/;

  function parseNumeroBr(s) {
    if (!s) return 0;
    const n = parseFloat(String(s).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  function normalizarSigtap(codigoComTraco) {
    return codigoComTraco.replace("-", "");
  }

  function parseFile(texto, nomeArquivo) {
    const linhas = texto.split(/\r\n|\r|\n/);
    let competencia = null;
    let dataGeracao = null;
    let unidadeAtual = null;
    const registros = [];
    const totaisDeclaradosPorUnidade = [];
    let totalGeralDeclarado = null;

    linhas.forEach((linhaBruta) => {
      const linha = linhaBruta.replace(/\s+$/, "");
      if (!linha.trim()) return;

      if (!competencia) {
        const mCab = RE_CABECALHO.exec(linha);
        if (mCab) {
          dataGeracao = mCab[1];
          const mes = MESES[mCab[2].toUpperCase()];
          const ano = mCab[3];
          if (mes) competencia = ano + String(mes).padStart(2, "0");
          return;
        }
      }

      const mUnidade = RE_UNIDADE.exec(linha);
      if (mUnidade) {
        unidadeAtual = { cnes: mUnidade[1], nome: mUnidade[2].trim() };
        return;
      }

      const mTotalUnidade = RE_TOTAL_UNIDADE.exec(linha);
      if (mTotalUnidade) {
        totaisDeclaradosPorUnidade.push({
          cnes: unidadeAtual ? unidadeAtual.cnes : null,
          nome: unidadeAtual ? unidadeAtual.nome : null,
          produzido: parseNumeroBr(mTotalUnidade[1]),
          aprovado: parseNumeroBr(mTotalUnidade[2]),
        });
        unidadeAtual = null;
        return;
      }

      const mTotalGeral = RE_TOTAL_GERAL.exec(linha);
      if (mTotalGeral) {
        totalGeralDeclarado = { produzido: parseNumeroBr(mTotalGeral[1]), aprovado: parseNumeroBr(mTotalGeral[2]) };
        return;
      }

      const mProc = RE_PROCEDIMENTO.exec(linha);
      if (mProc && unidadeAtual) {
        const produzido = parseNumeroBr(mProc[3]);
        const aprovado = parseNumeroBr(mProc[4]);
        registros.push({
          fonte: nomeArquivo,
          competencia,
          cnes: unidadeAtual.cnes,
          nomeUnidade: unidadeAtual.nome,
          sigtap: normalizarSigtap(mProc[1]),
          descricao: mProc[2].trim(),
          produzido,
          aprovado,
          glosa: produzido - aprovado,
          pctGlosa: produzido ? (produzido - aprovado) / produzido : 0,
        });
      }
    });

    return {
      nome: nomeArquivo,
      label: nomeArquivo,
      competencia,
      dataGeracao,
      registros,
      totaisDeclaradosPorUnidade,
      totalGeralDeclarado,
    };
  }

  // conferência: soma calculada dos registros de uma fonte bate com os
  // totais que o próprio relatório declarou (TOTAL DA UNIDADE / TOTAL GERAL)?
  // tolerância de 1 centavo pra arredondamento de ponto flutuante.
  function conferirTotais(fonte) {
    const somaGeral = fonte.registros.reduce((acc, r) => {
      acc.produzido += r.produzido;
      acc.aprovado += r.aprovado;
      return acc;
    }, { produzido: 0, aprovado: 0 });

    const bateGeral = fonte.totalGeralDeclarado
      ? Math.abs(somaGeral.produzido - fonte.totalGeralDeclarado.produzido) < 0.01 &&
        Math.abs(somaGeral.aprovado - fonte.totalGeralDeclarado.aprovado) < 0.01
      : null;

    const porUnidade = {};
    fonte.registros.forEach((r) => {
      if (!porUnidade[r.cnes]) porUnidade[r.cnes] = { produzido: 0, aprovado: 0 };
      porUnidade[r.cnes].produzido += r.produzido;
      porUnidade[r.cnes].aprovado += r.aprovado;
    });
    const divergenciasPorUnidade = fonte.totaisDeclaradosPorUnidade.filter((declarado) => {
      const calc = porUnidade[declarado.cnes] || { produzido: 0, aprovado: 0 };
      return Math.abs(calc.produzido - declarado.produzido) >= 0.01 || Math.abs(calc.aprovado - declarado.aprovado) >= 0.01;
    });

    return { somaGeral, bateGeral, divergenciasPorUnidade };
  }

  const api = { parseFile, parseNumeroBr, normalizarSigtap, conferirTotais, MESES };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.DatasusSiaParser = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
