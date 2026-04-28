// models/Producto.js
const mongoose = require("mongoose");

const PromoSchema = new mongoose.Schema(
  {
    active: { type: Boolean, default: false },
    precio: { type: Number, min: 0, default: null },
    desde:  { type: Date, default: null },
    hasta:  { type: Date, default: null },
    etiqueta: { type: String, default: null },
  },
  { _id: false }
);

const VariantSchema = new mongoose.Schema(
  {
    vid:   { type: String, required: true },
    size:  { type: String, trim: true },
    color: { type: String, trim: true },
    stock: { type: Number, default: 0, min: 0 },
    price: { type: Number, min: 0, default: null },
    sku:   { type: String, default: undefined },
  },
  { _id: false }
);

const ProductoSchema = new mongoose.Schema(
  {
    nombre:       { type: String, required: true, trim: true },

    // ── SISTEMA DE 3 PRECIOS ──────────────────────────────────────
    // precio        = Precio Unitario  (sin mínimo de compra)
    // precioEspecial= Precio Especial  (comprando 5+ productos distintos)
    // precioMayorista= Precio Mayorista (compra mínima $30.000 en subtotal)
    // precioOriginal = precio "tachado" de referencia (opcional)
    precio:          { type: Number, required: true, min: 0 },
    precioEspecial:  { type: Number, min: 0, default: null }, // null = no aplica
    precioMayorista: { type: Number, min: 0, default: null }, // null = no aplica
    precioOriginal:  { type: Number, min: 0, default: undefined },
    // ─────────────────────────────────────────────────────────────

    imagen:      { type: String, default: "" },
    descripcion: { type: String, default: "" },
    categoria:   { type: String, index: true, default: "" },
    subcategoria:{ type: String, index: true, default: "" },

    stock:    { type: Number, default: 0, min: 0 },
    variants: { type: [VariantSchema], default: [] },

    // ── #8 VENTA POR CAJA ────────────────────────────────────────
    unidadesPorCaja: { type: Number, min: 1, default: null }, // null = venta unitaria normal
    // ── #8 SELECTOR DE TONOS ─────────────────────────────────────
    cantidadTonos:   { type: Number, min: 1, max: 5, default: null }, // null = sin tonos
    // "automatico" → distribución pareja | "manual" → admin carga tonos fijos
    modoTonos:       { type: String, enum: ["automatico", "manual"], default: "automatico" },
    tonosDisponibles:{ type: [String], default: [] }, // ej: ["Tono 1","Tono 2","Tono 3"]
    // ─────────────────────────────────────────────────────────────

    sku:       { type: String, default: undefined },
    destacado: { type: Boolean, default: false },
    tags: { type: [String], default: ["nuevos-ingresos"] },
    promo:     { type: PromoSchema, default: undefined },
    visible:   { type: Boolean, default: true },
  },
  { timestamps: true }
);

const productRealtimePlugin = require("./plugins/productRealtime");
ProductoSchema.plugin(productRealtimePlugin);

ProductoSchema.index({
  nombre: "text", descripcion: "text",
  categoria: "text", subcategoria: "text", tags: "text",
});
ProductoSchema.index({ visible: 1, stock: 1 });

module.exports = mongoose.model("Producto", ProductoSchema);