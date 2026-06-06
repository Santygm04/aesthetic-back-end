const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim();
const FRONT_URL = (process.env.FRONT_URL || "https://aestheticmakeup.com.ar").replace(/\/$/, "");
const FROM_EMAIL = process.env.FROM_EMAIL || "onboarding@resend.dev";

console.log("[email config]", {
  resendKey: process.env.RESEND_API_KEY ? "SET" : "MISSING",
  admin: ADMIN_EMAIL,
  from: FROM_EMAIL,
});

const ars = (n) =>
  `$${Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;

function buildItemsHtml(items = []) {
  return items.map((it) => {
    const variant = it?.variant?.size || it?.variant?.color
      ? ` (${[it?.variant?.size, it?.variant?.color].filter(Boolean).join(" / ")})`
      : "";
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #f3c9e2;color:#333">${it.nombre}${variant}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f3c9e2;text-align:center;color:#555">${it.cantidad}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f3c9e2;text-align:right;color:#6a1b9a;font-weight:600">${ars(it.subtotal)}</td>
    </tr>`;
  }).join("");
}

function baseTemplate(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9f0f8;font-family:Segoe UI,system-ui,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #f3c9e2">
    <div style="background:linear-gradient(135deg,#ff2ea6,#b02a6b);padding:28px 32px">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:600">Aesthetic</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:14px">${title}</p>
    </div>
    <div style="padding:28px 32px">
      ${bodyHtml}
    </div>
    <div style="padding:16px 32px;background:#fff0f8;text-align:center;font-size:12px;color:#b02a6b">
      Aesthetic · Gracias por tu compra 💖 · <a href="${FRONT_URL}" style="color:#ff2ea6">aestheticmakeup.com.ar</a>
    </div>
  </div>
</body>
</html>`;
}

function buildItemsTable(items) {
  return `<table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px">
    <thead>
      <tr style="background:#fff0f8">
        <th style="padding:8px;text-align:left;color:#b02a6b;font-weight:600">Producto</th>
        <th style="padding:8px;text-align:center;color:#b02a6b;font-weight:600">Cant.</th>
        <th style="padding:8px;text-align:right;color:#b02a6b;font-weight:600">Subtotal</th>
      </tr>
    </thead>
    <tbody>${buildItemsHtml(items)}</tbody>
  </table>`;
}

function buildOrderBadge(order) {
  return `<div style="background:#fff0f8;border-radius:10px;padding:14px 18px;margin:18px 0">
    <p style="margin:0 0 4px;font-size:13px;color:#b02a6b;font-weight:600">Número de pedido</p>
    <p style="margin:0;font-size:20px;font-weight:700;color:#ff2ea6">#${order.orderNumber || "—"}</p>
    <p style="margin:4px 0 0;font-size:12px;color:#888">Ticket: ${order.shippingTicket || "—"}</p>
  </div>`;
}

function buildShippingBlock(order) {
  const sh = order?.shipping || {};
  const addr = sh.address || {};
  if (sh.method === "retiro") {
    return `<div style="background:#f8f8f8;border-radius:10px;padding:14px 18px;margin:16px 0;font-size:13px;color:#444">
      <p style="margin:0;font-size:13px;color:#666">📍 <strong>Retiro en local</strong> — te vamos a contactar para coordinar el horario.</p>
    </div>`;
  }
  const linea = [
    addr.calle && addr.numero ? `${addr.calle} ${addr.numero}` : "",
    addr.piso || "",
    addr.ciudad || "",
    addr.provincia || "",
    addr.cp ? `CP ${addr.cp}` : "",
  ].filter(Boolean).join(", ");

  return `<div style="background:#f8f8f8;border-radius:10px;padding:14px 18px;margin:16px 0;font-size:13px;color:#444">
    <p style="margin:0 0 4px;font-weight:600;color:#333">📦 Envío a domicilio</p>
    <p style="margin:0;color:#555">${linea || "Dirección no especificada"}</p>
  </div>`;
}

function buildOrderLink(order) {
  const url = `${FRONT_URL}/pedidos`;
  return `<div style="text-align:center;margin:24px 0">
    <a href="${url}" style="background:linear-gradient(135deg,#ff2ea6,#b02a6b);color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:14px;font-weight:600;display:inline-block">
      Ver mis pedidos →
    </a>
  </div>`;
}

async function sendOrderConfirmation(order) {
  if (!process.env.RESEND_API_KEY) return;

  const buyerEmail = order?.buyer?.email;
  const metodo = order.paymentMethod === "mercadopago" ? "MercadoPago" : "Transferencia bancaria";

  if (buyerEmail) {
    try {
      const { data, error } = await resend.emails.send({
        from: `Aesthetic <${FROM_EMAIL}>`,
        to: buyerEmail,
        subject: `Pedido #${order.orderNumber || order._id} recibido — Aesthetic`,
        html: baseTemplate(
          "¡Recibimos tu pedido!",
          `<p style="color:#333;font-size:15px">Hola <strong>${order?.buyer?.nombre || ""}</strong> 👋</p>
          <p style="color:#555;font-size:14px">Tu pedido fue recibido y está <strong>pendiente de confirmación de pago</strong>.</p>
          ${buildOrderBadge(order)}
          ${buildItemsTable(order.items)}
          <div style="text-align:right;font-size:16px;font-weight:700;color:#6a1b9a;margin-bottom:18px">
            Total: ${ars(order.total)}
          </div>
          ${buildShippingBlock(order)}
          <p style="font-size:13px;color:#666;margin:8px 0 0">💳 Método de pago: <strong>${metodo}</strong></p>
          <p style="font-size:13px;color:#888;margin:8px 0 0">Te avisaremos cuando confirmemos el pago 💖</p>
          ${buildOrderLink(order)}`
        ),
      });
      if (error) console.warn("[email cliente nuevo pedido] ERROR:", error);
      else console.log("[email cliente nuevo pedido] OK:", data?.id);
    } catch (e) {
      console.warn("[email cliente nuevo pedido] CATCH:", e.message);
    }
  }

  if (ADMIN_EMAIL) {
    const addr = order?.shipping?.address || {};
    const dirLine = order?.shipping?.method === "envio"
      ? [
          addr.calle && addr.numero ? `${addr.calle} ${addr.numero}` : "",
          addr.piso || "",
          addr.ciudad || "",
          addr.provincia || "",
          addr.cp ? `CP ${addr.cp}` : "",
        ].filter(Boolean).join(", ")
      : "Retiro en local";

    try {
      const { data, error } = await resend.emails.send({
        from: `Aesthetic <${FROM_EMAIL}>`,
        to: ADMIN_EMAIL,
        subject: `🛍️ Nuevo pedido #${order.orderNumber || order._id} — ${order?.buyer?.nombre || "cliente"}`,
        html: baseTemplate(
          "🧾 Nuevo pedido recibido",
          `<p style="color:#333;font-size:15px">Entró un pedido nuevo.</p>
          ${buildOrderBadge(order)}
          <div style="background:#f8f8f8;border-radius:10px;padding:14px 18px;margin:16px 0;font-size:13px;color:#444">
            <p style="margin:0 0 6px"><strong>Cliente:</strong> ${order?.buyer?.nombre || "—"}</p>
            <p style="margin:0 0 6px"><strong>Email:</strong> ${order?.buyer?.email || "—"}</p>
            <p style="margin:0 0 6px"><strong>Teléfono:</strong> ${order?.buyer?.telefono || "—"}</p>
            <p style="margin:0 0 6px"><strong>Entrega:</strong> ${order?.shipping?.method === "retiro" ? "Retiro en local" : "Envío a domicilio"}</p>
            <p style="margin:0"><strong>Dirección:</strong> ${dirLine}</p>
          </div>
          ${buildItemsTable(order.items)}
          <div style="text-align:right;font-size:16px;font-weight:700;color:#6a1b9a;margin-bottom:18px">
            Total: ${ars(order.total)}
          </div>
          <p style="font-size:13px;color:#666;margin:0">💳 Método de pago: <strong>${order.paymentMethod === "mercadopago" ? "MercadoPago" : "Transferencia bancaria"}</strong></p>
          <p style="font-size:13px;color:#e11a8a;margin:10px 0 0;font-weight:600">⚠️ Estado: Pendiente de confirmación</p>`
        ),
      });
      if (error) console.warn("[email admin nuevo pedido] ERROR:", error);
      else console.log("[email admin nuevo pedido] OK:", data?.id);
    } catch (e) {
      console.warn("[email admin nuevo pedido] CATCH:", e.message);
    }
  }
}

async function sendPaymentConfirmed(order) {
  if (!process.env.RESEND_API_KEY) return;

  const buyerEmail = order?.buyer?.email;

  if (buyerEmail) {
    try {
      const { data, error } = await resend.emails.send({
        from: `Aesthetic <${FROM_EMAIL}>`,
        to: buyerEmail,
        subject: `¡Pago confirmado! Pedido #${order.orderNumber || order._id} — Aesthetic`,
        html: baseTemplate(
          "¡Pago confirmado! 🎉",
          `<p style="color:#333;font-size:15px">Hola <strong>${order?.buyer?.nombre || ""}</strong> 🎉</p>
          <p style="color:#555;font-size:14px">Tu pago fue <strong style="color:#16a34a">confirmado</strong>. ¡Estamos preparando tu pedido!</p>
          ${buildOrderBadge(order)}
          ${buildItemsTable(order.items)}
          <div style="text-align:right;font-size:16px;font-weight:700;color:#6a1b9a;margin-bottom:18px">
            Total: ${ars(order.total)}
          </div>
          ${buildShippingBlock(order)}
          <p style="font-size:13px;color:#888;margin:12px 0 0">En breve nos comunicamos para coordinar la entrega 💖</p>
          ${buildOrderLink(order)}`
        ),
      });
      if (error) console.warn("[email cliente pago confirmado] ERROR:", error);
      else console.log("[email cliente pago confirmado] OK:", data?.id);
    } catch (e) {
      console.warn("[email cliente pago confirmado] CATCH:", e.message);
    }
  }

  if (ADMIN_EMAIL) {
    const addr = order?.shipping?.address || {};
    const dirLine = order?.shipping?.method === "envio"
      ? [
          addr.calle && addr.numero ? `${addr.calle} ${addr.numero}` : "",
          addr.piso || "",
          addr.ciudad || "",
          addr.provincia || "",
          addr.cp ? `CP ${addr.cp}` : "",
        ].filter(Boolean).join(", ")
      : "Retiro en local";

    try {
      const { data, error } = await resend.emails.send({
        from: `Aesthetic <${FROM_EMAIL}>`,
        to: ADMIN_EMAIL,
        subject: `✅ Pago confirmado #${order.orderNumber || order._id} — ${order?.buyer?.nombre || "cliente"}`,
        html: baseTemplate(
          "✅ Pago confirmado — a preparar",
          `<p style="color:#333;font-size:15px">El pago del siguiente pedido fue confirmado.</p>
          ${buildOrderBadge(order)}
          <div style="background:#f0fdf4;border-radius:10px;padding:14px 18px;margin:16px 0;font-size:13px;color:#15803d;border:1px solid #bbf7d0">
            <p style="margin:0 0 6px;font-weight:700">✅ Pago confirmado — listo para preparar</p>
            <p style="margin:0 0 4px"><strong>Cliente:</strong> ${order?.buyer?.nombre || "—"} · ${order?.buyer?.telefono || "—"}</p>
            <p style="margin:0 0 4px"><strong>Email:</strong> ${order?.buyer?.email || "—"}</p>
            <p style="margin:0"><strong>Dirección:</strong> ${dirLine}</p>
          </div>
          ${buildItemsTable(order.items)}
          <div style="text-align:right;font-size:16px;font-weight:700;color:#6a1b9a;margin-bottom:18px">
            Total: ${ars(order.total)}
          </div>
          <p style="font-size:13px;color:#e11a8a;font-weight:600">👉 Acción: preparar el ${order?.shipping?.method === "retiro" ? "retiro" : "envío"}.</p>`
        ),
      });
      if (error) console.warn("[email admin pago confirmado] ERROR:", error);
      else console.log("[email admin pago confirmado] OK:", data?.id);
    } catch (e) {
      console.warn("[email admin pago confirmado] CATCH:", e.message);
    }
  }
}

module.exports = { sendOrderConfirmation, sendPaymentConfirmed };