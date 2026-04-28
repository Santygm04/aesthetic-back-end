const dns = require('node:dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);

// backend/index.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const productosRoutes = require("./routes/productos");
const paymentsRoutes = require("./routes/payments");
const shippingRoutes = require("./routes/shipping");
const Producto = require("./models/Producto");
const StatsDaily = require("./models/StatsDaily"); // para syncIndexes
const { router: authRouter } = require("./routes/auth"); // 👈 Auth JWT

mongoose.set("autoIndex", true);

const app = express();
const PORT = process.env.PORT || 3000;

// 💡 Recomendado en producción detrás de proxy (Railway/Render/Nginx)
app.set("trust proxy", 1);

/* ===========================
   CORS robusto (multi-origen)
=========================== */
const isProd = process.env.NODE_ENV === "production";

const parseOrigins = (str) =>
  (str || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const explicitlyAllowed = new Set(parseOrigins(process.env.FRONT_ORIGIN));
const isLocalhost = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "");

// ✅ IMPORTANTE: CORS options
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server/Postman/curl
    console.log("[CORS] Origin recibido:", origin);

    if (explicitlyAllowed.size > 0) {
      if (explicitlyAllowed.has(origin)) return cb(null, true);
      if (!isProd && isLocalhost(origin)) return cb(null, true);
      return cb(null, false);
    }

    // Sin FRONT_ORIGIN definido: permitir localhost en dev
    if (!isProd && isLocalhost(origin)) return cb(null, true);

    // En prod sin FRONT_ORIGIN, permitir todo (ajústalo si querés forzar whitelist)
    return cb(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  // importante: header del panel admin
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-secret"],
};

// ✅ 1) Aplicar CORS antes de todo
app.use(cors(corsOptions));

// ✅ 2) Responder preflight SIEMPRE (esto arregla tu error)
app.options(/.*/, cors(corsOptions));

// ✅ 3) JSON después de CORS
app.use(express.json({ limit: "10mb" }));

app.use("/uploads", express.static("uploads"));

/* ✅ 4) Middleware para manejar errores de CORS y que el navegador reciba respuesta clara
   (evita que se “corte” y termine en Failed to fetch sin info)
*/
app.use((err, req, res, next) => {
  if (err && err.message && err.message.includes("CORS")) {
    return res.status(403).json({ ok: false, message: "CORS bloqueado: " + err.message });
  }
  return next(err);
});

/* ============ Healthcheck simple ============ */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || "development",
    db: mongoose?.connection?.readyState === 1 ? "up" : "down",
  });
});

/* ============ RUTAS ============ */

/**
 * 👇 0) Auth (login real con JWT)
 */
app.use("/api/auth", authRouter);

/**
 * 👇 1) Endpoints de STATS antes de /api/payments (para que no
 *     los intercepte el auth global de paymentsRoutes)
 */

// Snapshots (botones del panel)
app.use("/api/payments/stats/snapshot", require("./routes/stats_snapshots"));

// Stats en vivo + SSE
app.use("/api/payments", require("./routes/stats"));

/* ============ SITEMAP DINÁMICO DE PRODUCTOS ============ */
app.get("/sitemap-productos.xml", async (req, res) => {
  try {
    const items = await Producto.find(
      { visible: { $ne: false }, stock: { $gt: 0 } },
      { _id: 1, nombre: 1, updatedAt: 1 }
    ).lean();

    const frontBase = (process.env.FRONT_URL || "https://aestheticmakeup.com.ar").replace(/\/$/, "");

    const urls = items.map(p =>
      `  <url>\n    <loc>${frontBase}/producto/${p._id}</loc>\n    <lastmod>${new Date(p.updatedAt).toISOString().split("T")[0]}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`
    ).join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(xml);
  } catch (e) {
    console.error("GET /sitemap-productos.xml ERROR:", e);
    res.status(500).send("Error generando sitemap");
  }
});



/**
 * 👇 2) Resto de rutas
 */
app.use("/api/productos", productosRoutes);
app.use("/api/shipping", shippingRoutes);

// Rutas de pagos (estas pueden tener su auth/global tranquilamente)
app.use("/api/payments", paymentsRoutes);

// Productos en tiempo real (SSE productos)
app.use("/api", require("./routes/products.realtime"));

/* ============ CRON ============ */
try {
  const snapshotsEnabled = String(process.env.STATS_SNAPSHOTS_ENABLED || "true").toLowerCase() === "true";
  if (isProd && snapshotsEnabled) {
    require("./jobs/stats.cron").start();
    console.log("[stats-cron] iniciado (producción)");
  } else {
    console.log("[stats-cron] deshabilitado (NODE_ENV != production o STATS_SNAPSHOTS_ENABLED=false)");
  }
} catch (e) {
  console.warn("[stats-cron] not started:", e?.message || e);
}

/* ========= Helpers DB ========= */
// Garantiza que exista el doc de contador para orderNumber
async function ensureOrderCounter() {
  const coll = mongoose.connection.collection("counters");
  await coll.updateOne(
    { _id: "orders" },
    { $setOnInsert: { seq: 0 } },
    { upsert: true }
  );
}

/* ============ DB ============ */
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ Conectado a MongoDB");
    console.log("DB usada:", mongoose.connection.name);

    // 👇 Aseguramos el contador de órdenes
    await ensureOrderCounter();

    try {
      await Promise.all([Producto.syncIndexes(), StatsDaily.syncIndexes()]);
      console.log("✅ Índices sincronizados");
    } catch (e) {
      console.warn("⚠️ No se pudieron sincronizar índices:", e?.message || e);
    }

    app.listen(PORT, () => console.log(`🚀 API en http://localhost:${PORT}`));
  })
  .catch((err) => console.error("❌ Error al conectar a MongoDB:", err));