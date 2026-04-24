// src/controllers/productoController.js
const Producto = require("../models/Producto");

// GET /api/productos  (filtros: categoria, subcategoria, marca, q, sort, limit, page)
const getProductos = async (req, res) => {
  try {
    const {
      categoria,
      subcategoria,
      marca,
      q,
      sort = "-createdAt", // por defecto, los más nuevos
      limit = 100,
      page = 1,
    } = req.query;

    const filtro = {};
    if (categoria) filtro.categoria = String(categoria).toLowerCase();
    if (subcategoria) filtro.subcategoria = String(subcategoria).toLowerCase();
    if (marca) filtro.marca = marca;
    if (q) {
  filtro.$or = [
    { nombre: { $regex: q, $options: "i" } },
    { descripcion: { $regex: q, $options: "i" } },
  ];
  }

    // Nuevos ingresos: productos con tag "nuevos-ingresos"
    if (req.query.tag === "nuevos-ingresos") {
      filtro.tags = "nuevos-ingresos";
    }

    // Más vendidos: productos destacados, ordenados por ventas
    if (req.query.tag === "mas-vendidos") {
      filtro.destacado = true;
    }

    const perPage = Math.min(Number(limit) || 100, 200);
    const skip = (Number(page) - 1) * perPage;

    const [items, total] = await Promise.all([
      Producto.find(filtro).sort(sort).skip(skip).limit(perPage),
      Producto.countDocuments(filtro),
    ]);

    // Para no romper front antiguos que esperan array, devolvemos solo items
    res.set("X-Total-Count", String(total));
    return res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al obtener productos" });
  }
};

// GET /api/productos/modelos?categoria=xxxxx  (devuelve array de marcas únicas)
const getModelosPorCategoria = async (req, res) => {
  try {
    const { categoria } = req.query;
    const filtro = {};
    if (categoria) filtro.categoria = String(categoria).toLowerCase();

    const marcas = await Producto.distinct("marca", filtro);
    return res.json((marcas || []).filter(Boolean).sort());
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al obtener modelos" });
  }
};

// GET /api/productos/:id
const getProductoById = async (req, res) => {
  try {
    const producto = await Producto.findById(req.params.id);
    if (!producto) return res.status(404).json({ message: "No encontrado" });
    res.json(producto);
  } catch (error) {
    res.status(500).json({ message: "Error al obtener producto" });
  }
};

// POST /api/productos
const createProducto = async (req, res) => {
  try {
    const body = req.body || {};

    // Normalizar categoría/subcategoría a lower
    if (body.categoria) body.categoria = String(body.categoria).toLowerCase();
    if (body.subcategoria) body.subcategoria = String(body.subcategoria).toLowerCase();

    const nuevoProducto = new Producto(body);
    await nuevoProducto.save();
    res.status(201).json(nuevoProducto);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: "Error al crear producto" });
  }
};

// PUT /api/productos/:id
const updateProducto = async (req, res) => {
  try {
    const body = req.body || {};
    if (body.categoria) body.categoria = String(body.categoria).toLowerCase();
    if (body.subcategoria) body.subcategoria = String(body.subcategoria).toLowerCase();

    const productoActualizado = await Producto.findByIdAndUpdate(
      req.params.id,
      body,
      { new: true }
    );
    res.json(productoActualizado);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: "Error al actualizar producto" });
  }
};

// DELETE /api/productos/:id
const deleteProducto = async (req, res) => {
  try {
    await Producto.findByIdAndDelete(req.params.id);
    res.json({ message: "Producto eliminado" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al eliminar producto" });
  }
};

module.exports = {
  getProductos,
  getModelosPorCategoria,
  getProductoById,
  createProducto,
  updateProducto,
  deleteProducto,
};
