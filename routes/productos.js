const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Producto = require("../models/Producto");

const toInt = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? def : n;
};

const parsePrecio = (val) => {
  if (val === null || val === undefined || val === "") return null;
  const s = String(val).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const parsePct = (val) => {
  if (val === null || val === undefined || val === "") return null;
  const s = String(val).replace("%", "").replace(",", ".").trim();
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
};

const isAdminReq = (req) => String(req.query.admin) === "true";

const baseVis = (req) =>
  isAdminReq(req)
    ? []
    : [{ $or: [{ visible: { $exists: false } }, { visible: true }] }];

const withVis = (req, extra = {}) => {
  const vis = baseVis(req);
  if (!vis.length) return extra;
  if (!extra || Object.keys(extra).length === 0) return { $and: vis };
  return { $and: [...vis, extra] };
};

const parseBool = (v) => (typeof v === "string" ? v === "true" : !!v);

const toSlug = (str) =>
  String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const makeVid = (size, color) => {
  const base = [size, color].map(toSlug).filter(Boolean).join("-");
  const rnd = Math.random().toString(36).slice(2, 6);
  return (base || "var") + "-" + rnd;
};

const normalizeVariants = (arr) => {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((v) => {
      const stock =
        typeof v?.stock === "number" ? Math.max(0, v.stock) : Math.max(0, toInt(v?.stock, 0));
      const price =
        v?.price === "" || v?.price === null || v?.price === undefined
          ? null
          : parsePrecio(v?.price);
      const size = v?.size ? String(v.size).trim() : "";
      const color = v?.color ? String(v.color).trim() : "";
      const vid = v?.vid ? String(v.vid) : makeVid(size, color);
      return { vid, size, color, stock, price, sku: v?.sku || undefined };
    })
    .reduce((acc, cur) => {
      const key = `${cur.size}::${cur.color}`;
      const i = acc.findIndex((x) => `${x.size}::${x.color}` === key);
      if (i >= 0) acc[i] = cur;
      else acc.push(cur);
      return acc;
    }, []);
};

const sumVariantStock = (variants) =>
  Array.isArray(variants) ? variants.reduce((a, b) => a + (Number(b.stock) || 0), 0) : 0;

// ─── Helper para parsear campos numéricos opcionales del body ───────────────
// Devuelve el número si viene, null si viene vacío, undefined si no viene
const parseOptionalNum = (val) => {
  if (val === undefined) return undefined;        // no vino en el body → no tocar
  if (val === null || val === "") return null;     // vino vacío → guardar null
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// -------------------------
// CREAR PRODUCTO
// -------------------------
router.post("/", async (req, res) => {
  try {
    const b = req.body || {};

    const precio = parsePrecio(b.precio);
    if (precio === null)
      return res.status(400).json({ message: "Precio base inválido" });

    const precioOriginal =
      b.precioOriginal === undefined || b.precioOriginal === ""
        ? undefined
        : parsePrecio(b.precioOriginal);

    const categoria = b.categoria ? String(b.categoria).toLowerCase() : "";
    const subcategoria = b.subcategoria ? String(b.subcategoria).toLowerCase() : "";

    const vReq = b.variants ?? b.variantes;
    const variants = normalizeVariants(vReq);

    const stock = Math.max(
      0,
      typeof b.stock === "number" ? b.stock : toInt(b.stock, 0)
    );

    const visible = b.visible !== undefined ? parseBool(b.visible) : true;
    const tags = Array.isArray(b.tags) ? b.tags : [];

    let promo = undefined;
    const pct = parsePct(
      b.promoPct ?? b.promoPorcentaje ?? b.pctPromo ??
      b?.promo?.pct ?? b?.promo?.percent ?? b?.promo?.porcentaje
    );

    if (pct !== null) {
      const active = b.promoActivo !== undefined ? !!b.promoActivo : (b?.promo?.active ?? true);
      const precioCalc = Math.max(0, Math.round(precio * (1 - pct / 100)));
      if (active && !(precioCalc < precio)) {
        return res.status(400).json({ message: "El porcentaje no genera un precio menor al base" });
      }
      promo = { ...(b.promo || {}), active, precio: active ? precioCalc : null, pct };
    } else if (
      Object.prototype.hasOwnProperty.call(b, "promoActivo") ||
      Object.prototype.hasOwnProperty.call(b, "precioPromo")
    ) {
      const active = !!b.promoActivo;
      const parsed = parsePrecio(b.precioPromo);
      promo = {
        active,
        precio: active ? parsed : null,
        ...(active ? {} : { desde: null, hasta: null, etiqueta: null }),
      };
      if (promo.active) {
        if (!(promo.precio >= 0))
          return res.status(400).json({ message: "Precio promo inválido" });
        if (promo.precio >= precio)
          return res.status(400).json({ message: "El precio promo debe ser menor al precio base" });
      }
    } else if (b.promo) {
      promo = { ...b.promo };
      if (promo.precio !== undefined) promo.precio = parsePrecio(promo.precio);
    }

    const doc = new Producto({
      nombre:      String(b.nombre || "").trim(),
      precio,
      // ── 3 PRECIOS ──────────────────────────────────────────────
      precioEspecial:  parseOptionalNum(b.precioEspecial)  ?? null,
      precioMayorista: parseOptionalNum(b.precioMayorista) ?? null,
      // ── #8 CAJAS + TONOS ───────────────────────────────────────
      unidadesPorCaja:  parseOptionalNum(b.unidadesPorCaja)  ?? null,
      cantidadTonos:    parseOptionalNum(b.cantidadTonos)    ?? null,
      modoTonos:        b.modoTonos || "automatico",
      tonosDisponibles: Array.isArray(b.tonosDisponibles) ? b.tonosDisponibles : [],
      // ──────────────────────────────────────────────────────────
      precioOriginal,
      imagen:      b.imagen || "",
      descripcion: String(b.descripcion || "").trim(),
      categoria,
      subcategoria,
      stock,
      variants,
      sku:       b.sku || undefined,
      destacado: !!b.destacado,
      tags,
      promo,
      visible,
    });

    const created = await doc.save();
    res.status(201).json(created);
  } catch (e) {
    console.error("POST / (crear) ERROR:", e);
    res.status(500).json({ message: "Error al crear producto" });
  }
});

/* ========================== STATS ========================== */
router.get("/stats", async (req, res) => {
  try {
    const now = new Date();
    const visMatch = withVis(req, {});
    const categoriaNormExpr = {
      $toLower: { $ifNull: [{ $toString: "$categoria" }, ""] },
    };

    const byCat = await Producto.aggregate([
      { $match: visMatch },
      { $addFields: { categoriaNorm: categoriaNormExpr } },
      {
        $group: {
          _id: "$categoriaNorm",
          total: { $sum: 1 },
          latestCreated: { $max: "$createdAt" },
          latestUpdated: { $max: "$updatedAt" },
        },
      },
    ]);

    const promoBaseMatch = {
      "promo.active": true,
      $and: [
        { $or: [{ "promo.desde": { $lte: now } }, { "promo.desde": null }, { "promo.desde": { $exists: false } }] },
        { $or: [{ "promo.hasta": { $gte: now } }, { "promo.hasta": null }, { "promo.hasta": { $exists: false } }] },
      ],
    };
    const promoMatch = withVis(req, promoBaseMatch);

    const promosByCatAgg = await Producto.aggregate([
      { $match: promoMatch },
      { $addFields: { categoriaNorm: categoriaNormExpr } },
      { $group: { _id: "$categoriaNorm", count: { $sum: 1 }, latest: { $max: "$updatedAt" } } },
    ]);

    const nuevosBase = {
  tags: "nuevos-ingresos",
};
    const nuevosMatch = withVis(req, nuevosBase);

    const [nuevosCount, ultimoNuevo] = await Promise.all([
      Producto.countDocuments(nuevosMatch),
      Producto.findOne(nuevosMatch).sort({ createdAt: -1 }).select({ _id: 1, createdAt: 1 }).lean(),
    ]);

    const mapByCat = (arr, pick) =>
      Object.fromEntries(arr.map((r) => [r._id || "sin-categoria", pick(r)]));

    res.json({
      now,
      nuevos: { count: nuevosCount, latest: ultimoNuevo?.createdAt || null },
      catStats: mapByCat(byCat, (r) => ({
        total: r.total,
        latestCreated: r.latestCreated,
        latestUpdated: r.latestUpdated,
      })),
      promosByCat: mapByCat(promosByCatAgg, (r) => ({ count: r.count, latest: r.latest })),
    });
  } catch (e) {
    console.error("GET /stats ERROR:", e);
    res.status(500).json({ message: "Error al obtener stats" });
  }
});

/* ========================== PROMOS ========================== */
router.get("/promos", async (req, res) => {
  try {
    const now = new Date();
    const limitNum = Math.max(1, Math.min(200, toInt(req.query.limit, 60)));
    const promoActiveWindow = {
      "promo.active": true,
      $and: [
        { $or: [{ "promo.desde": { $lte: now } }, { "promo.desde": null }, { "promo.desde": { $exists: false } }] },
        { $or: [{ "promo.hasta": { $gte: now } }, { "promo.hasta": null }, { "promo.hasta": { $exists: false } }] },
      ],
    };
    const priceDrop = { $expr: { $gt: ["$precioOriginal", "$precio"] } };
    const query = withVis(req, { $or: [promoActiveWindow, priceDrop] });
    const items = await Producto.find(query).sort({ updatedAt: -1, createdAt: -1 }).limit(limitNum).lean();
    res.json(items);
  } catch (e) {
    console.error("GET /promos ERROR:", e);
    res.status(500).json({ message: "Error al obtener promociones" });
  }
});

/* ========================== BÚSQUEDA ========================== */
router.get("/search", async (req, res) => {
  try {
    const { q = "", page = "1", limit = "24" } = req.query;
    const queryString = String(q || "").trim();
    if (!queryString) return res.json({ items: [], page: 1, pages: 1, total: 0 });

    const pageNum = Math.max(1, toInt(page, 1));
    const limitNum = Math.max(1, Math.min(200, toInt(limit, 24)));
    const skip = (pageNum - 1) * limitNum;

    const filter = withVis(req, { $text: { $search: queryString } });
    const projection = { score: { $meta: "textScore" } };

    const [items, total] = await Promise.all([
      Producto.find(filter, projection).sort({ score: { $meta: "textScore" } }).skip(skip).limit(limitNum),
      Producto.countDocuments(filter),
    ]);

    res.json({ items, page: pageNum, pages: Math.max(1, Math.ceil(total / limitNum)), total, q: queryString });
  } catch (e) {
    console.error("GET /search ERROR:", e);
    res.status(500).json({ message: "Error en búsqueda" });
  }
});

/* ========================== SUGGEST ========================== */
router.get("/suggest", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.max(1, Math.min(50, toInt(req.query.limit, 8)));
    if (!q) return res.json([]);

    let out = [];
    const set = new Set();
    try {
      const textFilter = withVis(req, { $text: { $search: q } });
      const docs = await Producto.find(textFilter, { score: { $meta: "textScore" }, nombre: 1 })
        .sort({ score: { $meta: "textScore" } }).limit(limit * 3).lean();
      for (const d of docs) {
        const s = d?.nombre?.trim();
        if (s && !set.has(s.toLowerCase())) { set.add(s.toLowerCase()); out.push(s); if (out.length >= limit) break; }
      }
    } catch (_) {}

    if (out.length < limit) {
      const esc = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(esc(q), "i");
      const docs2 = await Producto.find(withVis(req, { nombre: re }), { nombre: 1 }).limit(limit * 3).lean();
      for (const d of docs2) {
        const s = d?.nombre?.trim();
        if (s && !set.has(s.toLowerCase())) { set.add(s.toLowerCase()); out.push(s); if (out.length >= limit) break; }
      }
    }
    return res.json(out.slice(0, limit));
  } catch (e) {
    console.error("GET /suggest ERROR:", e);
    return res.json([]);
  }
});

/* ========================== LISTADO ========================== */
router.get("/", async (req, res) => {
  try {
    const { categoria, subcategoria, destacado, q, sort = "fecha-desc", limit = "100", tag } = req.query;

    // Si viene tag=nuevos-ingresos, forzar filtro estricto por tag
    if (tag === "nuevos-ingresos") {
      const query = withVis(req, { tags: "nuevos-ingresos" });
      const limitNum = Math.max(1, Math.min(200, toInt(limit, 100)));
      const items = await Producto.find(query).sort({ createdAt: -1 }).limit(limitNum);
      return res.json(items);
    }else {
      if (cat) and.push({ $expr: { $eq: [{ $toLower: "$categoria" }, cat] } });
      if (sub) and.push({ $expr: { $eq: [{ $toLower: "$subcategoria" }, sub] } });
    }

    if (destacado === "true") and.push({ destacado: true });

    if (q && String(q).trim() !== "") {
      const esc = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(esc(String(q).trim()), "i");
      and.push({ $or: [{ nombre: regex }, { descripcion: regex }, { categoria: regex }, { subcategoria: regex }, { tags: regex }] });
    }

    if (and.length) filtro.$and = and;
    const query = withVis(req, filtro);
    const sortMap = {
      "fecha-desc": { createdAt: -1 },
      "precio-asc": { precio: 1 },
      "precio-desc": { precio: -1 },
      "nombre-asc": { nombre: 1 },
    };
    const limitNum = Math.max(1, Math.min(200, toInt(limit, 100)));
    const items = await Producto.find(query).sort(sortMap[sort] || sortMap["fecha-desc"]).limit(limitNum);
    res.json(items);
  } catch (e) {
    console.error("GET / (lista) ERROR:", e);
    res.status(500).json({ message: "Error al obtener productos" });
  }
});

/* ========================== UPDATE ========================== */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await Producto.findById(id);
    if (!doc) return res.status(404).json({ message: "No encontrado" });

    // Compat promoActivo/precioPromo
    if (
      Object.prototype.hasOwnProperty.call(req.body, "promoActivo") ||
      Object.prototype.hasOwnProperty.call(req.body, "precioPromo")
    ) {
      const active = !!req.body.promoActivo;
      const parsed = parsePrecio(req.body.preciopromo ?? req.body.precioPromo);
      req.body.promo = {
        ...(req.body.promo || {}),
        active,
        precio: active ? parsed : null,
        ...(active ? {} : { desde: null, hasta: null, etiqueta: null }),
      };
    }

    if (
      Object.prototype.hasOwnProperty.call(req.body, "promoPct") ||
      Object.prototype.hasOwnProperty.call(req.body, "promoPorcentaje")
    ) {
      const pct = parsePct(req.body.promoPct ?? req.body.promoPorcentaje);
      const active = Object.prototype.hasOwnProperty.call(req.body, "promoActivo") ? !!req.body.promoActivo : true;
      const base = Object.prototype.hasOwnProperty.call(req.body, "precio") ? parsePrecio(req.body.precio) : doc.precio;
      if (pct !== null && active) {
        const precioCalc = Math.max(0, Math.round(base * (1 - pct / 100)));
        if (!(precioCalc < base)) return res.status(400).json({ message: "El porcentaje no genera un precio menor al base" });
        req.body.promo = { ...(req.body.promo || {}), active: true, precio: precioCalc, pct };
      } else if (pct !== null && !active) {
        req.body.promo = { ...(req.body.promo || {}), active: false, precio: null, pct };
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "visible")) req.body.visible = parseBool(req.body.visible);
    if (req.body.categoria)    req.body.categoria    = String(req.body.categoria).toLowerCase();
    if (req.body.subcategoria) req.body.subcategoria = String(req.body.subcategoria).toLowerCase();
    if (req.body.promo?.precio !== undefined) req.body.promo.precio = parsePrecio(req.body.promo.precio);
    if (req.body.precio !== undefined) {
      const pbase = parsePrecio(req.body.precio);
      if (pbase === null) return res.status(400).json({ message: "Precio base inválido" });
      req.body.precio = pbase;
    }
    if (req.body.precioOriginal !== undefined) req.body.precioOriginal = parsePrecio(req.body.precioOriginal);

    const rawVariants = req.body.variants ?? req.body.variantes;
    if (rawVariants !== undefined) req.body.variants = normalizeVariants(rawVariants);

    // ── ALLOW LIST COMPLETA (incluye 3 precios + #8 cajas/tonos) ──────────────
    const allow = [
      "nombre",
      "precio",
      "precioOriginal",
      // ← #7 Sistema de 3 precios
      "precioEspecial",
      "precioMayorista",
      // ← #8 Venta por caja + tonos
      "unidadesPorCaja",
      "cantidadTonos",
      "modoTonos",
      "tonosDisponibles",
      // ── resto ──
      "imagen",
      "descripcion",
      "categoria",
      "subcategoria",
      "destacado",
      "stock",
      "tags",
      "promo",
      "visible",
      "variants",
      "sku",
    ];

    const patch = {};
    for (const k of allow) {
      if (req.body[k] !== undefined) {
        // Parseo especial para los campos numéricos opcionales
        if (["precioEspecial", "precioMayorista", "unidadesPorCaja", "cantidadTonos"].includes(k)) {
          const parsed = parseOptionalNum(req.body[k]);
          patch[k] = parsed; // null si viene vacío
        } else {
          patch[k] = req.body[k];
        }
      }
    }

    const updated = await Producto.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
    res.json(updated);
  } catch (e) {
    console.error("PUT /:id ERROR:", e);
    res.status(500).json({ message: "Error al actualizar producto" });
  }
});

/* ========================== PATCH VISIBLE ========================== */
router.patch("/:id/visible", async (req, res) => {
  try {
    const { id } = req.params;
    const visible = parseBool(req.body.visible);
    const updated = await Producto.findByIdAndUpdate(id, { visible }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ message: "No encontrado" });
    res.json(updated);
  } catch (e) {
    console.error("PATCH /:id/visible ERROR:", e);
    res.status(500).json({ message: "Error al cambiar visibilidad" });
  }
});

/* ========================== DETALLE ========================== */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const p = await Producto.findById(id).catch((e) => {
      if (e?.name === "CastError") return null;
      throw e;
    });
    if (!p) return res.status(404).json({ message: "No encontrado" });
    if (!isAdminReq(req) && p.visible === false) return res.status(404).json({ message: "No encontrado" });
    res.json(p);
  } catch (e) {
    console.error("GET /:id ERROR:", e);
    res.status(500).json({ message: "Error al obtener producto" });
  }
});

/* ========================== DELETE ========================== */
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    console.log("[DELETE producto] id =", id);
    const deleted = await Producto.findByIdAndDelete(id).catch((e) => {
      if (e?.name === "CastError") return null;
      throw e;
    });
    if (!deleted) {
      console.warn("[DELETE producto] no encontrado:", id);
      return res.status(404).json({ ok: false, message: "No encontrado" });
    }
    console.log("[DELETE producto] OK:", deleted._id?.toString());
    return res.json({ ok: true, id: deleted._id?.toString(), message: "Eliminado" });
  } catch (e) {
    console.error("DELETE /:id ERROR:", e);
    res.status(500).json({ ok: false, message: "Error al eliminar producto" });
  }
});

/* ========================== SITEMAP ========================== */
router.get("/sitemap", async (req, res) => {
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
  <url>
    <loc>${frontBase}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${frontBase}/category/skincare</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${frontBase}/category/maquillaje</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${frontBase}/category/marroquineria</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${frontBase}/category/lenceria</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${frontBase}/category/bijouterie</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${frontBase}/category/uñas</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${frontBase}/category/pestañas</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${frontBase}/category/accesorios</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${frontBase}/contacto</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${frontBase}/envios</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
${urls}
</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(xml);
  } catch (e) {
    console.error("GET /sitemap ERROR:", e);
    res.status(500).send("Error generando sitemap");
  }
});

module.exports = router;