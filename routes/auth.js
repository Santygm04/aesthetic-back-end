// routes/auth.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// para poder recibir <form method="post"> application/x-www-form-urlencoded
router.use(express.urlencoded({ extended: false }));

const JWT_SECRET = process.env.JWT_SECRET || "cambia-esto";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

// ===== Bootstrap opcional del primer admin =====
(async function ensureFirstAdmin() {
  try {
    const u = (process.env.ADMIN_DEFAULT_USER || "").trim();
    const p = (process.env.ADMIN_DEFAULT_PASS || "").trim();
    if (!u || !p) return;

    const exists = await User.findOne({ username: u.toLowerCase() });
    if (exists) return;

    const hash = await bcrypt.hash(p, 10);
    await User.create({
      username: u.toLowerCase(),
      name: "Administrador",
      role: "admin",
      passwordHash: hash,
    });
    console.log(`[auth] Admin creado: ${u}`);
  } catch (e) {
    console.warn("[auth] Bootstrap admin error:", e.message);
  }
})();

// ===== Middleware simple para validar JWT =====
function authMiddleware(req, res, next) {
  const hdr = req.headers.authorization || "";
  if (!hdr.startsWith("Bearer ")) return res.status(401).json({ message: "No autorizado" });
  const token = hdr.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ message: "Token inválido" });
  }
}

// ===== Helpers admin-secret =====
function hasAdminSecret(req) {
  const fromHeader = (req.headers["x-admin-secret"] || "").trim();
  const fromBody = (req.body?.secret || "").trim();
  const s = fromHeader || fromBody;
  return Boolean(ADMIN_SECRET) && s === ADMIN_SECRET;
}
function secretEquals(value) {
  return Boolean(ADMIN_SECRET) && String(value || "").trim() === ADMIN_SECRET;
}

// ===== POST /api/auth/login =====
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: "Faltan credenciales" });

    const u = await User.findOne({ username: String(username).toLowerCase(), active: true });
    if (!u) return res.status(401).json({ message: "Usuario o contraseña inválidos" });

    const ok = await u.checkPassword(password);
    if (!ok) return res.status(401).json({ message: "Usuario o contraseña inválidos" });

    const token = jwt.sign(
      { sub: String(u._id), username: u.username, role: u.role, name: u.name || "" },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    return res.json({
      ok: true,
      token,
      user: { id: u._id, username: u.username, name: u.name, role: u.role },
    });
  } catch (e) {
    console.error("POST /auth/login error:", e);
    return res.status(500).json({ message: "Error al iniciar sesión" });
  }
});

// ===== GET /api/auth/me =====
router.get("/me", authMiddleware, async (req, res) => {
  return res.json({ ok: true, user: req.user });
});

/* =========================================================
 *  A) API JSON para setear credenciales (Postman/cURL)
 *     POST /api/auth/admin/set-credentials
 *     Headers: x-admin-secret: <ADMIN_SECRET>
 *     Body: { username, password, name? }
 * ========================================================= */
router.post("/admin/set-credentials", async (req, res) => {
  try {
    if (!hasAdminSecret(req)) return res.status(401).json({ message: "No autorizado" });

    const { username, password, name } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: "Faltan datos" });

    const uname = String(username).toLowerCase().trim();
    const hash = await bcrypt.hash(password, 10);

    let u = await User.findOne({ username: uname });
    if (!u) {
      u = await User.create({
        username: uname,
        name: name || "Administrador",
        role: "admin",
        passwordHash: hash,
        active: true,
      });
    } else {
      u.username = uname;
      if (name) u.name = name;
      u.passwordHash = hash;
      u.active = true;
      await u.save();
    }

    return res.json({
      ok: true,
      user: { id: u._id, username: u.username, name: u.name, role: u.role },
      message: "Credenciales actualizadas",
    });
  } catch (e) {
    console.error("POST /auth/admin/set-credentials error:", e);
    return res.status(500).json({ message: "No se pudo actualizar credenciales" });
  }
});

/* =========================================================
 *  B) FORMULARIO WEB (para usar desde el navegador)
 *     GET  /api/auth/admin-reset -> muestra formulario
 *     POST /api/auth/admin/reset-form -> procesa el form
 * ========================================================= */
router.get("/admin-reset", (req, res) => {
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<title>Reset admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0f172a;
       min-height:100vh;display:grid;place-items:center;margin:0}
  .card{background:#111827;color:#e5e7eb;padding:22px;border-radius:14px;width:min(92vw,420px);
        box-shadow:0 20px 60px rgba(0,0,0,.4);border:1px solid #1f2937}
  h1{margin:0 0 10px;font-size:20px}
  label{display:block;font-weight:700;margin-top:10px;font-size:14px}
  input{width:100%;padding:10px;border-radius:10px;border:1px solid #374151;background:#0b1220;
        color:#e5e7eb;margin-top:6px}
  .hint{color:#9ca3af;font-size:12px;margin:2px 0 8px}
  button{width:100%;padding:12px;border:0;border-radius:999px;margin-top:14px;font-weight:900;
         background:#22c55e;color:#fff;box-shadow:0 12px 30px rgba(34,197,94,.25);cursor:pointer}
  .small{font-size:12px;color:#9ca3af;margin-top:10px;text-align:center}
</style>
</head>
<body>
  <form class="card" method="post" action="/api/auth/admin/reset-form">
    <h1>Actualizar credenciales admin</h1>
    <div class="hint">Necesitás el <strong>ADMIN_SECRET</strong> que está en tu .env</div>
    <label>ADMIN_SECRET</label>
    <input name="secret" placeholder="ej: superclave123" required />

    <label>Nuevo usuario</label>
    <input name="username" placeholder="ej: admin.paula" required />

    <label>Nueva contraseña</label>
    <input name="password" type="password" placeholder="Mínimo 8 caracteres" required />

    <label>Nombre a mostrar (opcional)</label>
    <input name="name" placeholder="Paula" />

    <button type="submit">Guardar</button>
    <div class="small">POST /api/auth/admin/set-credentials</div>
  </form>
</body>
</html>`;
  res.type("html").send(html);
});

router.post("/admin/reset-form", async (req, res) => {
  try {
    const { secret, username, password, name } = req.body || {};
    if (!secretEquals(secret)) {
      return res
        .status(401)
        .type("html")
        .send("<h2 style='font-family:sans-serif'>No autorizado: ADMIN_SECRET inválido</h2>");
    }
    if (!username || !password) {
      return res
        .status(400)
        .type("html")
        .send("<h2 style='font-family:sans-serif'>Faltan datos</h2>");
    }

    const uname = String(username).toLowerCase().trim();
    const hash = await bcrypt.hash(password, 10);

    let u = await User.findOne({ username: uname });
    if (!u) {
      u = await User.create({
        username: uname,
        name: name || "Administrador",
        role: "admin",
        passwordHash: hash,
        active: true,
      });
    } else {
      u.username = uname;
      if (name) u.name = name;
      u.passwordHash = hash;
      u.active = true;
      await u.save();
    }

    return res
      .type("html")
      .send(
        `<!doctype html><meta charset="utf-8"/><body style="font-family:sans-serif;padding:24px">
          <h2>✅ Listo: credenciales actualizadas</h2>
          <p>Usuario: <b>${u.username}</b></p>
          <p>Ahora podés ir a tu panel y <a href="${(process.env.FRONT_URL||'http://localhost:5173')}/login">iniciar sesión</a>.</p>
        </body>`
      );
  } catch (e) {
    console.error("POST /auth/admin/reset-form error:", e);
    return res
      .status(500)
      .type("html")
      .send("<h2 style='font-family:sans-serif'>Error al actualizar credenciales</h2>");
  }
});

/* =========================================================
 *  C) Cambio de contraseña
 *     Soporta dos flujos:
 *     1) Logueado (Bearer token): { currentPassword, newPassword }  ó { actual, nueva }
 *     2) Sin token (desde Login): { usuario|username, actual, nueva }  ó { usuario|username, currentPassword, newPassword }
 * ========================================================= */
router.post("/change-password", async (req, res) => {
  try {
    const hdr = req.headers.authorization || "";
    const hasBearer = hdr.startsWith("Bearer ");

    // --- Flujo 1: con token (usuario logueado) ---
    if (hasBearer) {
      let payload;
      try {
        payload = jwt.verify(hdr.slice(7), JWT_SECRET);
      } catch {
        return res.status(401).json({ message: "Token inválido" });
      }
      const { currentPassword, newPassword, actual, nueva } = req.body || {};
      const cur = currentPassword || actual;
      const nw = newPassword || nueva;

      if (!cur || !nw) return res.status(400).json({ message: "Faltan datos" });

      const u = await User.findById(payload.sub);
      if (!u) return res.status(404).json({ message: "No encontrado" });

      const ok = await u.checkPassword(cur);
      if (!ok) return res.status(401).json({ message: "Contraseña actual incorrecta" });

      u.passwordHash = await bcrypt.hash(String(nw), 10);
      await u.save();
      return res.json({ ok: true, message: "Contraseña actualizada" });
    }

    // --- Flujo 2: sin token (desde pantalla de Login) ---
    const { usuario, username, actual, nueva, currentPassword, newPassword } = req.body || {};
    const uname = String(username || usuario || "").trim().toLowerCase();
    const cur = currentPassword || actual;
    const nw = newPassword || nueva;

    if (!uname || !cur || !nw) {
      return res.status(400).json({ message: "Faltan datos (usuario, actual, nueva)" });
    }

    const u = await User.findOne({ username: uname, active: true });
    if (!u) return res.status(404).json({ message: "Usuario no encontrado" });

    const ok = await u.checkPassword(cur);
    if (!ok) return res.status(401).json({ message: "Contraseña actual incorrecta" });

    u.passwordHash = await bcrypt.hash(String(nw), 10);
    await u.save();

    return res.json({ ok: true, message: "Contraseña actualizada" });
  } catch (e) {
    console.error("POST /auth/change-password error:", e);
    return res.status(500).json({ message: "No se pudo cambiar la contraseña" });
  }
});

module.exports = { router, authMiddleware };
