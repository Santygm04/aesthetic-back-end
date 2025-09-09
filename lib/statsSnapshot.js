// lib/statsSnapshot.js
const StatsDaily = require("../models/StatsDaily");
const Order = require("../models/Order");

// -------- helpers de fechas --------
const ymd = (d) => new Date(d).toISOString().slice(0, 10); // "YYYY-MM-DD"
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
  else from = addDaysUTC(to, -7); // 7d default
  return { from, to };
}

function daysBetween(from, to) {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.ceil(ms / 86400000));
}

// -------- agregaciones --------
async function computeDay(from, to) {
  // Agrega sobre Order (no cambiar nombres de campos)
  const match = { createdAt: { $gte: from, $lt: to } };
  const paidStatuses = ["paid", "approved"];

  const pipeline = [
    { $match: match },
    {
      $project: {
        total: 1,
        isPaid: { $in: ["$status", paidStatuses] },
      },
    },
    {
      $group: {
        _id: null,
        ordersAll: { $sum: 1 },
        ordersPaid: { $sum: { $cond: ["$isPaid", 1, 0] } },
        paidRevenue: { $sum: { $cond: ["$isPaid", "$total", 0] } },
      },
    },
  ];

  const agg = await Order.aggregate(pipeline);
  const row = agg[0] || { ordersAll: 0, ordersPaid: 0, paidRevenue: 0 };
  const aov = row.ordersPaid ? row.paidRevenue / row.ordersPaid : 0;

  return {
    ordersAll: row.ordersAll,
    ordersPaid: row.ordersPaid,
    paidRevenue: row.paidRevenue,
    aov,
  };
}

async function refreshDayFor(dateYMD) {
  const parts = dateYMD.split("-").map(Number);
  if (parts.length !== 3) throw new Error("Formato de fecha inválido, usar YYYY-MM-DD");
  const from = startOfDayUTC(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])));
  const to = addDaysUTC(from, 1);

  const calc = await computeDay(from, to);

  const doc = await StatsDaily.findOneAndUpdate(
    { date: dateYMD },
    {
      $set: {
        date: dateYMD,
        from,
        to,
        paidRevenue: calc.paidRevenue,
        ordersPaid: calc.ordersPaid,
        ordersAll: calc.ordersAll,
        aov: calc.aov,
        generatedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  return doc;
}

async function rebuildLastNDays(n = 30) {
  const today0 = startOfDayUTC(new Date());
  const from = addDaysUTC(today0, -n);
  const total = daysBetween(from, today0);
  const done = [];

  for (let i = 0; i < total; i++) {
    const d0 = addDaysUTC(from, i);
    const dateYMD = ymd(d0);
    const doc = await refreshDayFor(dateYMD);
    done.push({
      date: doc.date,
      paidRevenue: doc.paidRevenue,
      ordersPaid: doc.ordersPaid,
      ordersAll: doc.ordersAll,
    });
  }
  return done;
}

async function listSnapshots(fromYMD, toYMD) {
  const q = {};
  if (fromYMD) q.date = { ...q.date, $gte: fromYMD };
  if (toYMD) q.date = { ...(q.date || {}), $lte: toYMD };
  return StatsDaily.find(q).sort({ date: 1 }).lean();
}

async function clearSnapshots() {
  const r = await StatsDaily.deleteMany({});
  return { deleted: r.deletedCount || 0 };
}

async function summaryFromSnapshots(rangeLabel = "7d") {
  const { from, to } = rangeFromLabel(rangeLabel);
  const fromYMD = ymd(from);
  const lastDayYMD = ymd(addDaysUTC(to, -1)); // hoy inclusive

  const rows = await listSnapshots(fromYMD, lastDayYMD);

  // Serie por día
  const map = new Map();
  for (const row of rows) {
    map.set(row.date, {
      date: row.date,
      ordersAll: row.ordersAll,
      ordersPaid: row.ordersPaid,
      paidRevenue: row.paidRevenue,
    });
  }

  // Aseguramos días faltantes con cero
  const seriesByDay = [];
  const days = daysBetween(from, to);
  for (let i = 0; i < days; i++) {
    const d0 = addDaysUTC(from, i);
    const k = ymd(d0);
    seriesByDay.push(map.get(k) || { date: k, ordersAll: 0, ordersPaid: 0, paidRevenue: 0 });
  }

  // Totales
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
    from: fromYMD,
    to: lastDayYMD,
    generatedAt: new Date().toISOString(),
    totals,
    seriesByDay,
  };
}

module.exports = {
  refreshDayFor,
  rebuildLastNDays,
  listSnapshots,
  clearSnapshots,
  summaryFromSnapshots,
};
