"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "..", "public");
const indexHtml = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
const portalJs = fs.readFileSync(path.join(publicDir, "portal.js"), "utf8");
const logoSvg = fs.readFileSync(path.join(publicDir, "img", "kode-logo.svg"), "utf8");

test("portal evita submissão nativa para uma URL com consulta vazia", () => {
  assert.match(indexHtml, /<form id="loginForm" action="\/" method="get">/);
  assert.match(portalJs, /window\.location\.href\.endsWith\("\?"\)/);
  assert.match(portalJs, /window\.history\.replaceState\(null, "", "\/"\)/);
});

test("logos do portal usam SVG com contraste fixo e URL versionada", () => {
  const references = indexHtml.match(/\/img\/kode-logo\.svg\?v=20261111/g) || [];
  assert.equal(references.length, 3);
  assert.doesNotMatch(logoSvg, /currentColor/);
  assert.match(logoSvg, /fill="#eef2fa"/);
});
