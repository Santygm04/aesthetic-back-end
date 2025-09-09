// resetAdmin.js (verbose)
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");

console.log("🔎 CWD:", process.cwd());
console.log("🔎 .env existe:", fs.existsSync(path.join(process.cwd(), ".env")));
console.log("🔎 MONGO_URI:", process.env.MONGO_URI || "(vacío)");
console.log("🔎 ADMIN_DEFAULT_USER:", process.env.ADMIN_DEFAULT_USER || "(vacío)");
console.log("🔎 ADMIN_DEFAULT_PASS:", process.env.ADMIN_DEFAULT_PASS ? "(seteada)" : "(vacía)");

const User = require("./models/User");

(async () => {
  try {
    if (!process.env.MONGO_URI) throw new Error("Falta MONGO_URI en .env");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Conectado a Mongo");

    const USER = (process.env.ADMIN_DEFAULT_USER || "admin.paula").toLowerCase();
    const PASS = process.env.ADMIN_DEFAULT_PASS || "paula1990";

    let u = await User.findOne({ username: USER });
    if (!u) {
      const hash = await bcrypt.hash(PASS, 10);
      await User.create({
        username: USER,
        name: "Administrador",
        role: "admin",
        passwordHash: hash,
      });
      console.log("✅ Usuario creado:", USER);
    } else {
      u.passwordHash = await bcrypt.hash(PASS, 10);
      await u.save();
      console.log("✅ Contraseña actualizada para:", USER);
    }

    await mongoose.disconnect();
    console.log("🏁 Listo. Probá el login.");
    process.exit(0);
  } catch (e) {
    console.error("❌ Error:", e?.message || e);
    process.exit(1);
  }
})();
