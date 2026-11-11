"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "..", "public");
const indexHtml = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
const portalJs = fs.readFileSync(path.join(publicDir, "portal.js"), "utf8");
const logoPath = path.join(publicDir, "img", "kode-logo-white.png");

test("portal evita submissão nativa para uma URL com consulta vazia", () => {
  assert.match(indexHtml, /<form id="loginForm" action="\/" method="get">/);
  assert.match(portalJs, /window\.location\.href\.endsWith\("\?"\)/);
  assert.match(portalJs, /window\.history\.replaceState\(null, "", "\/"\)/);
});

test("portal usa a marca oficial KODE com URL versionada", () => {
  const references = indexHtml.match(/\/img\/kode-logo-white\.png\?v=20261111c/g) || [];
  assert.equal(references.length, 2);
  assert.doesNotMatch(indexHtml, /class="hero-logo"/);
  assert.ok(fs.statSync(logoPath).size > 100_000);
  assert.match(indexHtml, /mix-blend-mode:screen/);
});
