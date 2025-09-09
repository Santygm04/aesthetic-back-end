require("dotenv").config();
const mongoose = require("mongoose");
const Producto = require("../models/Producto");

const DATA = [
  // SKINCARE
  {
    nombre: "Gel limpiador facial",
    precio: 5990,
    imagen: "https://via.placeholder.com/700x700.png?text=Skincare",
    descripcion: "Gel suave para todo tipo de piel.",
    categoria: "skincare",
    subcategoria: "limpiadores",
    destacado: false,
  },
  {
    nombre: "Sérum Vitamina C 10%",
    precio: 8990,
    imagen: "https://via.placeholder.com/700x700.png?text=Skincare",
    descripcion: "Ilumina y empareja el tono de la piel.",
    categoria: "skincare",
    subcategoria: "serums",
    destacado: false,
  },

  // BODYCARE
  {
    nombre: "Crema corporal nutritiva",
    precio: 7490,
    imagen: "https://via.placeholder.com/700x700.png?text=Bodycare",
    descripcion: "Hidratación intensa con manteca de karité.",
    categoria: "bodycare",
    subcategoria: "cremas corporales",
    destacado: false,
  },

  // MAQUILLAJE
  {
    nombre: "Kit de sombras 12 tonos",
    precio: 18990,
    imagen: "https://via.placeholder.com/700x700.png?text=Maquillaje",
    descripcion: "Colores intensos y alta pigmentación.",
    categoria: "maquillaje",
    subcategoria: "sets",
    destacado: false,
  },

  // UÑAS
  {
    nombre: "Kit Soft-Gel inicial",
    precio: 32990,
    imagen: "https://via.placeholder.com/700x700.png?text=Uñas",
    descripcion: "Todo lo necesario para empezar con Soft-Gel.",
    categoria: "uñas",
    subcategoria: "soft-gel",
    destacado: false,
  },

  // PESTAÑAS
  {
    nombre: "Pegamento para pestañas transparente",
    precio: 2490,
    imagen: "https://via.placeholder.com/700x700.png?text=Pestañas",
    descripcion: "Secado rápido y fijación duradera.",
    categoria: "pestañas",
    subcategoria: "insumos",
    destacado: false,
  },

  // PELUQUERÍA
  {
    nombre: "Cepillo desenredante",
    precio: 5590,
    imagen: "https://via.placeholder.com/700x700.png?text=Peluquería",
    descripcion: "Desenreda sin tirones y reduce el frizz.",
    categoria: "peluquería",
    subcategoria: "accesorios",
    destacado: false,
  },

  // BIJOUTERIA
  {
    nombre: "Collar minimalista dorado",
    precio: 3990,
    imagen: "https://via.placeholder.com/700x700.png?text=Bijouteria",
    descripcion: "Collar delicado para uso diario.",
    categoria: "bijouteria",
    subcategoria: "collares",
    destacado: false,
  },

  // LENCERÍA
  {
    nombre: "Conjunto encaje clásico",
    precio: 10990,
    imagen: "https://via.placeholder.com/700x700.png?text=Lencería",
    descripcion: "Conjunto de encaje, cómodo y elegante.",
    categoria: "lenceria",
    subcategoria: "conjuntos",
    destacado: false,
  },

  // MARROQUINERIA
  {
    nombre: "Riñonera urbana",
    precio: 14990,
    imagen: "https://via.placeholder.com/700x700.png?text=Marroquineria",
    descripcion: "Riñonera práctica para todos los días.",
    categoria: "marroquineria",
    subcategoria: "riñoneras",
    destacado: false,
  },

  // NUEVOS INGRESOS
  {
    nombre: "Set esponjas para maquillaje (x6)",
    precio: 2500,
    imagen: "https://via.placeholder.com/700x700.png?text=Nuevos+ingresos",
    descripcion: "Pack de esponjas suaves multiuso.",
    categoria: "nuevos-ingresos",
    subcategoria: "nuevo ingreso",
    destacado: false,
  },
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const count = await Producto.countDocuments();

    if (count > 0) {
      console.log("ℹ️  La colección 'productos' ya tiene datos. Seed omitido.");
      await mongoose.disconnect();
      process.exit(0);
    }

    await Producto.insertMany(DATA);
    console.log("✅ Seed insertado correctamente.");
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error en el seed:", err);
    process.exit(1);
  }
})();
