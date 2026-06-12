// resetAdmin.js (CORREGIDO para tu modelo User)
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");

console.log("🔎 CWD:", process.cwd());
console.log("🔎 .env existe:", fs.existsSync(path.join(process.cwd(), ".env")));
console.log("🔎 MONGO_URI:", process.env.MONGO_URI ? "✓ setteada" : "✗ vacía");
console.log("🔎 ADMIN_DEFAULT_USER:", process.env.ADMIN_DEFAULT_USER || "(vacío)");
console.log("🔎 ADMIN_DEFAULT_PASS:", process.env.ADMIN_DEFAULT_PASS ? "✓ setteada" : "✗ vacía");

const User = require("./models/User");

(async () => {
  try {
    if (!process.env.MONGO_URI) throw new Error("Falta MONGO_URI en .env");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Conectado a Mongo");

    const USER = (process.env.ADMIN_DEFAULT_USER || "admin.paula").toLowerCase();
    const PASS = process.env.ADMIN_DEFAULT_PASS || "paula1990";

    console.log(`📝 Buscando usuario: ${USER}`);

    let user = await User.findOne({ username: USER });
    
    if (!user) {
      console.log("👤 Usuario no existe, creando...");
      const hash = await bcrypt.hash(PASS, 10);
      
      // ✅ Usar passwordHash (como pide tu modelo)
      user = await User.create({
        username: USER,
        name: "Administrador",
        role: "admin",
        passwordHash: hash,  // ← CAMBIO IMPORTANTE: antes era "password"
        active: true,
        permissions: {       // ← NUEVO: agregar permisos por defecto
          verEstadisticas: true,
          verOrdenes: true,
          editarCategorias: true,
          crearProductos: true,
          editarStockSolo: false
        }
      });
      console.log("✅ Usuario CREADO:", USER);
    } else {
      console.log("👤 Usuario existe, actualizando contraseña...");
      const hash = await bcrypt.hash(PASS, 10);
      user.passwordHash = hash;  // ← CAMBIO IMPORTANTE: antes era "password"
      // Asegurar que tenga permisos
      if (!user.permissions) {
        user.permissions = {
          verEstadisticas: true,
          verOrdenes: true,
          editarCategorias: true,
          crearProductos: true,
          editarStockSolo: false
        };
      }
      await user.save();
      console.log("✅ Contraseña ACTUALIZADA para:", USER);
    }

    // Verificar que funciona
    const testUser = await User.findOne({ username: USER });
    console.log("🧪 Verificación:");
    console.log("   - Usuario:", testUser.username);
    console.log("   - Role:", testUser.role);
    console.log("   - PasswordHash existe:", !!testUser.passwordHash);
    console.log("   - Active:", testUser.active);
    console.log("   - Permissions:", testUser.permissions ? "✓" : "✗");

    // Probar que la contraseña es válida
    const isValid = await testUser.checkPassword(PASS);
    console.log(`   - Contraseña válida: ${isValid ? "✅ SI" : "❌ NO"}`);

    await mongoose.disconnect();
    console.log("🏁 Listo. Probá el login con:");
    console.log(`   Usuario: ${USER}`);
    console.log(`   Contraseña: ${PASS}`);
    process.exit(0);
  } catch (e) {
    console.error("❌ Error:", e?.message || e);
    console.error(e.stack);
    process.exit(1);
  }
})();