// routes/products.realtime.js
const express = require("express");
const router = express.Router();

const Producto = require("../models/Producto");
const { sseHeaders, addClient } = require("../realtime");

// Helper: manda snapshot inicial (opcional pero recomendado)
async function sendInitialProducts(res) {
  try {
    const list = await Producto.find({ visible: true })
      .sort({ updatedAt: -1 })
      .limit(300)
      .lean();

    // mandamos evento snapshot
    res.write(`event: product:snapshot\n`);
    res.write(`data: ${JSON.stringify(list)}\n\n`);
  } catch (e) {
    // no matamos el stream por esto
    res.write(`event: product:snapshot\n`);
    res.write(`data: ${JSON.stringify([])}\n\n`);
  }
}

// ✅ SSE stream (alias 1)
router.get("/products/stream", async (req, res) => {
  sseHeaders(res);
  addClient(res);

  // snapshot inicial para que el front se pinte sin esperar cambios
  await sendInitialProducts(res);
});

// ✅ SSE stream (alias 2)
router.get("/productos/stream", async (req, res) => {
  sseHeaders(res);
  addClient(res);

  await sendInitialProducts(res);
});

module.exports = router;