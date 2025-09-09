// backend/routes/stats.js
const express = require("express");
const router = express.Router();
const Order = require("../models/Order");

/* =================== Helpers de fechas =================== */
const ymd = (d) => new Date(d).toISOString().slice(0, 10); // YYYY-MM-DD
const startOfDayUTC = (d) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
const addDaysUTC = (d, n) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n, 0, 0, 0));

function rangeFromLabel(label) {
  const now = new Date();
  const to = startOfDayUTC(addDaysUTC(now, 1)); // mañana 00:00Z
  let from;
  if (label === "30d") from = addDaysUTC(to, -30);
  else if (label === "12w") from = addDaysUTC(to, -84);
  else from = addDaysUTC(to, -7);
  return { from, to };
}

/* =================== Agregación LIVE =================== */
async function liveSummary(rangeLabel = "7d") {
  const { from, to } = rangeFromLabel(rangeLabel);
  const paidStatuses = ["paid", "approved"];

  const pipeline = [
    { $match: { createdAt: { $gte: from, $lt: to } } },
    {
      $project: {
        total: 1,
        createdAt: 1,
        day: { $dateToString: { date: "$createdAt", timezone: "UTC", format: "%Y-%m-%d" } },
        isPaid: { $in: ["$status", paidStatuses] },
      },
    },
    {
      $group: {
        _id: "$day",
        ordersAll: { $sum: 1 },
        ordersPaid: { $sum: { $cond: ["$isPaid", 1, 0] } },
        paidRevenue: { $sum: { $cond: ["$isPaid", "$total", 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ];

  const rows = await Order.aggregate(pipeline);

  const map = new Map(rows.map((r) => [r._id, r]));
  const seriesByDay = [];
  const days = Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 86400000));
  for (let i = 0; i < days; i++) {
    const d0 = addDaysUTC(from, i);
    const k = ymd(d0);
    const r = map.get(k);
    seriesByDay.push(
      r
        ? { date: k, ordersAll: r.ordersAll, ordersPaid: r.ordersPaid, paidRevenue: r.paidRevenue }
        : { date: k, ordersAll: 0, ordersPaid: 0, paidRevenue: 0 }
    );
  }

  const totals = seriesByDay.reduce(
    (acc, d) => {
      acc.ordersAll += d.ordersAll;
      acc.ordersPaid += d.ordersPaid;
      acc.paidRevenue += d.paidRevenue;
      return acc;
    },
    { ordersAll: 0, ordersPaid: 0, paidRevenue: 0 }
  );
  totals.aov = totals.ordersPaid ? totals.paidRevenue / totals.ordersPaid : 0;

  return {
    from: ymd(from),
    to: ymd(addDaysUTC(to, -1)),
    generatedAt: new Date().toISOString(),
    totals,
    seriesByDay,
  };
}

/* =================== Auth light =================== */
// Requiere ADMIN_SECRET sólo en producción y si está configurado.
const REQUIRED = (process.env.ADMIN_SECRET || "").trim();
const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

function getAdminSecret(req) {
  return (
    req.get("x-admin-secret") ||
    req.query.admin_secret ||
    req.query.secret ||
    ""
  );
}

function hasAccess(req) {
  if (!isProd) return true;       // en dev: libre
  if (!REQUIRED) return true;     // en prod pero sin secret configurado: libre
  return getAdminSecret(req) === REQUIRED;
}

/* =================== REST: summary =================== */
router.get("/stats/summary", async (req, res) => {
  try {
    if (!hasAccess(req)) return res.status(401).json({ message: "No autorizado" });
    const range = String(req.query.range || "7d");
    const data = await liveSummary(range);
    res.json(data);
  } catch (e) {
    console.error("[stats-summary] error:", e);
    res.status(500).json({ message: "Error generando estadísticas" });
  }
});

/* =================== SSE: stream =================== */
router.get("/stats/stream", async (req, res) => {
  try {
    if (!hasAccess(req)) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("No autorizado");
      return;
    }

    const range = String(req.query.range || "7d");

    // Cabeceras SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    if (req.headers.origin) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
      res.setHeader("Vary", "Origin");
    }
    // Evita que Node cierre por timeout
    res.connection && (res.connection.setTimeout(0));
    res.flushHeaders?.();

    console.log(`[stats-sse] open range=${range} ip=${req.ip}`);

    const send = async () => {
      try {
        const payload = await liveSummary(range);
        res.write(`event: stats\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (e) {
        console.error("[stats-sse] tick error:", e?.message || e);
      }
    };

    // Primer envío
    await send();

    // Mantener viva la conexión (algunos proxies la cortan)
    const ping = setInterval(() => {
      try { res.write(`: ping ${Date.now()}\n\n`); } catch {}
    }, 15000);

    // Actualización periódica
    const tick = setInterval(send, 30000);

    req.on("close", () => {
      clearInterval(tick);
      clearInterval(ping);
      console.log("[stats-sse] client closed");
      try { res.end(); } catch {}
    });
  } catch (e) {
    console.error("[stats-sse] fatal:", e);
    try { res.status(500).end(); } catch {}
  }
});

module.exports = router;
