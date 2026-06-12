const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, unique: true, required: true, lowercase: true, trim: true },
    name: { type: String, default: "" },
    role: { type: String, enum: ["admin", "vendedor"], default: "admin" },
passwordHash: { type: String, required: true },
active: { type: Boolean, default: true },
permissions: {
  verEstadisticas:   { type: Boolean, default: true },
  verOrdenes:        { type: Boolean, default: true },
  editarCategorias:  { type: Boolean, default: true },
  crearProductos:    { type: Boolean, default: true },
  editarStockSolo:   { type: Boolean, default: false },
},
  },
  { timestamps: true }
);

// helper para validar 
UserSchema.methods.checkPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

// Nunca devolver passwordHash en JSON por defecto
UserSchema.set("toJSON", {
  transform: (_, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = mongoose.model("User", UserSchema);
