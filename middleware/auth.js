const jwt = require("jsonwebtoken");
const pool = require("../db/pool");

const COOKIE_NAME = "sgp_session";
const TOKEN_TTL = "12h";

function signSession(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function setSessionCookie(res, user) {
  res.cookie(COOKIE_NAME, signSession(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

async function loadUserFromRequest(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return null;

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }

  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.cpf, u.is_admin,
            COALESCE(json_agg(m.slug) FILTER (WHERE m.id IS NOT NULL), '[]') AS granted_slugs
     FROM users u
     LEFT JOIN user_modules um ON um.user_id = u.id
     LEFT JOIN modules m ON m.id = um.module_id
     WHERE u.id = $1
     GROUP BY u.id`,
    [payload.sub]
  );
  if (!rows.length) return null;

  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    cpf: row.cpf,
    isAdmin: row.is_admin,
    grantedSlugs: row.granted_slugs,
  };
}

async function requireAuth(req, res, next) {
  const user = await loadUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Não autenticado." });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Acesso restrito ao administrador." });
    next();
  });
}

function requireModulePage(slug) {
  return async (req, res, next) => {
    const user = await loadUserFromRequest(req);
    if (!user) return res.redirect("/");
    if (!user.isAdmin && !user.grantedSlugs.includes(slug)) return res.redirect("/");
    req.user = user;
    next();
  };
}

function requireAdminPage(req, res, next) {
  loadUserFromRequest(req).then((user) => {
    if (!user || !user.isAdmin) return res.redirect("/");
    req.user = user;
    next();
  });
}

module.exports = {
  COOKIE_NAME,
  setSessionCookie,
  clearSessionCookie,
  loadUserFromRequest,
  requireAuth,
  requireAdmin,
  requireModulePage,
  requireAdminPage,
};
