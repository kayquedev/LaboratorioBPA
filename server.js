require("dotenv").config({ path: process.env.ENV_FILE || ".env" });

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const { requireModulePage, requireAdminPage } = require("./middleware/auth");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");

const app = express();
const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.json());
app.use(cookieParser());

app.use("/api", authRoutes);
app.use("/api/admin", adminRoutes);

app.use("/admin", requireAdminPage, express.static(path.join(PUBLIC_DIR, "admin")));
app.use("/laboratorio", requireModulePage("laboratorio"), express.static(path.join(PUBLIC_DIR, "laboratorio")));
app.use("/qualidade_bpa", requireModulePage("qualidade_bpa"), express.static(path.join(PUBLIC_DIR, "qualidade_bpa")));
app.use("/correcao_bpa", requireModulePage("correcao_bpa"), express.static(path.join(PUBLIC_DIR, "correcao_bpa")));
app.use("/bolsa_familia", requireModulePage("bolsa_familia"), express.static(path.join(PUBLIC_DIR, "bolsa_familia")));
app.use("/datasus_sia", requireModulePage("datasus_sia"), express.static(path.join(PUBLIC_DIR, "datasus_sia")));
app.use("/acompanhamento_pec", requireModulePage("acompanhamento_pec"), express.static(path.join(PUBLIC_DIR, "acompanhamento_pec")));

app.use(express.static(PUBLIC_DIR));

const PORT = process.env.PORT || 4000;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`SGP rodando em http://127.0.0.1:${PORT}`);
});
