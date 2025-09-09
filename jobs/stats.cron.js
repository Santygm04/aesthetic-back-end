// jobs/stats.cron.js
const cron = require("node-cron");
const { rebuildLastNDays, refreshDayFor } = require("../lib/statsSnapshot");

const TZ = process.env.APP_TZ || "UTC";
const ENABLED = String(process.env.STATS_SNAPSHOTS_ENABLED || "true").toLowerCase() === "true";

function ymdTZ(date) {
  // 'en-CA' => YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function recalcToday() {
  const today = ymdTZ(new Date());
  await refreshDayFor(today);
  console.log("[stats-cron] today refreshed:", today);
}

function start() {
  if (!ENABLED) {
    console.log("[stats-cron] disabled");
    return;
  }

  const cronExpr = process.env.STATS_AUTO_REBUILD_CRON || "0 3 * * *"; // 03:00 todos los días
  const days = Number(process.env.STATS_REBUILD_DAYS || 90);
  const mins = Number(process.env.STATS_REFRESH_TODAY_MIN || 15);
  const bootstrap = Number(process.env.STATS_BOOTSTRAP_REBUILD_DAYS || 0);

  // Rebuild nocturno (ventana rolling de N días)
  cron.schedule(
    cronExpr,
    async () => {
      try {
        console.log("[stats-cron] nightly rebuild start:", days, "days");
        await rebuildLastNDays(days);
        await recalcToday();
        console.log("[stats-cron] nightly rebuild done");
      } catch (e) {
        console.error("[stats-cron] nightly rebuild error:", e);
      }
    },
    { timezone: TZ }
  );

  // Refresco de "hoy" cada X minutos (para que el día actual se actualice solo)
  if (mins > 0) {
    cron.schedule(
      `*/${mins} * * * *`,
      async () => {
        try {
          await recalcToday();
        } catch (e) {
          console.error("[stats-cron] refresh today error:", e);
        }
      },
      { timezone: TZ }
    );
  }

  // Bootstrap al arrancar (opcional)
  if (bootstrap > 0) {
    (async () => {
      try {
        console.log("[stats-cron] bootstrap rebuild:", bootstrap, "days");
        await rebuildLastNDays(bootstrap);
        await recalcToday();
        console.log("[stats-cron] bootstrap done");
      } catch (e) {
        console.error("[stats-cron] bootstrap error:", e);
      }
    })();
  }
}

module.exports = { start };
