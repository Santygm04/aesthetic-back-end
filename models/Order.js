// models/Order.js
const mongoose = require("mongoose");

const ItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Producto" },
    nombre: String,
    precio: Number,
    cantidad: Number,
    subtotal: Number,
    // info de variante (opcional)
    variant: {
      vid: String,
      size: String,
      color: String,
    },
  },
  { _id: false }
);

const AddressSchema = new mongoose.Schema(
  {
    calle: String,
    numero: String,
    piso: String,
    ciudad: String,
    provincia: String,
    cp: String,
  },
  { _id: false }
);

const ShippingSchema = new mongoose.Schema(
  {
    method: { type: String, enum: ["envio", "retiro"], default: "envio" },
    company: { type: String, default: "andreani" },
    trackingNumber: { type: String, default: null },
    address: { type: AddressSchema, default: {} },
    // timestamps simples de logística
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    // número simple incremental de pedido
    orderNumber: { type: Number, unique: true, index: true },

    buyer: {
      nombre: String,
      email: String,
      direccion: String, // legacy opcional
      telefono: String,
    },
    items: { type: [ItemSchema], default: [] },
    total: { type: Number, required: true },

    // ✅ agregamos rejected (tu UI lo usa y MP puede rechazar)
    status: {
      type: String,
      enum: ["pending", "paid", "rejected", "cancelled"],
      default: "pending",
    },

    paymentMethod: {
      type: String,
      enum: ["transfer", "mercadopago"],
      required: true,
    },

    shippingTicket: { type: String },
    shipping: { type: ShippingSchema, default: () => ({}) },

    // Mercado Pago
    mp: {
      preferenceId: String,
      paymentId: String,
      status: String,
      status_detail: String,
    },

    // Transferencia
    transfer: {
      alias: String,
      receiptPath: String,
    },

    // para no descontar stock 2 veces
    stockAdjusted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Ticket de envío + asignación de orderNumber
OrderSchema.pre("save", async function (next) {
  try {
    // shippingTicket
    if (!this.shippingTicket) {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const rnd = Math.floor(1000 + Math.random() * 9000);
      this.shippingTicket = `AE-${y}${m}${day}-${rnd}`;
    }

    // orderNumber incremental (sólo al crear)
    if (this.isNew && !this.orderNumber) {
      const coll = mongoose.connection.collection("counters");

      // Importante: NO usar upsert aquí (ya lo hacemos al iniciar la app)
      const ret = await coll.findOneAndUpdate(
        { _id: "orders" },
        { $inc: { seq: 1 } },
        { returnDocument: "after" }
      );

      // Fallback defensivo
      let nextSeq = ret?.value?.seq;
      if (typeof nextSeq !== "number") {
        const doc = await coll.findOne({ _id: "orders" });
        nextSeq = (doc?.seq ?? 0) + 1;
        await coll.updateOne({ _id: "orders" }, { $set: { seq: nextSeq } });
      }

      this.orderNumber = nextSeq;
    }

    next();
  } catch (e) {
    next(e);
  }
});

module.exports = mongoose.model("Order", OrderSchema);