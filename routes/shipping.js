// routes/shipping.js
const express = require("express");
const router = express.Router();
const Order = require("../models/Order");

// Simulador de alta de envío en Andreani.
// Si tenés credenciales de Andreani, podés reemplazar el simulador por la llamada real.
function generateTracking() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
  const rnd = Math.floor(100000 + Math.random() * 900000);
  return `AND-${stamp}-${rnd}`;
}

router.post("/andreani", async (req, res) => {
  try {
    const { orderId } = req.body || {};
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Orden no encontrada" });

    if (order.shipping?.method !== "envio") {
      return res.status(400).json({ message: "La orden no requiere envío (retiro en local)." });
    }

    if (order.shipping?.trackingNumber) {
      return res.json({ trackingNumber: order.shipping.trackingNumber });
    }

    // Aca iría la llamada real a Andreani con datos de address, items, etc.
    // Por ahora, simulamos:
    const tracking = generateTracking();

    order.shipping.trackingNumber = tracking;
    await order.save();

    res.json({ ok: true, trackingNumber: tracking });
  } catch (e) {
    console.error("POST /shipping/andreani ERROR:", e);
    res.status(500).json({ message: "No se pudo generar el envío" });
  }
});

module.exports = router;
