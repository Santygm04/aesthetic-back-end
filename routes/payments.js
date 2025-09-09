// routes/payments.js
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const axios = require("axios");
const jwt = require("jsonwebtoken"); // 👈 NUEVO
const Order = require("../models/Order");

/* ===========================
 *  Uploads
 * =========================== */
const UP_DIR = path.join(process.cwd(), "uploads", "comprobantes");
fs.mkdirSync(UP_DIR, { recursive: true });

const upload = multer({
  dest: UP_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
});

/* ===========================
 *  WhatsApp helpers
 * =========================== */
const WSP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const WSP_PHONE_ID = process.env.WHATSAPP_PHONE_ID || "";
const ADMIN_PHONE = (process.env.ADMIN_PHONE || "").replace(/\D/g, "");
const NOTIFY_BUYER = String(process.env.WHATSAPP_NOTIFY_BUYER || "false").toLowerCase() === "true";
const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE || ""; // ej "54"

const WSP_TEMPLATE_TRANSFER = process.env.WHATSAPP_TEMPLATE_TRANSFER || "";
const WSP_TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || "es_AR";

// Admin / Webhook secrets
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
const BANK_WEBHOOK_SECRET = process.env.BANK_WEBHOOK_SECRET || "";
const JWT_SECRET = process.env.JWT_SECRET || "cambia-esto"; // 👈 NUEVO

/* ============ utils ============ */
const normalizePhone = (raw) => {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length >= 11) return digits;
  if (DEFAULT_CC && digits) return `${DEFAULT_CC}${digits}`;
  return digits || null;
};

const ars = (n) => {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(Number(n || 0));
  } catch {
    return `$${Number(n || 0)}`;
  }
};

async function sendWhatsAppTo(phoneDigits, text) {
  const to = (phoneDigits || "").replace(/\D/g, "");
  if (!WSP_TOKEN || !WSP_PHONE_ID || !to) return false;
  const url = `https://graph.facebook.com/v17.0/${WSP_PHONE_ID}/messages`;
  try {
    await axios.post(
      url,
      { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
      { headers: { Authorization: `Bearer ${WSP_TOKEN}` } }
    );
    return true;
  } catch (e) {
    console.warn("WhatsApp API (text) error:", e?.response?.data || e.message);
    return false;
  }
}

async function sendWhatsAppTemplate(toDigits, templateName, langCode, bodyParams = [], urlParam = null) {
  const to = (toDigits || "").replace(/\D/g, "");
  if (!WSP_TOKEN || !WSP_PHONE_ID || !to || !templateName) return false;

  const components = [];
  if (bodyParams.length) {
    components.push({
      type: "body",
      parameters: bodyParams.map((t) => ({ type: "text", text: String(t) })), // text
    });
  }
  if (urlParam) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: String(urlParam) }],
    });
  }

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: { name: templateName, language: { code: langCode }, components },
  };

  const url = `https://graph.facebook.com/v17.0/${WSP_PHONE_ID}/messages`;
  try {
    await axios.post(url, payload, { headers: { Authorization: `Bearer ${WSP_TOKEN}` } });
    return true;
  } catch (e) {
    console.warn("WhatsApp API (template) error:", e?.response?.data || e.message);
    return false;
  }
}

function makeWaLink(phoneDigits, text) {
  if (!phoneDigits) return null;
  const d = phoneDigits.replace(/\D/g, "");
  const msg = encodeURIComponent(text || "");
  return `https://wa.me/${d}?text=${msg}`;
}

function buildOrderWhatsAppText(order) {
  const b = order?.buyer || {};
  const sh = order?.shipping || {};
  const addr = sh.address || {};
  const lineDir =
    sh.method === "envio"
      ? `${addr.calle || ""} ${addr.numero || ""}${addr.piso ? `, ${addr.piso}` : ""}, ${addr.ciudad || ""}, ${addr.provincia || ""} (${addr.cp || ""})`
      : "Retiro en local";

  // 👇 detalle de items
  const itemsLines = (order.items || [])
    .map((it) => {
      const varPart = it?.variant?.size || it?.variant?.color
        ? ` (${[it?.variant?.size, it?.variant?.color].filter(Boolean).join(" / ")})`
        : "";
      return `• ${it.nombre}${varPart} x${it.cantidad} — ${ars(it.subtotal)}`;
    })
    .join("\n");

  const simpleCode = order?.orderNumber ? `#${order.orderNumber}` : null;

  return [
    `🧾 *Pedido AESTHETIC*`,
    ``,
    `*Pedido:* ${simpleCode || order.shippingTicket || order._id}`,
    `*Ticket:* ${order.shippingTicket}`,
    `*Estado:* ${order.status}`,
    `*Pago:* ${order.paymentMethod}`,
    ``,
    `*Cliente:* ${b.nombre || "-"}`,
    `*Tel:* ${b.telefono || "-"}`,
    `*Email:* ${b.email || "-"}`,
    ``,
    `*Entrega:* ${sh.method === "envio" ? "Envío a domicilio" : "Retiro en local"}`,
    `*Dirección:* ${sh.method === "envio" ? lineDir : "—"}`,
    ``,
    `*Productos:*`,
    itemsLines || "—",
    ``,
    `*Total:* ${ars(order.total)}`,
  ].join("\n");
}

async function notifyOrderByWhatsApp(order) {
  const adminDigits = ADMIN_PHONE;
  const buyerDigits = normalizePhone(order?.buyer?.telefono);

  const text = `🧾 *Nuevo pedido pendiente*\n\n${buildOrderWhatsAppText(order)}`;
  if (adminDigits) await sendWhatsAppTo(adminDigits, text);

  if (NOTIFY_BUYER && buyerDigits) {
    if (WSP_TEMPLATE_TRANSFER) {
      const entrega = order.shipping?.method === "envio" ? "Envío a domicilio" : "Retiro en local";
      await sendWhatsAppTemplate(
        buyerDigits,
        WSP_TEMPLATE_TRANSFER,
        WSP_TEMPLATE_LANG,
        [
          order?.buyer?.nombre || "",
          order?.orderNumber ? `#${order.orderNumber}` : (order?.shippingTicket || ""),
          ars(order?.total),
          entrega,
          order?.shippingTicket || "",
        ],
        order?.orderNumber || order?._id || null
      );
    } else {
      // 👇 Fallback texto al comprador (incluye nro simple y resumen)
      const itemsResumen = (order.items || [])
        .map((it) => `${it.nombre} x${it.cantidad}`)
        .join(", ");
      const shortText =
        `¡Hola ${order?.buyer?.nombre || ""}! Recibimos tu pedido ✅\n` +
        `Pedido: ${order?.orderNumber ? `#${order.orderNumber}` : order?._id}\n` +
        `Total: ${ars(order?.total)}\n` +
        (itemsResumen ? `Resumen: ${itemsResumen}\n` : "") +
        `Ticket: ${order?.shippingTicket}\n` +
        `Te vamos a escribir por WhatsApp para coordinar la entrega.`;
      await sendWhatsAppTo(buyerDigits, shortText);
    }
  }

  return ADMIN_PHONE ? makeWaLink(ADMIN_PHONE, text) : null;
}

async function notifyBuyerConfirmed(order) {
  try {
    if (!NOTIFY_BUYER) return;
    const buyerDigits = normalizePhone(order?.buyer?.telefono);
    if (!buyerDigits) return;

    const text =
      `🎉 ¡Listo, ${order?.buyer?.nombre || "tu pedido"} fue *confirmado*!` +
      `\nPedido: ${order?.orderNumber ? `#${order.orderNumber}` : order?._id}` +
      `\nTicket: ${order?.shippingTicket}` +
      `\nTotal: ${ars(order?.total)}` +
      `\nEn breve coordinamos el ${order?.shipping?.method === "envio" ? "envío" : "retiro"} por WhatsApp.`;
    await sendWhatsAppTo(buyerDigits, text);
  } catch (e) {
    console.warn("notifyBuyerConfirmed error:", e?.message || e);
  }
}

async function notifyAdminConfirmed(order) {
  try {
    if (!ADMIN_PHONE) return;
    const text =
      `✅ *Pago confirmado*\n\n${buildOrderWhatsAppText(order)}\n\n` +
      `🔖 *Acción:* preparar ${order?.shipping?.method === "envio" ? "envío" : "retiro"}.`;
    await sendWhatsAppTo(ADMIN_PHONE, text);
  } catch (e) {
    console.warn("notifyAdminConfirmed error:", e?.message || e);
  }
}

/* ===== base FRONT ===== */
function resolveFrontBase(req) {
  const envFront = (process.env.FRONT_URL || process.env.FRONT_ORIGIN || "").trim();
  const fromHeader = (req.headers.origin || req.headers.referer || "").trim();
  const candidate = envFront || fromHeader || "http://localhost:5173";
  try {
    const u = new URL(candidate);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "http://localhost:5173";
  }
}

/* ===========================
 *  DEBUG
 * =========================== */
router.get("/debug", (req, res) => {
  return res.json({
    ok: true,
    resolvedFrontBase: resolveFrontBase(req),
    whatsapp: {
      hasToken: !!WSP_TOKEN,
      hasPhoneId: !!WSP_PHONE_ID,
      admin: ADMIN_PHONE ? "set" : "missing",
      templateTransfer: WSP_TEMPLATE_TRANSFER || null,
    },
  });
});

/* =========================================================
 *  SSE (Server-Sent Events) para actualizaciones en vivo
 * ========================================================= */
const streamsByOrder = new Map(); // orderId -> [res, res, ...]

function sseWrite(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastOrderUpdate(order) {
  const key = String(order._id);
  const listeners = streamsByOrder.get(key);
  if (listeners && listeners.length) {
    listeners.forEach((r) =>
      sseWrite(r, "update", { id: order._id, status: order.status })
    );
  }
}

router.get("/order/:id/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const key = String(req.params.id);
  let bucket = streamsByOrder.get(key);
  if (!bucket) streamsByOrder.set(key, (bucket = []));
  bucket.push(res);

  try {
    const o = await Order.findById(key).lean();
    if (o) sseWrite(res, "update", { id: o._id, status: o.status });
  } catch {}

  const keep = setInterval(() => res.write(":\n\n"), 25000);

  req.on("close", () => {
    clearInterval(keep);
    const arr = streamsByOrder.get(key) || [];
    const idx = arr.indexOf(res);
    if (idx >= 0) arr.splice(idx, 1);
    if (!arr.length) streamsByOrder.delete(key);
  });
});

/* ===========================
 *  TRANSFERENCIA (crear orden)
 * =========================== */
router.post("/transfer", upload.single("comprobante"), async (req, res) => {
  try {
    const total = Number(req.body.total || 0);
    const buyer = JSON.parse(req.body.buyer || "{}");
    const items = JSON.parse(req.body.items || "[]");
    const alias = String(req.body.alias || "").trim();
    const shipping = JSON.parse(req.body.shipping || "{}");

    const normalizedItems = items.map((i) => ({
      productId: i.productId || undefined,
      nombre: i.nombre,
      precio: Number(i.precio),
      cantidad: Number(i.cantidad || 1),
      subtotal: Number(i.precio) * Number(i.cantidad || 1),
      variant: i.variant || undefined,
    }));

    let order = await Order.create({
      buyer,
      items: normalizedItems,
      total,
      paymentMethod: "transfer",
      transfer: { alias, receiptPath: null },
      shipping: {
        method: shipping?.method || "envio",
        company: "andreani",
        address: shipping?.address || {},
      },
      status: "pending",
    });

    if (req.file) {
      const safeName = req.file.originalname.replace(/[^a-z0-9.\-_]/gi, "_");
      const finalRel = path.join("uploads", "comprobantes", `${order._id}-${safeName}`);
      const finalAbs = path.join(process.cwd(), finalRel);
      fs.renameSync(req.file.path, finalAbs);
      order.transfer.receiptPath = `/${finalRel}`;
      await order.save();
    }

    await notifyOrderByWhatsApp(order);
    broadcastOrderUpdate(order);

    res.json({
      ok: true,
      orderId: order._id,
      ticket: order.shippingTicket,
      orderNumber: order.orderNumber, // 👈 NUEVO: devolvemos nro simple
    });
  } catch (e) {
    console.error("POST /transfer ERROR:", e);
    res.status(500).json({ message: "Error al registrar transferencia" });
  }
});

/* ===========================
 *  Auth helper admin
 * =========================== */
function isAdmin(req) {
  // 1) Preferimos JWT válido con rol admin
  const hdr = req.headers["authorization"] || "";
  if (hdr.startsWith("Bearer ")) {
    try {
      const token = hdr.slice(7);
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload && (payload.role === "admin" || payload.role === "staff")) {
        return true;
      }
    } catch { /* ignore */ }
  }

  // 2) Fallback: ADMIN_SECRET (compatibilidad con panel que envía x-admin-secret)
  const fromHeader = (req.headers["x-admin-secret"] || "").trim();
  const fromBody = (req.body?.secret || "").trim();
  const s = fromHeader || fromBody;
  return Boolean(ADMIN_SECRET) && s === ADMIN_SECRET;
}

/* ===========================
 *  LISTAR ÓRDENES (ADMIN)
 * =========================== */
router.get("/orders", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ message: "No autorizado" });

    const status = String(req.query.status || "").trim();
    const q = {};
    if (status) q.status = status;

    const orders = await Order.find(q)
      .sort({ createdAt: -1 })
      .limit(250)
      .lean();

    return res.json({ ok: true, orders });
  } catch (e) {
    console.error("GET /orders error:", e);
    res.status(500).json({ message: "Error al listar órdenes" });
  }
});

/* ===========================
 *  Confirmar / Cancelar (ADMIN)
 * =========================== */
router.post("/order/:id/confirm", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ message: "No autorizado" });

    const o = await Order.findByIdAndUpdate(
      req.params.id,
      { status: "paid" },
      { new: true }
    );
    if (!o) return res.status(404).json({ message: "No encontrado" });

    await notifyBuyerConfirmed(o);
    await notifyAdminConfirmed(o);
    broadcastOrderUpdate(o);

    // 👉 link para abrir el chat de la vendedora con el pedido confirmado
    const adminLink = makeWaLink(
      ADMIN_PHONE,
      `✅ *Pago confirmado*\n\n${buildOrderWhatsAppText(o)}`
    );

    return res.json({
      ok: true,
      id: o._id,
      status: o.status,
      orderNumber: o.orderNumber, // 👈
      whatsappLink: adminLink
    });
  } catch (e) {
    console.error("confirm order error:", e);
    res.status(500).json({ message: "Error al confirmar" });
  }
});

async function cancelHandler(req, res) {
  try {
    if (!isAdmin(req)) return res.status(401).json({ message: "No autorizado" });

    const o = await Order.findByIdAndUpdate(
      req.params.id,
      { status: "cancelled" },
      { new: true }
    );
    if (!o) return res.status(404).json({ message: "No encontrado" });

    broadcastOrderUpdate(o);
    return res.json({ ok: true, id: o._id, status: o.status, orderNumber: o.orderNumber });
  } catch (e) {
    console.error("cancel order error:", e);
    res.status(500).json({ message: "Error al cancelar" });
  }
}
router.post("/order/:id/cancel", cancelHandler);
router.post("/order/:id/reject", cancelHandler);

/* =========================================================
 *  WEBHOOK para auto-confirmar transferencias
 * ========================================================= */
router.post("/transfer/webhook", async (req, res) => {
  try {
    const secret = String(req.body?.secret || "");
    if (!BANK_WEBHOOK_SECRET || secret !== BANK_WEBHOOK_SECRET) {
      return res.status(401).json({ message: "No autorizado" });
    }

    const amount = Number(req.body?.amount || 0);
    const alias = String(req.body?.alias || "").trim().toUpperCase();
    const ticket = String(req.body?.ticket || "").trim();
    const buyerPhone = normalizePhone(req.body?.buyerPhone || "");

    if (!amount) return res.status(400).json({ message: "Falta amount" });

    let o = null;
    if (ticket) {
      o = await Order.findOne({
        shippingTicket: ticket,
        paymentMethod: "transfer",
        status: "pending",
      });
    }

    if (!o) {
      const since = new Date(Date.now() - 72 * 60 * 60 * 1000);
      const q = {
        status: "pending",
        paymentMethod: "transfer",
        createdAt: { $gte: since },
        total: amount,
      };
      if (alias) q["transfer.alias"] = new RegExp(`^${alias}$`, "i");
      const candidates = await Order.find(q).sort({ createdAt: -1 }).limit(5);
      if (candidates.length === 1) {
        o = candidates[0];
      } else if (!o && candidates.length > 1 && buyerPhone) {
        o = candidates.find((c) => normalizePhone(c?.buyer?.telefono) === buyerPhone) || null;
      }
    }

    if (!o) {
      return res.status(404).json({ message: "No se encontró orden pendiente que coincida" });
    }

    o.status = "paid";
    await o.save();

    await notifyBuyerConfirmed(o);
    await notifyAdminConfirmed(o);
    broadcastOrderUpdate(o);

    return res.json({ ok: true, id: o._id, status: o.status, orderNumber: o.orderNumber });
  } catch (e) {
    console.error("transfer webhook error:", e);
    res.status(500).json({ message: "Error al procesar webhook" });
  }
});

/* ===========================
 *  Obtener una orden
 * =========================== */
router.get("/order/:id", async (req, res) => {
  try {
    const o = await Order.findById(req.params.id).lean();
    if (!o) return res.status(404).json({ message: "No encontrado" });
    return res.json({
      id: o._id,
      status: o.status,
      total: o.total,
      buyer: o.buyer,
      paymentMethod: o.paymentMethod,
      shippingTicket: o.shippingTicket,
      orderNumber: o.orderNumber, // 👈 NUEVO
      createdAt: o.createdAt,
      mp: o.mp,
      shipping: o.shipping,
      transfer: o.transfer,
    });
  } catch (e) {
    console.error("GET /order/:id ERROR:", e);
    res.status(500).json({ message: "Error al obtener orden" });
  }
});

module.exports = router;

// // routes/payments.js
// const express = require("express");
// const router = express.Router();
// const fs = require("fs");
// const path = require("path");
// const multer = require("multer");
// const axios = require("axios");
// const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
// const Order = require("../models/Order");

// /* ===========================
//  *  Mercado Pago – setup
//  * =========================== */
// const MP_TOKEN = process.env.MP_ACCESS_TOKEN || "";
// const hasToken = typeof MP_TOKEN === "string" && MP_TOKEN.trim().length > 0;
// const tokenType = hasToken ? (MP_TOKEN.startsWith("TEST-") ? "TEST" : "PROD") : "NONE";
// const mpClient = hasToken ? new MercadoPagoConfig({ accessToken: MP_TOKEN }) : null;

// const mask = (t = "") => (t.length <= 10 ? t : `${t.slice(0, 6)}…${t.slice(-4)}`);
// console.log(`[MP] Token: ${hasToken ? mask(MP_TOKEN) : "NO_TOKEN"} | Tipo: ${tokenType}`);

// /* ===========================
//  *  Uploads
//  * =========================== */
// const UP_DIR = path.join(process.cwd(), "uploads", "comprobantes");
// fs.mkdirSync(UP_DIR, { recursive: true });

// const upload = multer({
//   dest: UP_DIR,
//   limits: { fileSize: 10 * 1024 * 1024 },
// });

// /* ===========================
//  *  WhatsApp helpers
//  * =========================== */
// const WSP_TOKEN = process.env.WHATSAPP_TOKEN || "";
// const WSP_PHONE_ID = process.env.WHATSAPP_PHONE_ID || "";
// const ADMIN_PHONE = (process.env.ADMIN_PHONE || "").replace(/\D/g, "");
// const NOTIFY_BUYER = String(process.env.WHATSAPP_NOTIFY_BUYER || "false").toLowerCase() === "true";
// const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE || ""; // ej "54"

// /** Normaliza un número a dígitos con país. */
// function normalizePhone(raw) {
//   if (!raw) return null;
//   let digits = String(raw).replace(/\D/g, "");
//   // Si ya viene con país (11+ dígitos), lo dejamos
//   if (digits.length >= 11) return digits;
//   // Si no, y tenemos default CC, lo anteponemos
//   if (DEFAULT_CC && digits) return `${DEFAULT_CC}${digits}`;
//   return digits || null;
// }

// /** Envía un WhatsApp (texto) a un teléfono dado. */
// async function sendWhatsAppTo(phoneDigits, text) {
//   const to = (phoneDigits || "").replace(/\D/g, "");
//   if (!WSP_TOKEN || !WSP_PHONE_ID || !to) return false;

//   const url = `https://graph.facebook.com/v17.0/${WSP_PHONE_ID}/messages`;
//   try {
//     await axios.post(
//       url,
//       {
//         messaging_product: "whatsapp",
//         to: to,
//         type: "text",
//         text: { body: text },
//       },
//       { headers: { Authorization: `Bearer ${WSP_TOKEN}` } }
//     );
//     return true;
//   } catch (e) {
//     console.warn("WhatsApp API error:", e?.response?.data || e.message);
//     return false;
//   }
// }

// /** Crea un link wa.me para abrir el chat manualmente. */
// function makeWaLink(phoneDigits, text) {
//   if (!phoneDigits) return null;
//   const d = phoneDigits.replace(/\D/g, "");
//   const msg = encodeURIComponent(text || "");
//   return `https://wa.me/${d}?text=${msg}`;
// }

// /** Formatea ARS simple. */
// function ars(n) {
//   try {
//     return new Intl.NumberFormat("es-AR", {
//       style: "currency",
//       currency: "ARS",
//       maximumFractionDigits: 0,
//     }).format(Number(n || 0));
//   } catch {
//     return `$${Number(n || 0)}`;
//   }
// }

// /** Arma el texto del pedido para WhatsApp. */
// function buildOrderWhatsAppText(order) {
//   const b = order?.buyer || {};
//   const sh = order?.shipping || {};
//   const addr = sh.address || {};
//   const lineDir = sh.method === "envio"
//     ? `${addr.calle || ""} ${addr.numero || ""}${addr.piso ? `, ${addr.piso}` : ""}, ${addr.ciudad || ""}, ${addr.provincia || ""} (${addr.cp || ""})`
//     : "Retiro en local";

//   const items = (order.items || [])
//     .map(it => `• ${it.nombre} x${it.cantidad} — ${ars(it.subtotal)}`)
//     .join("\n");

//   const lines = [
//     `🧾 *Nuevo pedido AESTHETIC*`,
//     "",
//     `*Ticket:* ${order.shippingTicket}`,
//     `*Pedido:* ${order._id}`,
//     `*Estado:* ${order.status}`,
//     `*Pago:* ${order.paymentMethod === "mercadopago" ? "Mercado Pago" : order.paymentMethod}`,
//     "",
//     `*Cliente:* ${b.nombre || "-"}`,
//     `*Tel:* ${b.telefono || "-"}`,
//     `*Email:* ${b.email || "-"}`,
//     "",
//     `*Entrega:* ${sh.method === "envio" ? "Envío a domicilio" : "Retiro en local"}`,
//     `*Dirección:* ${lineDir}`,
//     "",
//     `*Productos:*`,
//     items || "-",
//     "",
//     `*Total:* ${ars(order.total)}`,
//   ];

//   return lines.join("\n");
// }

// /** Envía las notificaciones de WhatsApp (admin y opcionalmente comprador) para un pedido. */
// async function notifyOrderByWhatsApp(order) {
//   try {
//     const text = buildOrderWhatsAppText(order);

//     // 1) Admin SIEMPRE
//     if (ADMIN_PHONE) {
//       const okAdmin = await sendWhatsAppTo(ADMIN_PHONE, text);
//       if (!okAdmin) console.warn("No se pudo notificar por WhatsApp al admin.");
//     }

//     // 2) Comprador (opcional, requiere políticas de WhatsApp; ideal usar template)
//     if (NOTIFY_BUYER && order?.buyer?.telefono) {
//       const buyerDigits = normalizePhone(order.buyer.telefono);
//       if (buyerDigits) {
//         const okBuyer = await sendWhatsAppTo(buyerDigits, text);
//         if (!okBuyer) console.warn("No se pudo notificar por WhatsApp al comprador.");
//       }
//     }

//     // Fallback link por si querés mostrar un botón "Abrir WhatsApp"
//     const link = ADMIN_PHONE ? makeWaLink(ADMIN_PHONE, text) : null;
//     return link;
//   } catch (e) {
//     console.warn("notifyOrderByWhatsApp error:", e?.message || e);
//     return null;
//   }
// }

// /* ===========================
//  *  Base del FRONT
//  * =========================== */
// function resolveFrontBase(req) {
//   const envFront = (process.env.FRONT_URL || process.env.FRONT_ORIGIN || "").trim();
//   const fromHeader = (req.headers.origin || req.headers.referer || "").trim();
//   const candidate = envFront || fromHeader || "http://localhost:5173";
//   try {
//     const u = new URL(candidate);
//     return `${u.protocol}//${u.host}`;
//   } catch {
//     return "http://localhost:5173";
//   }
// }

// /* ===== DEBUG ===== */
// router.get("/debug", (req, res) => {
//   return res.json({
//     ok: true,
//     hasToken,
//     tokenType,
//     maskedToken: hasToken ? mask(MP_TOKEN) : null,
//     resolvedFrontBase: resolveFrontBase(req),
//   });
// });

// /* ========== MP helper: payment_method_id desde token (BIN) ========== */
// async function resolvePaymentMethodIdFromToken(token) {
//   try {
//     if (!token) return null;

//     const tRes = await axios.get(
//       `https://api.mercadopago.com/v1/card_tokens/${encodeURIComponent(token)}`,
//       { headers: { Authorization: `Bearer ${MP_TOKEN}` } }
//     );
//     const firstSix =
//       tRes?.data?.first_six_digits ||
//       tRes?.data?.bin ||
//       (tRes?.data?.card_number_id ? String(tRes.data.card_number_id).slice(0, 6) : null);

//     if (!firstSix) return null;

//     const pmRes = await axios.get(
//       `https://api.mercadopago.com/v1/payment_methods/search?bin=${firstSix}`,
//       { headers: { Authorization: `Bearer ${MP_TOKEN}` } }
//     );

//     const r = pmRes?.data;
//     const id =
//       r?.results?.[0]?.id ||
//       r?.payment_methods?.[0]?.id ||
//       r?.[0]?.id ||
//       null;

//     return id || null;
//   } catch (e) {
//     console.warn("resolvePaymentMethodIdFromToken error:", e?.response?.data || e.message);
//     return null;
//   }
// }

// /* ===========================
//  *  PAGOS CON TARJETA (Bricks)
//  * =========================== */
// router.post("/mp/pay-card", async (req, res) => {
//   try {
//     if (!mpClient) {
//       return res.status(400).json({
//         message: "Mercado Pago no está configurado.",
//         error: "Falta MP_ACCESS_TOKEN en el backend (.env)",
//       });
//     }

//     const { total = 0, buyer = {}, shipping = {}, items = [], card = {} } = req.body || {};
//     if (!card?.token) {
//       return res.status(400).json({ message: "Falta token de tarjeta" });
//     }

//     // 1) Orden pending
//     const normalizedItems = (items || []).map((i) => ({
//       nombre: i.nombre || i.title || "Producto",
//       precio: Number(i.precio || i.unit_price || 0),
//       cantidad: Number(i.cantidad || i.quantity || 1),
//       subtotal: Number(i.precio || i.unit_price || 0) * Number(i.cantidad || i.quantity || 1),
//     }));

//     const order = await Order.create({
//       buyer,
//       items: normalizedItems,
//       total: Number(total),
//       paymentMethod: "mercadopago",
//       shipping: {
//         method: shipping?.method || "envio",
//         company: "andreani",
//         address: shipping?.address || {},
//       },
//       status: "pending",
//     });

//     // 2) Resolver método de pago si no vino
//     let paymentMethodId = card.payment_method_id || null;
//     if (!paymentMethodId) {
//       paymentMethodId = await resolvePaymentMethodIdFromToken(card.token);
//     }

//     // 3) Crear pago MP
//     const payment = new Payment(mpClient);
//     const body = {
//       transaction_amount: Number(total),
//       token: card.token,
//       installments: Number(card.installments || 1),
//       payment_method_id: paymentMethodId || undefined,
//       issuer_id: card.issuer_id ? String(card.issuer_id) : undefined,
//       description: "Compra en AESTHETIC",
//       binary_mode: true,
//       payer: {
//         email: (card?.payer?.email || buyer?.email || "").trim() || undefined,
//         identification: card?.payer?.identification || undefined,
//       },
//       external_reference: String(order._id),
//     };

//     const mpRes = await payment.create({ body });
//     const status = mpRes?.status || mpRes?.body?.status || "pending"; // approved | rejected | in_process
//     const idPago = mpRes?.id || mpRes?.body?.id;

//     await Order.findByIdAndUpdate(order._id, {
//       status: status === "approved" ? "paid" : status,
//       "mp.paymentId": String(idPago || ""),
//       "mp.status": status,
//     });

//     // WhatsApp si quedó pagado
//     let whatsappLink = null;
//     if (status === "approved") {
//       const fresh = await Order.findById(order._id).lean();
//       whatsappLink = await notifyOrderByWhatsApp(fresh);
//     }

//     return res.json({
//       ok: true,
//       orderId: order._id,
//       status,
//       paymentId: idPago,
//       ticket: order.shippingTicket,
//       whatsappLink, // por si querés mostrar un botón "Abrir WhatsApp"
//     });
//   } catch (e) {
//     const apiErr = e?.response?.data || e?.message || e;
//     console.error("POST /mp/pay-card ERROR:", apiErr);

//     let message = "No se pudo procesar el pago con tarjeta";
//     const txt = JSON.stringify(apiErr).toLowerCase();
//     if (txt.includes("payment_method_id")) {
//       message = "No pudimos identificar la tarjeta. Reingresá los primeros dígitos.";
//     }
//     if (txt.includes("identification")) {
//       message = "Falta el documento del titular. Completalo y probá de nuevo.";
//     }

//     return res.status(500).json({ message, error: apiErr });
//   }
// });

// /* ===========================
//  *  TRANSFERENCIA
//  * =========================== */
// router.post("/transfer", upload.single("comprobante"), async (req, res) => {
//   try {
//     const total = Number(req.body.total || 0);
//     const buyer = JSON.parse(req.body.buyer || "{}");
//     const items = JSON.parse(req.body.items || "[]");
//     const alias = String(req.body.alias || "").trim();
//     const shipping = JSON.parse(req.body.shipping || "{}");

//     const normalizedItems = items.map((i) => ({
//       productId: i.productId || undefined,
//       nombre: i.nombre,
//       precio: Number(i.precio),
//       cantidad: Number(i.cantidad || 1),
//       subtotal: Number(i.precio) * Number(i.cantidad || 1),
//     }));

//     let order = await Order.create({
//       buyer,
//       items: normalizedItems,
//       total,
//       paymentMethod: "transfer",
//       transfer: { alias, receiptPath: null },
//       shipping: {
//         method: shipping?.method || "envio",
//         company: "andreani",
//         address: shipping?.address || {},
//       },
//       status: "pending",
//     });

//     if (req.file) {
//       const safeName = req.file.originalname.replace(/[^a-z0-9.\-_]/gi, "_");
//       const finalRel = path.join("uploads", "comprobantes", `${order._id}-${safeName}`);
//       const finalAbs = path.join(process.cwd(), finalRel);
//       fs.renameSync(req.file.path, finalAbs);
//       order.transfer.receiptPath = `/${finalRel}`;
//       await order.save();
//     }

//     // Notificación WhatsApp (transferencia es pending; avisamos al admin para revisar)
//     const text =
//       `🧾 *Nueva transferencia recibida*\n\n` +
//       `*Ticket:* ${order.shippingTicket}\n` +
//       `*Pedido:* ${order._id}\n` +
//       `*Cliente:* ${buyer.nombre} | ${buyer.telefono}\n` +
//       `*Email:* ${buyer.email}\n` +
//       `*Total:* ${ars(total)}\n` +
//       `*Alias:* ${alias}\n` +
//       `Estado: pending (revisar comprobante)`;
//     if (ADMIN_PHONE) await sendWhatsAppTo(ADMIN_PHONE, text);

//     const fallbackLink = ADMIN_PHONE ? makeWaLink(ADMIN_PHONE, text) : null;

//     res.json({
//       ok: true,
//       orderId: order._id,
//       ticket: order.shippingTicket,
//       whatsappLink: fallbackLink,
//     });
//   } catch (e) {
//     console.error("POST /transfer ERROR:", e);
//     res.status(500).json({ message: "Error al registrar transferencia" });
//   }
// });

// /* ===========================
//  *  MP: Crear preferencia (Checkout Pro)
//  * =========================== */
// router.post("/mp/create-preference", async (req, res) => {
//   try {
//     if (!mpClient) {
//       return res.status(400).json({
//         message: "Mercado Pago no está configurado.",
//         error: "Falta MP_ACCESS_TOKEN en el backend (.env)",
//       });
//     }

//     const { items = [], total = 0, buyer = {}, shipping = {} } = req.body || {};

//     const normalizedItems = (items || []).map((i) => ({
//       title: i.title,
//       quantity: Number(i.quantity || 1),
//       unit_price: Number(i.unit_price),
//       currency_id: "ARS",
//     }));

//     const order = await Order.create({
//       buyer,
//       items: normalizedItems.map((i) => ({
//         nombre: i.title,
//         precio: i.unit_price,
//         cantidad: i.quantity,
//         subtotal: i.unit_price * i.quantity,
//       })),
//       total: Number(total),
//       paymentMethod: "mercadopago",
//       shipping: {
//         method: shipping?.method || "envio",
//         company: "andreani",
//         address: shipping?.address || {},
//       },
//       status: "pending",
//     });

//     const frontBase = resolveFrontBase(req);
//     const back_urls = {
//       success: `${frontBase}/pago/exito?o=${order._id}`,
//       failure: `${frontBase}/pago/error?o=${order._id}`,
//       pending: `${frontBase}/pago/pending?o=${order._id}`,
//     };
//     console.log("[MP] back_urls:", back_urls);

//     const preference = new Preference(mpClient);
//     const pref = await preference.create({
//       body: {
//         items: normalizedItems,
//         payer: { name: buyer?.nombre, email: buyer?.email },
//         back_urls,
//         ...(process.env.PUBLIC_URL
//           ? { notification_url: `${process.env.PUBLIC_URL}/api/payments/mp/webhook` }
//           : {}),
//         external_reference: String(order._id),
//       },
//     });

//     const prefId = pref?.id || pref?.body?.id || null;
//     const initPoint =
//       pref?.init_point ||
//       pref?.sandbox_init_point ||
//       pref?.body?.init_point ||
//       pref?.body?.sandbox_init_point ||
//       null;

//     order.mp = { preferenceId: String(prefId || "") };
//     await order.save();

//     if (!initPoint) {
//       return res.status(500).json({
//         message: "Preferencia creada sin URL de inicio",
//         error: "Falta init_point/sandbox_init_point en la respuesta",
//         preferenceId: prefId,
//       });
//     }

//     res.json({
//       init_point: initPoint,
//       preferenceId: prefId,
//       orderId: order._id,
//       ticket: order.shippingTicket,
//     });
//   } catch (e) {
//     const details = e?.response?.data || e?.message || e;
//     console.error("POST /mp/create-preference ERROR:", details);
//     res.status(500).json({ message: "No se pudo crear la preferencia", error: details });
//   }
// });

// /* ===========================
//  *  MP: Webhook (cambios de estado)
//  * =========================== */
// router.post("/mp/webhook", async (req, res) => {
//   try {
//     if (!mpClient) return res.sendStatus(200);

//     const paymentId = req.query["data.id"] || req.body?.data?.id;
//     if (paymentId) {
//       const p = new Payment(mpClient);
//       const info = await p.get({ id: paymentId });
//       const status = info?.status || info?.body?.status;
//       const orderId = info?.external_reference || info?.body?.external_reference;

//       if (orderId) {
//         await Order.findByIdAndUpdate(orderId, {
//           status: status === "approved" ? "paid" : status,
//           "mp.paymentId": String(paymentId),
//           "mp.status": status,
//         });

//         // Si quedó pagado por webhook, avisamos por WhatsApp
//         if (status === "approved") {
//           const fresh = await Order.findById(orderId).lean();
//           await notifyOrderByWhatsApp(fresh);
//         }
//       }
//     }
//     res.sendStatus(200);
//   } catch (e) {
//     console.error("MP webhook error:", e?.response?.data || e.message || e);
//     res.sendStatus(200);
//   }
// });

// /* ===========================
//  *  Obtener orden
//  * =========================== */
// router.get("/order/:id", async (req, res) => {
//   try {
//     const o = await Order.findById(req.params.id).lean();
//     if (!o) return res.status(404).json({ message: "No encontrado" });
//     return res.json({
//       id: o._id,
//       status: o.status,
//       total: o.total,
//       buyer: o.buyer,
//       paymentMethod: o.paymentMethod,
//       shippingTicket: o.shippingTicket,
//       createdAt: o.createdAt,
//       mp: o.mp,
//       shipping: o.shipping,
//       transfer: o.transfer,
//     });
//   } catch (e) {
//     console.error("GET /order/:id ERROR:", e);
//     res.status(500).json({ message: "Error al obtener orden" });
//   }
// });

// module.exports = router;
