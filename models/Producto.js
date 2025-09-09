const mongoose = require("mongoose");

const PromoSchema = new mongoose.Schema(
  {
    active: { type: Boolean, default: false },
    precio: { type: Number, min: 0, default: null },
    desde: { type: Date, default: null },
    hasta: { type: Date, default: null },
    etiqueta: { type: String, default: null },
  },
  { _id: false }
);

/**
 * Variantes (talle + color)
 * - price: precio específico de la variante (si no, usa precio base)
 * - stock: stock de la variante
 * - vid: id corto estable de la variante (para identificarla en carrito/órdenes)
 */
const VariantSchema = new mongoose.Schema(
  {
    vid: { type: String, required: true },       // ej: "m-negro-8fj2"
    size: { type: String, trim: true },          // talle
    color: { type: String, trim: true },         // nombre de color o código
    stock: { type: Number, default: 0, min: 0 },
    price: { type: Number, min: 0, default: null },
    sku: { type: String, default: undefined },
  },
  { _id: false }
);

const ProductoSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true },
    precio: { type: Number, required: true, min: 0 },             // precio base
    precioOriginal: { type: Number, min: 0, default: undefined },
    imagen: { type: String, default: "" },
    descripcion: { type: String, default: "" },
    categoria: { type: String, index: true, default: "" },
    subcategoria: { type: String, index: true, default: "" },

    // Stock global (si hay variantes se guarda SUMA de variantes)
    stock: { type: Number, default: 0, min: 0 },

    // Variantes
    variants: { type: [VariantSchema], default: [] },

    sku: { type: String, default: undefined },
    destacado: { type: Boolean, default: false },
    tags: { type: [String], default: [] },
    promo: { type: PromoSchema, default: undefined },
    visible: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const productRealtimePlugin = require("./plugins/productRealtime");
ProductoSchema.plugin(productRealtimePlugin);

// Índice de texto para /search
ProductoSchema.index({
  nombre: "text",
  descripcion: "text",
  categoria: "text",
  subcategoria: "text",
  tags: "text",
});

// Por si hacés bastante filtro por visible/stock
ProductoSchema.index({ visible: 1, stock: 1 });

module.exports = mongoose.model("Producto", ProductoSchema);
