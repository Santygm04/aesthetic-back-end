// routes/stats_snapshots.js
const express = require("express");
const {
  rebuildLastNDays,
  clearSnapshots,
  refreshDayFor,
  summaryFromSnapshots,
} = require("../lib/statsSnapshot");

const router = express.Router();

/* ====== Auth ======
   - En dev (NODE_ENV !== production) y sin ADMIN_SECRET => permite.
   - En prod: si hay ADMIN_SECRET, hay que mandarlo.
*/
const REQUIRED = (process.env.ADMIN_SECRET || "").trim();
const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

function getSecret(req) {
  return (
    req.get("x-admin-secret") ||
    req.query.admin_secret ||
    req.query.secret ||
    ""
  );
}
function adminAuth(req, res, next) {
  const given = getSecret(req);
  console.log(`[snap] ${req.method} ${req.originalUrl} :: auth=${given ? "yes" : "no"} prod=${isProd} reqd=${REQUIRED ? "yes" : "no"}`);

  if (!isProd && !REQUIRED) return next(); // dev sin secret => libre
  if (!REQUIRED) return next();            // prod sin secret configurado => libre

  if (!given) return res.status(401).json({ message: "Falta x-admin-secret" });
  if (given !== REQUIRED) return res.status(401).json({ message: "Admin secret inválido" });
  next();
}

/* ====== Helper de respuesta rápida ====== */
function ok(res, payload = {}) {
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({ ok: true, ...payload });
}
function fail(res, err) {
  const msg = err?.message || "Error de servidor";
  console.error("[stats_snapshots] ERROR:", msg);
  return res.status(500).json({ ok: false, message: msg });
}

/* ====== Healthcheck rápido ====== */
// GET /api/payments/stats/snapshot/health
router.get("/health", adminAuth, (req, res) => ok(res, { ts: Date.now() }));

/* ====== Summary desde snapshots ====== */
// GET /api/payments/stats/snapshot/summary?range=7d|30d|12w
router.get("/summary", adminAuth, async (req, res) => {
  try {
    const range = String(req.query.range || "7d");
    const data = await summaryFromSnapshots(range);
    return res.json(data);
  } catch (e) {
    return fail(res, e);
  }
});

/* ====== Reconstruir últimos N días (ASÍNCRONO) ====== */
// POST /api/payments/stats/snapshot/run   { days }
router.post("/run", adminAuth, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.body?.days || 30, 10), 1), 365);
    // respondemos al toque
    ok(res, { started: true, days });

    // corremos en background
    setImmediate(async () => {
      console.log(`[snap] RUN start days=${days}`);
      const done = await rebuildLastNDays(days);
      console.log(`[snap] RUN done count=${done.length}`);
    });
  } catch (e) {
    return fail(res, e);
  }
});

/* ====== Limpiar ====== */
// DELETE /api/payments/stats/snapshot/clear
router.delete("/clear", adminAuth, async (_req, res) => {
  try {
    const r = await clearSnapshots();
    return ok(res, r);
  } catch (e) {
    return fail(res, e);
  }
});

/* ====== Reset: clear + run (ASÍNCRONO) ====== */
// POST /api/payments/stats/snapshot/reset  { days }
router.post("/reset", adminAuth, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.body?.days || 30, 10), 1), 365);
    ok(res, { started: true, days, reset: true });

    setImmediate(async () => {
      console.log(`[snap] RESET start days=${days}`);
      const clr = await clearSnapshots();
      const done = await rebuildLastNDays(days);
      console.log(`[snap] RESET done cleared=${clr.deleted} rebuilt=${done.length}`);
    });
  } catch (e) {
    return fail(res, e);
  }
});

/* ====== Recalcular un día puntual ====== */
// POST /api/payments/stats/snapshot/day/:ymd
router.post("/day/:ymd", adminAuth, async (req, res) => {
  try {
    const ymd = String(req.params.ymd);
    const doc = await refreshDayFor(ymd);
    return ok(res, { doc });
  } catch (e) {
    return fail(res, e);
  }
});

module.exports = router;
