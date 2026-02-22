// models/plugins/productRealtime.js
const { broadcast } = require("../../realtime");

// Campos que mandamos al front (ajustado a tu modelo real)
function pickProduct(p) {
  return {
    _id: p._id,
    nombre: p.nombre,
    precio: p.precio,
    categoria: p.categoria,
    subcategoria: p.subcategoria,
    stock: p.stock,
    variants: p.variants || [],
    visible: p.visible,
    promo: p.promo,
    imagen: p.imagen,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
  };
}

module.exports = function productRealtimePlugin(schema) {
  // create / save / update
  schema.post("save", function (doc) {
    try {
      broadcast("product:upsert", pickProduct(doc));
    } catch {}
  });

  // updates por query
  schema.post("findOneAndUpdate", async function (res) {
    try {
      if (!res?._id) return;
      const doc = await this.model.findById(res._id).lean();
      if (doc) broadcast("product:upsert", pickProduct(doc));
    } catch {}
  });

  // delete (document)
  schema.post("deleteOne", { document: true, query: false }, function (doc) {
    try {
      if (doc?._id) broadcast("product:delete", { _id: doc._id });
    } catch {}
  });

  // delete (query)
  schema.post("findOneAndDelete", function (res) {
    try {
      if (res?._id) broadcast("product:delete", { _id: res._id });
    } catch {}
  });
};