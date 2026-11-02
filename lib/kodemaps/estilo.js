"use strict";

// Estilos MapLibre (raster puro, sem chave) servidos em /kode-maps/api/estilo.json.
// O OfflineManager do MapLibre nativo baixa o pacote a partir de uma URL de
// estilo, então o app usa esta mesma URL ao vivo e para baixar os pacotes
// (mesmo padrão do Kode Endemias). Trocar de provedor não pede novo APK.

const CAMADAS = ["satelite", "relevo", "rua"];

const FONTES = {
  // Esri não tem imagem real acima do z17 em município pequeno (devolve um tile
  // de aviso), por isso o maxzoom da fonte é 17 e o app só amplia.
  satelite: {
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    atribuicao: "Imagens © Esri, Maxar, Earthstar Geographics",
    maxzoom: 17,
  },
  // Topográfico com curvas de nível e sombreado de relevo.
  relevo: {
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"],
    atribuicao: "Mapa © Esri, USGS, NOAA, HERE, Garmin",
    maxzoom: 17,
  },
  rua: {
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    atribuicao: "© colaboradores do OpenStreetMap",
    maxzoom: 19,
  },
};

// São Gonçalo do Pará (IBGE 316180 / 3161809) com folga: [oeste, sul, leste, norte].
const LIMITES_MUNICIPIO = { ibge: "3161809", nome: "São Gonçalo do Pará - MG", bbox: [-44.93, -20.11, -44.72, -19.84] };

function estilo(camada) {
  const f = FONTES[camada];
  return {
    version: 8,
    sources: { base: { type: "raster", tiles: f.tiles, tileSize: 256, maxzoom: f.maxzoom, attribution: f.atribuicao } },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

module.exports = { CAMADAS, FONTES, LIMITES_MUNICIPIO, estilo };
