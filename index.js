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

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server/Postman
    console.log("[CORS] Origin recibido:", origin);

    if (explicitlyAllowed.size > 0) {
      if (explicitlyAllowed.has(origin)) return cb(null, true);
      if (!isProd && isLocalhost(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
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

app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static("uploads"));

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
