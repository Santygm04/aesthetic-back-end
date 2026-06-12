const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const jwt = require("jsonwebtoken");
const User = require("../models/User");
const ADMIN_SECRET = (process.env.ADMIN_SECRET || "").trim();
const JWT_SECRET   = process.env.JWT_SECRET || "cambia-esto";

function isAdmin(req) {
  const s = (req.headers["x-admin-secret"] || req.body?.secret || "").trim();
  return ADMIN_SECRET && s === ADMIN_SECRET;
}

async function canWriteCategories(req) {
  if (isAdmin(req)) return true;
  const hdr = req.headers.authorization || "";
  if (!hdr.startsWith("Bearer ")) return false;
  try {
    const payload = jwt.verify(hdr.slice(7), JWT_SECRET);
    if (payload.role === "admin") return true;
    // vendedor con permiso editarCategorias
    const u = await User.findById(payload.sub);
    return u?.permissions?.editarCategorias === true;
  } catch { return false; }
}

const CategorySchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  slug:   { type: String, required: true, trim: true, lowercase: true, unique: true },
  subcategorias: [{ type: String, trim: true }],
  orden: { type: Number, default: 0 },
}, { timestamps: true });

const Category = mongoose.models.Category || mongoose.model("Category", CategorySchema);

// GET /api/categories — público
router.get("/", async (req, res) => {
  try {
    const cats = await Category.find().sort({ orden: 1, nombre: 1 }).lean();
    return res.json({ ok: true, categories: cats });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Error al listar categorías" });
  }
});

// POST /api/categories — admin
router.post("/", async (req, res) => {
  if (!await canWriteCategories(req)) return res.status(401).json({ message: "No autorizado" });
  try {
    const { nombre, slug, subcategorias = [], orden = 0 } = req.body;
    if (!nombre || !slug) return res.status(400).json({ message: "nombre y slug son requeridos" });
    const cat = await Category.create({ nombre, slug, subcategorias, orden });
    return res.json({ ok: true, category: cat });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ message: "Ya existe una categoría con ese slug" });
    res.status(500).json({ ok: false, message: "Error al crear categoría" });
  }
});

// PUT /api/categories/:id — admin
router.put("/:id", async (req, res) => {
 if (!await canWriteCategories(req)) return res.status(401).json({ message: "No autorizado" });
  try {
    const { nombre, slug, subcategorias, orden } = req.body;
    const cat = await Category.findByIdAndUpdate(
      req.params.id,
      { nombre, slug, subcategorias, orden },
      { new: true, runValidators: true }
    );
    if (!cat) return res.status(404).json({ message: "No encontrada" });
    return res.json({ ok: true, category: cat });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Error al actualizar" });
  }
});

// DELETE /api/categories/:id — admin
router.delete("/:id", async (req, res) => {
  if (!await canWriteCategories(req)) return res.status(401).json({ message: "No autorizado" });
  try {
    await Category.findByIdAndDelete(req.params.id);
    return res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Error al eliminar" });
  }
});

module.exports = router;