// models/StatsDaily.js
const mongoose = require("mongoose");

const StatsDailySchema = new mongoose.Schema(
  {
    // Guardamos "YYYY-MM-DD" (UTC)
    date: { type: String, required: true }, // <- sin unique aquí para evitar duplicado
    from: { type: Date, required: true },   // 00:00Z del día
    to: { type: Date, required: true },     // 00:00Z del siguiente

    paidRevenue: { type: Number, default: 0 },
    ordersPaid: { type: Number, default: 0 },
    ordersAll: { type: Number, default: 0 },
    aov: { type: Number, default: 0 },

    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false, versionKey: false, collection: "stats_daily" }
);

// Índices (definidos una sola vez)
StatsDailySchema.index({ date: 1 }, { unique: true, name: "uniq_date" });
StatsDailySchema.index({ from: 1 });
StatsDailySchema.index({ to: 1 });

module.exports = mongoose.model("StatsDaily", StatsDailySchema);
