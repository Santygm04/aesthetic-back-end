// routes/payments.js
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const axios = require("axios");
const jwt = require("jsonwebtoken"); // 👈 NUEVO
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");// ✅ MERCADO PAGO
const Order = require("../models/Order");
const Producto = require("../models/Producto"); // 👈 NUEVO: para stock

/* ===========================
 *  Mercado Pago config (SDK v2)
 * =========================== */
const mpAccessToken = (process.env.MP_ACCESS_TOKEN || "").trim();
let mpClient = null;
let mpPreference = null;
let mpPayment = null;

if (mpAccessToken) {
  mpClient = new MercadoPagoConfig({ accessToken: mpAccessToken });
  mpPreference = new Preference(mpClient);
  mpPayment = new Payment(mpClient);
  console.log("[MP] SDK listo. Token seteado:", true);
} else {
  console.warn("[MP] MP_ACCESS_TOKEN no está seteado (Mercado Pago deshabilitado)");
}
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
const BANK_WEBHOOK_SECRET = process.envBANK_WEBHOOK_SECRET || process.env.BANK_WEBHOOK_SECRET || "";
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

/* ===== base BACK (para webhook) ===== */
function resolveBackBase(req) {
  const envBack = (process.env.PUBLIC_URL || process.env.BACK_URL || "").trim();
  if (envBack) return envBack.replace(/\/$/, "");
  // fallback por si estás local
  return `${req.protocol}://${req.get("host")}`;
}

/* ===========================
 *  DEBUG
 * =========================== */
router.get("/debug", (req, res) => {
  return res.json({
    ok: true,
    resolvedFrontBase: resolveFrontBase(req),
    resolvedBackBase: resolveBackBase(req),
    mp: {
      hasAccessToken: !!process.env.MP_ACCESS_TOKEN,
    },
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
      // ✅ Helpers locales (solo para este endpoint)
    const toNumber = (v) => {
      if (v === null || v === undefined) return 0;
      if (typeof v === "number" && Number.isFinite(v)) return v;

      // soporta: "20000", "20.000", "20,000", "$20.000", " 20.000 "
      let s = String(v).trim();
      s = s.replace(/\$/g, "").replace(/\s/g, "");

      // Si viene con miles AR "20.000" (y NO tiene coma decimal), quitamos puntos
      // Ej: "20.000" => "20000"
      if (/\d+\.\d{3}(\.\d{3})*(,\d+)?$/.test(s) && !s.includes(",")) {
        s = s.replace(/\./g, "");
      }

      // Convertimos coma decimal a punto decimal: "123,45" => "123.45"
      if (s.includes(",")) {
        // si trae puntos de miles y coma decimal: "20.000,50" => "20000,50" => "20000.50"
        s = s.replace(/\./g, "").replace(/,/g, ".");
      }

      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    };

    const safeJson = (raw, fallback) => {
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    };

    // ✅ Parseo body (FormData => strings)
    const buyer = safeJson(req.body.buyer || "{}", {});
    const items = safeJson(req.body.items || "[]", []);
    const alias = String(req.body.alias || "").trim();
    const shipping = safeJson(req.body.shipping || "{}", {});
    const receivedTotalRaw = req.body.total; // <- lo guardamos para debug

    // ✅ Normalizar items
    const normalizedItems = (Array.isArray(items) ? items : []).map((i) => {
      const precio = toNumber(i.precio);
      const cantidad = Math.max(1, Math.floor(toNumber(i.cantidad || 1)));
      const subtotal = Number((precio * cantidad).toFixed(2));

      return {
        productId: i.productId || undefined,
        nombre: i.nombre,
        precio,
        cantidad,
        subtotal,
        variant: i.variant || undefined,
      };
    });

    // ✅ Total calculado desde items (fuente de verdad)
    const computedTotal = Number(
      normalizedItems.reduce((acc, it) => acc + toNumber(it.subtotal), 0).toFixed(2)
    );

    // ✅ Total recibido (fallback) - parse robusto
    const receivedTotal = toNumber(receivedTotalRaw);

    // ✅ Total final
    const finalTotal = computedTotal > 0 ? computedTotal : receivedTotal;

    // ✅ Si no hay items válidos, evitamos orden basura
    if (!normalizedItems.length) {
      return res.status(400).json({ ok: false, message: "Items requeridos" });
    }

    // ✅ Debug (1 minuto): sacalo después
    const DEBUG = true;
    if (DEBUG) {
      console.log("[/transfer] total recibido raw:", receivedTotalRaw);
      console.log("[/transfer] total recibido parsed:", receivedTotal);
      console.log("[/transfer] computedTotal:", computedTotal);
      console.log("[/transfer] finalTotal:", finalTotal);
      console.log("[/transfer] items:", normalizedItems);
      setTimeout(() => {
        // solo para “recordarte” sacarlo luego; no apaga logs automáticamente
        console.log("[/transfer] ⚠️ recordatorio: apagar logs DEBUG cuando verifiques");
      }, 60_000);
    }

    // ✅ Creamos orden usando FINAL TOTAL (no confiar en req.body.total)
    const baseDoc = {
      buyer,
      items: normalizedItems,
      total: finalTotal, // ✅ ACA está la corrección
      paymentMethod: "transfer",
      transfer: { alias, receiptPath: null },
      shipping: {
        method: shipping?.method || "envio",
        company: "andreani",
        address: shipping?.address || {},
      },
      status: "pending",
      // si tu schema lo tiene, mejor dejarlo explícito:
      stockAdjusted: false,
    };

    let order;
    try {
      order = await Order.create(baseDoc);
    } catch (err) {
      const dupOrderNumber =
        err?.code === 11000 &&
        (err?.keyPattern?.orderNumber || err?.errorResponse?.keyPattern?.orderNumber);
      if (dupOrderNumber) {
        console.warn("[/transfer] duplicate orderNumber, retrying once…");
        order = await Order.create(baseDoc);
      } else {
        throw err;
      }
    }

    // ✅ Guardar comprobante si vino
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

    return res.json({
      ok: true,
      orderId: order._id,
      ticket: order.shippingTicket,
      orderNumber: order.orderNumber,
      total: order.total,           // ✅ útil para validar rápido
      computedTotal,               // ✅ útil para validar rápido
    });
});

/* ===========================
 *  MERCADO PAGO (Checkout Pro)
 * =========================== */
router.post("/mp/create-preference", async (req, res) => {
  try {
    if (!mpPreference) {
      return res.status(400).json({
        ok: false,
        message: "Mercado Pago no configurado (faltan credenciales)",
      });
    }

    // ✅ helper robusto AR (igual idea que en /transfer)
    const toNumber = (v) => {
      if (v === null || v === undefined) return 0;
      if (typeof v === "number" && Number.isFinite(v)) return v;

      let s = String(v).trim();
      s = s.replace(/\$/g, "").replace(/\s/g, "");

      // "20.000" => "20000" (si no hay coma decimal)
      if (/\d+\.\d{3}(\.\d{3})*(,\d+)?$/.test(s) && !s.includes(",")) {
        s = s.replace(/\./g, "");
      }

      // "20.000,50" => "20000.50"
      if (s.includes(",")) {
        s = s.replace(/\./g, "").replace(/,/g, ".");
      }

      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    };

    const buyer = req.body.buyer || {};
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const shipping = req.body.shipping || {};

    if (!items.length) {
      return res.status(400).json({ ok: false, message: "Items requeridos" });
    }

    // ✅ normalizar items
    const normalizedItems = items.map((i) => {
      const precio = toNumber(i.precio);
      const cantidad = Math.max(1, Math.floor(toNumber(i.cantidad || 1)));
      const subtotal = Number((precio * cantidad).toFixed(2));

      return {
        productId: i.productId || undefined,
        nombre: i.nombre,
        precio,
        cantidad,
        subtotal,
        variant: i.variant || undefined,
      };
    });

    // ✅ total REAL desde items
    const computedTotal = Number(
      normalizedItems.reduce((acc, it) => acc + toNumber(it.subtotal), 0).toFixed(2)
    );

    // fallback por si te mandan total válido
    const receivedTotal = toNumber(req.body.total);

    const finalTotal = computedTotal > 0 ? computedTotal : receivedTotal;

    if (!finalTotal || finalTotal <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Total inválido (revisar precios/cantidades enviadas)",
        computedTotal,
        receivedTotal,
      });
    }

    const frontBase = resolveFrontBase(req);
    const backBase = resolveBackBase(req);

    console.log("[MP] create-preference:", {
      itemsCount: normalizedItems.length,
      computedTotal,
      receivedTotal,
      finalTotal,
      frontBase,
      backBase,
    });

    // ✅ creás la orden con total correcto
    const baseDoc = {
      buyer,
      items: normalizedItems,
      total: finalTotal, // ✅ FIX
      paymentMethod: "mercadopago",
      mp: { preferenceId: null, paymentId: null, status: "pending" },
      shipping: {
        method: shipping?.method || "envio",
        company: "andreani",
        address: shipping?.address || {},
      },
      status: "pending",
      stockAdjusted: false,
    };

    let order;
    try {
      order = await Order.create(baseDoc);
    } catch (err) {
      const dupOrderNumber =
        err?.code === 11000 &&
        (err?.keyPattern?.orderNumber || err?.errorResponse?.keyPattern?.orderNumber);
      if (dupOrderNumber) {
        console.warn("[/mp/create-preference] duplicate orderNumber, retrying once…");
        order = await Order.create(baseDoc);
      } else {
        throw err;
      }
    }

    // ✅ preferencia MP con unit_price numérico limpio
    const preference = {
      items: normalizedItems.map((it) => ({
        title: it.nombre || "Producto",
        quantity: Number(it.cantidad || 1),
        unit_price: Number(toNumber(it.precio)), // ✅ FIX
        currency_id: "ARS",
      })),

      back_urls: {
        success: `${frontBase}/pago/exito?o=${order._id}&fresh=1`,
        failure: `${frontBase}/pago/error?o=${order._id}&fresh=1`,
        pending: `${frontBase}/pago/pending?o=${order._id}&fresh=1`,
      },
      auto_return: "approved",

      notification_url: `${backBase}/api/payments/mp/webhook`,
      external_reference: String(order._id),
      metadata: { orderId: String(order._id) },
    };

    const mpRes = await mpPreference.create({ body: preference });
    const prefId = mpRes?.id;
    const initPoint = mpRes?.init_point;

    if (!prefId || !initPoint) {
      console.error("[MP] Respuesta inesperada:", mpRes);
      return res.status(500).json({ ok: false, message: "Mercado Pago no devolvió init_point" });
    }

    await Order.findByIdAndUpdate(order._id, {
      "mp.preferenceId": prefId,
      "mp.status": "pending",
    });

    return res.json({
      ok: true,
      orderId: order._id,
      preferenceId: prefId,
      init_point: initPoint,
      ticket: order.shippingTicket,
      orderNumber: order.orderNumber,
      total: order.total,        // ✅ para validar rápido
      computedTotal,             // ✅ debug
    });
  } catch (e) {
    console.error("POST /mp/create-preference ERROR:", e?.response?.data || e);
    return res.status(500).json({ ok: false, message: "Error creando preferencia MP" });
  }
});
router.post("/mp/webhook", async (req, res) => {
  try {
    // MP manda: ?type=payment&data.id=...
    const type = req.query.type || req.query.topic;
    const paymentId = req.query["data.id"] || req.query.id;

    if (type !== "payment" || !paymentId) {
      return res.status(200).send("ok");
    }

    if (!mpPayment) {
  // webhook: siempre responder ok para que MP no reintente infinito
  return res.status(200).send("ok");
}

const payment = await mpPayment.get({ id: String(paymentId) });
const p = payment; // SDK nuevo devuelve el objeto directo

    const orderId = p?.metadata?.orderId || p?.external_reference || null;
    if (!orderId) return res.status(200).send("ok");

    const status = p.status; // approved | rejected | pending | in_process
    const detail = p.status_detail;

    const newOrderStatus =
      status === "approved" ? "paid" :
      status === "rejected" ? "rejected" :
      "pending";

    const o = await Order.findById(orderId);
    if (!o) return res.status(200).send("ok");

    o.status = newOrderStatus;
    o.paymentMethod = "mercadopago";
    o.mp = {
      ...(o.mp || {}),
      paymentId: String(paymentId),
      status,
      status_detail: detail,
    };

    // ✅ si se aprobó, descontar stock una sola vez (igual que admin confirm)
    if (newOrderStatus === "paid" && !o.stockAdjusted) {
      await moveStock(o, "deduct");
      o.stockAdjusted = true;

      await notifyBuyerConfirmed(o);
      await notifyAdminConfirmed(o);
    }

    await o.save();
    broadcastOrderUpdate(o);

    return res.status(200).send("ok");
  } catch (e) {
    console.error("POST /mp/webhook ERROR:", e);
    // MP reintenta si devolvés 500, por eso respondemos ok
    return res.status(200).send("ok");
  }
});

/* ===========================
 *  Auth helper admin
 * =========================== */
function isAdmin(req) {
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
  const fromHeader = (req.headers["x-admin-secret"] || "").trim();
  const fromBody = (req.body?.secret || "").trim();
  const s = fromHeader || fromBody;
  return Boolean(ADMIN_SECRET) && s === ADMIN_SECRET;
}

/* ===========================
 *  Helpers de stock (mínimo)
 * =========================== */
async function moveStock(order, mode = "deduct") {
  const factor = mode === "deduct" ? -1 : +1;
  const ops = (order.items || [])
    .filter((it) => it.productId && it.cantidad)
    .map((it) =>
      Producto.updateOne(
        { _id: it.productId },
        { $inc: { stock: factor * Number(it.cantidad || 1) } }
      ).catch(() => null)
    );
  await Promise.allSettled(ops);
}

/* ===========================
 *  LISTAR ÓRDENES (ADMIN)
 * =========================== */
router.get("/orders", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ message: "No autorizado" });

    const status = String(req.query.status || "").trim();
    const q = {};

    if (status === "deleted") {
      // Solo mostrar eliminadas cuando se pide explícitamente
      q.status = "deleted";
    } else if (status) {
      // Filtro específico (pending, paid, etc.)
      q.status = status;
    } else {
      // "Todas" → excluir las eliminadas para no contaminar la vista
      q.status = { $ne: "deleted" };
    }

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

    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ message: "No encontrado" });

    o.status = "paid";

    if (!o.stockAdjusted) {
      await moveStock(o, "deduct");
      o.stockAdjusted = true;
    }

    await o.save();

    await notifyBuyerConfirmed(o);
    await notifyAdminConfirmed(o);
    broadcastOrderUpdate(o);

    const adminLink = makeWaLink(
      ADMIN_PHONE,
      `✅ *Pago confirmado*\n\n${buildOrderWhatsAppText(o)}`
    );

    return res.json({
      ok: true,
      id: o._id,
      status: o.status,
      orderNumber: o.orderNumber,
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

    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ message: "No encontrado" });

    if (o.stockAdjusted) {
      await moveStock(o, "restore");
      o.stockAdjusted = false;
    }
    o.status = "cancelled";
    await o.save();

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
 *  NUEVO: Logística simple (despacho/entrega)
 * ========================================================= */
router.post("/order/:id/ship", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ message: "No autorizado" });

    const { trackingNumber, company, method } = req.body || {};
    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ message: "No encontrado" });

    if (method === "envio" || method === "retiro") o.shipping.method = method;
    if (company) o.shipping.company = String(company).trim();
    if (trackingNumber) o.shipping.trackingNumber = String(trackingNumber).trim();
    o.shipping.shippedAt = new Date();

    await o.save();
    return res.json({ ok: true, id: o._id, shipping: o.shipping });
  } catch (e) {
    console.error("ship order error:", e);
    res.status(500).json({ message: "Error al marcar despachado" });
  }
});

router.post("/order/:id/delivered", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ message: "No autorizado" });

    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ message: "No encontrado" });

    o.shipping.deliveredAt = new Date();
    await o.save();
    return res.json({ ok: true, id: o._id, shipping: o.shipping });
  } catch (e) {
    console.error("delivered order error:", e);
    res.status(500).json({ message: "Error al marcar entregado" });
  }
});

router.delete("/order/:id/permanent", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ message: "No autorizado" });
    const o = await Order.findByIdAndDelete(req.params.id);
    if (!o) return res.status(404).json({ message: "No encontrado" });
    return res.json({ ok: true, id: String(o._id) });
  } catch (e) {
    console.error("DELETE permanent error:", e);
    res.status(500).json({ message: "Error al eliminar permanentemente" });
  }
});

/* ===========================
 *  ELIMINAR orden (soft-delete → status: deleted)
 * =========================== */
router.delete("/order/:id", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ message: "No autorizado" });

    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ message: "No encontrado" });

    // Soft-delete: cambia el status a "deleted" en lugar de borrar de la DB
    // Así aparece en el filtro "Eliminadas" del panel admin
    o.status = "deleted";
    o.deletedAt = new Date();
    await o.save();

    return res.json({ ok: true, id: String(o._id) });
  } catch (e) {
    console.error("delete order error:", e);
    res.status(500).json({ message: "Error al eliminar" });
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
      orderNumber: o.orderNumber,
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

/* =========================================================
 *  PÚBLICO: traer varias órdenes por ids / códigos guardados
 * ========================================================= */
router.get("/orders/public/by-ids", async (req, res) => {
  try {
    const ids = String(req.query.ids || "").split(",").map(s=>s.trim()).filter(Boolean);
    const codes = String(req.query.codes || "").split(",").map(s=>s.trim()).filter(Boolean);

    const $or = [];
    if (ids.length) $or.push({ _id: { $in: ids } });

    const tickets = codes.filter(c => /^AE-\d{8}-\d{4,}$/.test(c));
    const numbers = codes
      .map(c => String(c).replace(/^#/, ""))
      .filter(c => /^\d+$/.test(c))
      .map(n => Number(n));

    if (tickets.length) $or.push({ shippingTicket: { $in: tickets } });
    if (numbers.length) $or.push({ orderNumber: { $in: numbers } });

    if (!$or.length) return res.json([]);

    const list = await Order.find({ $or }).sort({ createdAt: -1 }).limit(50).lean();

    const safe = list.map(o => ({
      _id: String(o._id),
      status: o.status,
      paymentMethod: o.paymentMethod,
      total: o.total,
      shipping: o.shipping,
      shippingTicket: o.shippingTicket,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      items: (o.items||[]).map(it => ({
        nombre: it.nombre, cantidad: it.cantidad, precio: it.precio, variant: it.variant
      }))
    }));

    return res.json(safe);
  } catch (e) {
    console.error("GET /orders/public/by-ids error:", e);
    res.status(500).json({ message: "Error" });
  }
});

/* =========================================================
 *  PÚBLICO: lookup por código (ticket AE-... o #número)
 * ========================================================= */
router.get("/orders/public/lookup", async (req, res) => {
  try {
    const codeRaw = String(req.query.code || "").trim();
    const emailOrPhone = String(req.query.emailOrPhone || "").trim();

    if (!codeRaw) return res.status(400).json({ message: "Falta code" });

    let q = null;
    if (/^AE-\d{8}-\d{4,}$/i.test(codeRaw)) {
      q = { shippingTicket: codeRaw };
    } else {
      const n = Number(String(codeRaw).replace(/^#/, ""));
      if (Number.isFinite(n)) q = { orderNumber: n };
    }
    if (!q) return res.status(404).json({ message: "No encontrado" });

    const extra = {};
    if (emailOrPhone) {
      const phone = (emailOrPhone.match(/\d/g) || []).join("");
      extra.$or = [
        { "buyer.email": new RegExp(`^${emailOrPhone}$`, "i") },
        ...(phone ? [{ "buyer.telefono": new RegExp(phone.slice(-7)) }] : []),
      ];
    }

    const o = await Order.findOne({ ...q, ...extra }).lean();
    if (!o) return res.status(404).json({ message: "No encontrado" });

    return res.json({
      _id: String(o._id),
      status: o.status,
      paymentMethod: o.paymentMethod,
      total: o.total,
      shipping: o.shipping,
      shippingTicket: o.shippingTicket,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      items: (o.items||[]).map(it => ({
        nombre: it.nombre, cantidad: it.cantidad, precio: it.precio, variant: it.variant
      }))
    });
  } catch (e) {
    console.error("GET /orders/public/lookup error:", e);
    res.status(500).json({ message: "Error" });
  }
});

/* =========================================================
 *  PÚBLICO: buscar órdenes por email, teléfono o DNI
 * ========================================================= */
router.get("/orders/public/by-buyer", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim();
    const phone = String(req.query.phone || "").replace(/\D/g, "");
    const dni   = String(req.query.dni   || "").replace(/\D/g, "");

    if (!email && !phone && !dni) {
      return res.status(400).json({ message: "Falta email, teléfono o DNI" });
    }

    const $or = [];
    if (email) $or.push({ "buyer.email": new RegExp(`^${email}$`, "i") });
    if (phone) $or.push({ "buyer.telefono": new RegExp(phone.slice(-7)) });
    if (dni)   $or.push({ "buyer.dni": new RegExp(`^${dni}$`) });

    const list = await Order.find({ $or, status: { $ne: "deleted" } })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const safe = list.map(o => ({
      _id:           String(o._id),
      status:        o.status,
      paymentMethod: o.paymentMethod,
      total:         o.total,
      shipping:      o.shipping,
      shippingTicket: o.shippingTicket,
      orderNumber:   o.orderNumber,
      createdAt:     o.createdAt,
      items: (o.items || []).map(it => ({
        nombre: it.nombre, cantidad: it.cantidad,
        precio: it.precio, subtotal: it.subtotal,
        variant: it.variant,
      })),
    }));

    return res.json(safe);
  } catch (e) {
    console.error("GET /orders/public/by-buyer error:", e);
    res.status(500).json({ message: "Error" });
  }
});

router.get("/mas-vendidos", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const skip  = (page - 1) * limit;

    const result = await Order.aggregate([
      { $match: { status: "paid" } },
      { $unwind: "$items" },
      { $match: { "items.productId": { $exists: true, $ne: null } } },
      {
        $group: {
          _id:          "$items.productId",
          totalVendido: { $sum: "$items.cantidad" },
          nombre:       { $first: "$items.nombre" },
        },
      },
      { $sort: { totalVendido: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from:         "productos",
          localField:   "_id",
          foreignField: "_id",
          as:           "producto",
        },
      },
      { $unwind: { path: "$producto", preserveNullAndEmpty: false } },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              "$producto",
              { totalVendido: "$totalVendido" },
            ],
          },
        },
      },
    ]);

    const totalDocs = await Order.aggregate([
      { $match: { status: "paid" } },
      { $unwind: "$items" },
      { $match: { "items.productId": { $exists: true, $ne: null } } },
      { $group: { _id: "$items.productId" } },
      { $count: "total" },
    ]);

    const total = totalDocs[0]?.total || 0;
    const pages = Math.ceil(total / limit);

    return res.json({ ok: true, items: result, page, pages, total });
  } catch (e) {
    console.error("GET /mas-vendidos error:", e);
    res.status(500).json({ message: "Error al obtener más vendidos" });
  }
});

module.exports = router;