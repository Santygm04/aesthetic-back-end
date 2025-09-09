// Pequeño bus + registro de clientes SSE
const clients = new Set();

function sseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no", // evita buffering en Nginx
  });
}

function addClient(res) {
  clients.add(res);
  // ping para mantener vivo el stream en proxies
  const ping = setInterval(() => {
    try { res.write("event: ping\ndata: {}\n\n"); } catch {}
  }, 25000);
  res.on("close", () => { clearInterval(ping); clients.delete(res); });
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

module.exports = { sseHeaders, addClient, broadcast };
