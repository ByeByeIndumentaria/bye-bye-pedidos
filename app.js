/* ==========================================================================
   BYE BYE — Carga de Pedidos (versión web offline, un solo archivo)
   ==========================================================================
   Todo corre en el navegador, sin servidor. Los datos persistentes
   (precios manuales, precios importados nuevos, matches, próximo número de
   pedido) se guardan en localStorage del navegador, así que quedan
   guardados entre sesiones EN ESA COMPUTADORA (no se comparten entre
   compus distintas: cada una tiene su propio localStorage).
   ========================================================================== */

// --- Utilidades de texto -------------------------------------------------
function quitarAcentos(t) {
  return (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function norm(t) {
  return quitarAcentos(String(t || "")).toLowerCase().trim();
}
function escaparHTML(t) {
  return String(t || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
// Similitud simple entre dos textos (para el asistente de matching):
// cuenta palabras en común ponderadas por longitud, 0..1.
function similitud(a, b) {
  const wa = norm(a).split(/\s+/).filter(Boolean);
  const wb = norm(b).split(/\s+/).filter(Boolean);
  if (!wa.length || !wb.length) return 0;
  let comunes = 0;
  wa.forEach(w => { if (wb.includes(w)) comunes++; });
  return (2 * comunes) / (wa.length + wb.length);
}

// --- Persistencia local ----------------------------------------------------
const LS = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }
};

let preciosManuales = LS.get("bb_precios_manuales", {});       // {codigo: precio}
let preciosImportados = LS.get("bb_precios_importados", {});   // {codigo: {nombre,descripcion,precio,hoja,archivo}}
let matches = LS.get("bb_matches", { matches: {}, ignorados: [] }); // {matches:{prodId:codigo}, ignorados:[prodId]}

// Al publicar una lista maestra nueva se eliminan una sola vez los precios
// viejos guardados en cada navegador, para que no pisen la actualización.
const VERSION_LISTA_MAESTRA = "2026-08-20-lista-2-1";
if (LS.get("bb_version_lista_maestra", "") !== VERSION_LISTA_MAESTRA) {
  preciosManuales = {};
  preciosImportados = {};
  matches = { matches: {}, ignorados: [] };
  LS.set("bb_precios_manuales", preciosManuales);
  LS.set("bb_precios_importados", preciosImportados);
  LS.set("bb_matches", matches);
  LS.set("bb_version_lista_maestra", VERSION_LISTA_MAESTRA);
}

function guardarPreciosManuales() { LS.set("bb_precios_manuales", preciosManuales); }
function guardarPreciosImportados() { LS.set("bb_precios_importados", preciosImportados); }
function guardarMatches() { LS.set("bb_matches", matches); }

// --- Construcción de la base unificada de ítems buscables ------------------
let ITEMS = [];

function construirItems() {
  const items = [];
  const articulosUsados = new Set();
  const codigosCatalogo = new Set();

  CATALOGO.forEach(p => {
    let codigo = p.codigo || (matches.matches[String(p.id)] || null);
    if (codigo) {
      codigosCatalogo.add(codigo);
      articulosUsados.add(`${codigo}|${norm(p.nombre)}`);
    }
    const enStock = p.enStock !== false;

    let precio = null, origen = null;
    if (!enStock) {
      precio = null; origen = "sin_stock";
    } else if (codigo && preciosManuales[codigo] !== undefined) {
      precio = preciosManuales[codigo]; origen = "manual";
    } else if (codigo && preciosImportados[codigo]) {
      precio = preciosImportados[codigo].precio; origen = "importado";
    } else if (p.precioReferencia) {
      // Precio confirmado por nombre por Claude/Valentina. Tiene prioridad
      // sobre el precio "de base" por código en los casos donde el código
      // del catálogo está duplicado entre dos productos distintos (por
      // ejemplo TD1413 o Z8069, usados a la vez para la versión "largo" y
      // "corto" de un mismo modelo) — así cada uno conserva SU precio real
      // en vez de heredar por error el precio del otro.
      precio = p.precioReferencia.precio; origen = "referencia_nombre";
    } else if (codigo && PRECIOS_BASE_MAP[codigo]) {
      precio = PRECIOS_BASE_MAP[codigo].precio; origen = "base";
    }

    items.push({
      idItem: "prod:" + p.id,
      productoId: p.id,
      codigo,
      nombre: p.nombre,
      descripcion: p.descripcion,
      categoria: p.categoria,
      subcategoria: p.subcategoria,
      colores: p.colores || [],
      imagenes: p.imagenes || [],
      packaging: p.packaging || null,
      precio,
      precioOrigen: origen,
      enStock,
      tieneFoto: (p.imagenes || []).length > 0,
      busqueda: norm(`${p.nombre} ${codigo || ""} ${p.subcategoria} ${p.descripcion}`)
    });
  });

  // Artículos de precio que no corresponden a un producto del catálogo.
  // Se deduplican por código + nombre (no sólo por código), porque algunos
  // códigos se usan para dos prendas distintas, como Tonara/Tonara Hood.
  const todosLosArticulos = {};
  const nombresPorCodigo = {};
  PRECIOS_BASE.forEach(art => {
    if (!nombresPorCodigo[art.codigo]) nombresPorCodigo[art.codigo] = new Set();
    nombresPorCodigo[art.codigo].add(norm(art.nombre));
  });
  PRECIOS_BASE.forEach(art => { todosLosArticulos[`${art.codigo}|${norm(art.nombre)}`] = art; });
  Object.values(preciosImportados).forEach(art => {
    if (art && art.codigo) todosLosArticulos[`${art.codigo}|${norm(art.nombre)}`] = art;
  });
  Object.entries(todosLosArticulos).forEach(([claveArticulo, art]) => {
    if (articulosUsados.has(claveArticulo)) return;
    const codigo = art.codigo;
    // Si el código ya está en el catálogo y la lista sólo tiene un nombre
    // para ese código, se trata de la misma prenda con una redacción distinta.
    // Sólo agregamos una opción adicional cuando la lista confirma que el
    // código se comparte entre prendas diferentes.
    if (codigosCatalogo.has(codigo) && (nombresPorCodigo[codigo]?.size || 0) <= 1) return;
    let precio = preciosManuales[codigo] !== undefined ? preciosManuales[codigo] : art.precio;
    let origen = preciosManuales[codigo] !== undefined ? "manual" : "importado";
    items.push({
      idItem: "codigo:" + codigo,
      productoId: null,
      codigo,
      nombre: art.nombre || codigo,
      descripcion: art.descripcion || "",
      categoria: "",
      subcategoria: art.hoja || "",
      imagenes: [],
      precio,
      precioOrigen: origen,
      enStock: true,
      tieneFoto: false,
      busqueda: norm(`${art.nombre || ""} ${codigo} ${art.descripcion || ""}`)
    });
  });

  ITEMS = items;
}

const PRECIOS_BASE_MAP = {};
PRECIOS_BASE.forEach(a => { PRECIOS_BASE_MAP[a.codigo] = a; });

function buscarItems(consulta, limite = 25) {
  const q = norm(consulta);
  if (!q) return ITEMS.slice(0, limite);
  const palabras = q.split(/\s+/).filter(Boolean);
  let resultados = ITEMS.filter(it => palabras.every(p => it.busqueda.includes(p)));
  resultados.sort((a, b) => {
    if (a.enStock !== b.enStock) return a.enStock ? -1 : 1;
    const aPref = a.codigo && norm(a.codigo).startsWith(q) ? 0 : 1;
    const bPref = b.codigo && norm(b.codigo).startsWith(q) ? 0 : 1;
    if (aPref !== bPref) return aPref - bPref;
    const aFoto = a.tieneFoto ? 0 : 1, bFoto = b.tieneFoto ? 0 : 1;
    if (aFoto !== bFoto) return aFoto - bFoto;
    return a.nombre.localeCompare(b.nombre);
  });
  return resultados.slice(0, limite);
}

function fijarPrecioManual(codigo, precio) {
  if (!codigo) return;
  preciosManuales[codigo] = precio;
  guardarPreciosManuales();
  construirItems();
}

/* ==========================================================================
   BUSCADOR / AUTOCOMPLETADO
   ========================================================================== */
const elBuscador = document.getElementById("buscador");
const elResultados = document.getElementById("resultados");
let resultadosActuales = [];
let itemSeleccionado = null;

function renderResultados() {
  elResultados.innerHTML = "";
  resultadosActuales.forEach((it, i) => {
    const li = document.createElement("li");
    li.dataset.index = i;
    if (!it.enStock) li.classList.add("sin-stock");
    const spanNombre = document.createElement("span");
    spanNombre.textContent = it.nombre + (it.tieneFoto ? "" : "");
    const spanCodigo = document.createElement("span");
    spanCodigo.className = it.tieneFoto ? "codigo" : "codigo sinfoto";
    spanCodigo.textContent = !it.enStock
      ? `${it.codigo || "sin código"} · SIN STOCK`
      : (it.codigo || "sin código") + (it.tieneFoto ? "" : " · sin foto");
    li.appendChild(spanNombre);
    li.appendChild(spanCodigo);
    li.addEventListener("click", () => seleccionarItem(it));
    elResultados.appendChild(li);
  });
  elResultados.classList.toggle("visible", resultadosActuales.length > 0);
}

elBuscador.addEventListener("input", () => {
  resultadosActuales = buscarItems(elBuscador.value, 25);
  renderResultados();
});

elBuscador.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" && resultadosActuales.length) {
    e.preventDefault();
    const primero = elResultados.querySelector("li");
    if (primero) { primero.classList.add("activo"); primero.focus(); }
  } else if (e.key === "Enter" && resultadosActuales.length) {
    e.preventDefault();
    seleccionarItem(resultadosActuales[0]);
  }
});

function rutaImagen(imagenes) {
  return imagenes && imagenes.length ? imagenes[0] : null;
}

// Genera un <img> que va probando, EN ORDEN, todas las fotos candidatas de
// un producto (prod_X_1, prod_X_2, prod_X_3...) hasta encontrar una que
// realmente exista en la carpeta images/. Si ninguna existe, se reemplaza
// por el HTML de "placeholderHtml" (por ejemplo, un cartel "Sin imagen").
// Esto soluciona el caso de productos a los que les borraste/cambiaste la
// foto 1 pero sí tienen la 2, la 3, etc.
function construirImgConFallback(imagenes, atributosImg, placeholderHtml) {
  const lista = (imagenes || []).filter(Boolean);
  if (!lista.length) return placeholderHtml;
  const listaAttr = encodeURIComponent(JSON.stringify(lista));
  const placeholderAttr = encodeURIComponent(placeholderHtml);
  return `<img ${atributosImg} data-fotos="${listaAttr}" data-idx="0" data-placeholder="${placeholderAttr}" src="${lista[0]}" onerror="manejarErrorImagen(this)">`;
}

// Se llama sola cuando una foto no carga: prueba la siguiente de la lista;
// si ya no quedan más, muestra el placeholder correspondiente.
function manejarErrorImagen(img) {
  let lista = [];
  try { lista = JSON.parse(decodeURIComponent(img.dataset.fotos || "[]")); } catch (e) { lista = []; }
  const idx = parseInt(img.dataset.idx || "0", 10) + 1;
  if (idx < lista.length) {
    img.dataset.idx = String(idx);
    img.onerror = () => manejarErrorImagen(img);
    img.src = lista[idx];
  } else {
    const tmp = document.createElement("div");
    tmp.innerHTML = decodeURIComponent(img.dataset.placeholder || "");
    img.replaceWith(...tmp.childNodes);
  }
}

function celdaFotoHTML(imagenes, claseImg, claseVacia) {
  return construirImgConFallback(
    imagenes,
    `class="${claseImg}"`,
    `<div class="${claseVacia}">Sin imagen</div>`
  );
}

function renderCurvaCaja(item) {
  const cont = document.getElementById("curva-caja");
  const labelUnidCaja = document.getElementById("label-unidcaja");
  const inputUnidCaja = document.getElementById("in-unidcaja");

  if (item && item.packaging && item.packaging.totalPieces) {
    inputUnidCaja.value = item.packaging.totalPieces;
    inputUnidCaja.readOnly = false;
    labelUnidCaja.classList.add("automatico");

    const rows = item.packaging.rows || [];
    // Juntamos todos los talles que aparecen en cualquier fila, en orden.
    const talles = [];
    rows.forEach(r => Object.keys(r.sizePieces || {}).forEach(t => { if (!talles.includes(t)) talles.push(t); }));

    if (rows.length) {
      let thead = "<tr><th>Color</th>" + talles.map(t => `<th>${t}</th>`).join("") + "</tr>";
      let tbody = rows.map(r => {
        const celdas = talles.map(t => `<td>${r.sizePieces[t] || "–"}</td>`).join("");
        return `<tr><td>${r.color}</td>${celdas}</tr>`;
      }).join("");
      cont.innerHTML = `<div class="titulo-curva">Caja tipo sugerida: ${item.packaging.totalPieces} unidades</div>
        <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
      cont.style.display = "block";
    } else {
      cont.innerHTML = `<div class="titulo-curva">Caja tipo sugerida: ${item.packaging.totalPieces} unidades</div>`;
      cont.style.display = "block";
    }
  } else {
    inputUnidCaja.readOnly = false;
    labelUnidCaja.classList.remove("automatico");
    cont.style.display = "none";
    cont.innerHTML = "";
  }
}

function seleccionarItem(it) {
  if (!it.enStock) {
    const agregarIgual = confirm(`${it.nombre} figura sin stock en el catálogo. ¿Querés agregarlo igualmente al pedido?`);
    if (!agregarIgual) return;
  }
  itemSeleccionado = it;
  document.getElementById("preview-nombre").textContent = it.nombre;
  let textoCodigo = it.codigo ? it.codigo : "Sin código propio";
  if (!it.codigo && it.precioOrigen === "referencia_nombre") {
    textoCodigo += " · precio de referencia (vinculado por nombre, sin código de artículo todavía)";
  }
  document.getElementById("preview-codigo").textContent = textoCodigo;
  document.getElementById("preview-precio").value = it.precio != null ? it.precio.toFixed(2) : "";

  const foto = document.getElementById("preview-foto");
  foto.innerHTML = construirImgConFallback(
    it.imagenes,
    `style="width:100%;height:100%;object-fit:cover"`,
    `<span class="sin">Sin imagen</span>`
  );

  elResultados.classList.remove("visible");
  renderCurvaCaja(it);
  const observacionItem = document.getElementById("in-observacion-item");
  observacionItem.value = "";
  observacionItem.placeholder = it.colores && it.colores.length
    ? `Colores disponibles: ${it.colores.join(", ")}`
    : "Ej.: Negro y beige; priorizar talle M";
  document.getElementById("in-cajas").focus();
  document.getElementById("in-cajas").select();
  recalcularUnidades();
}

function recalcularUnidades() {
  const cajas = parseInt(document.getElementById("in-cajas").value || "0", 10) || 0;
  const unidCaja = parseInt(document.getElementById("in-unidcaja").value || "0", 10) || 0;
  document.getElementById("total-unid").textContent = `= ${cajas * unidCaja} unidad(es)`;
}
document.getElementById("in-cajas").addEventListener("input", recalcularUnidades);
document.getElementById("in-unidcaja").addEventListener("input", recalcularUnidades);

["in-cajas", "in-unidcaja", "preview-precio"].forEach(id => {
  document.getElementById(id).addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); agregarItemAlPedido(); }
  });
});
document.getElementById("btn-agregar").addEventListener("click", agregarItemAlPedido);

/* ==========================================================================
   PEDIDO ACTUAL
   ========================================================================== */
let pedidoItems = [];
let pedidoActualId = null;
let pedidoConCambios = false;
let cargandoPedido = false;
let pedidosGuardados = LS.get("bb_pedidos_guardados", []);
if (!Array.isArray(pedidosGuardados)) pedidosGuardados = [];

function marcarPedidoConCambios() {
  if (cargandoPedido) return;
  pedidoConCambios = true;
  document.getElementById("indicador-cambios").classList.remove("oculto");
}

function marcarPedidoGuardado() {
  pedidoConCambios = false;
  document.getElementById("indicador-cambios").classList.add("oculto");
}

function claseEstado(estado) {
  return "estado-" + norm(estado).replace(/\s+/g, "-");
}

function actualizarEstiloEstado() {
  const select = document.getElementById("f-estado");
  select.className = `estado-pedido ${claseEstado(select.value)}`;
}

function datosPedidoActual() {
  const resumen = obtenerResumen();
  return {
    id: pedidoActualId || (crypto.randomUUID ? crypto.randomUUID() : `pedido-${Date.now()}`),
    numero: document.getElementById("f-numero").value.trim(),
    fecha: document.getElementById("f-fecha").value.trim(),
    cliente: document.getElementById("f-cliente").value.trim(),
    telefono: document.getElementById("f-telefono").value.trim(),
    transporte: document.getElementById("f-transporte").value.trim(),
    observaciones: document.getElementById("f-observaciones").value,
    estado: document.getElementById("f-estado").value,
    descuento: document.getElementById("in-descuento").value,
    envio: document.getElementById("in-envio").value,
    items: pedidoItems.map(item => ({ ...item, imagenes: [...(item.imagenes || [])] })),
    total: resumen.total,
    actualizadoEn: new Date().toISOString()
  };
}

function guardarPedidoActual() {
  const pedido = datosPedidoActual();
  pedidoActualId = pedido.id;
  pedidosGuardados = [pedido, ...pedidosGuardados.filter(item => item.id !== pedido.id)];
  LS.set("bb_pedidos_guardados", pedidosGuardados);
  marcarPedidoGuardado();
  renderHistorialPedidos();
  alert(`Pedido ${pedido.numero || "sin número"} guardado como ${pedido.estado}.`);
}

function cargarPedidoGuardado(id) {
  const pedido = pedidosGuardados.find(item => item.id === id);
  if (!pedido) return;
  if (pedidoConCambios && !confirm("Hay cambios sin guardar. ¿Descartarlos y abrir otro pedido?")) return;
  cargandoPedido = true;
  pedidoActualId = pedido.id;
  document.getElementById("f-numero").value = pedido.numero || "";
  document.getElementById("f-fecha").value = pedido.fecha || "";
  document.getElementById("f-cliente").value = pedido.cliente || "";
  document.getElementById("f-telefono").value = pedido.telefono || "";
  document.getElementById("f-transporte").value = pedido.transporte || "";
  document.getElementById("f-observaciones").value = pedido.observaciones || "";
  document.getElementById("f-estado").value = pedido.estado || "Borrador";
  document.getElementById("in-descuento").value = pedido.descuento || 0;
  document.getElementById("in-envio").value = pedido.envio || 0;
  pedidoItems = (pedido.items || []).map(item => ({ ...item, imagenes: [...(item.imagenes || [])] }));
  actualizarEstiloEstado();
  renderTablaPedido();
  cargandoPedido = false;
  marcarPedidoGuardado();
  cerrarModal("modal-historial");
}

function nuevoPedido() {
  if (pedidoConCambios && !confirm("Hay cambios sin guardar. ¿Crear un pedido nuevo igualmente?")) return;
  cargandoPedido = true;
  pedidoActualId = null;
  pedidoItems = [];
  document.getElementById("f-numero").value = siguienteNumeroPedido();
  document.getElementById("f-fecha").value = new Date().toLocaleDateString("es-AR");
  ["f-cliente", "f-telefono", "f-transporte", "f-observaciones"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("f-estado").value = "Borrador";
  document.getElementById("in-descuento").value = 0;
  document.getElementById("in-envio").value = 0;
  actualizarEstiloEstado();
  renderTablaPedido();
  cargandoPedido = false;
  marcarPedidoGuardado();
}

function renderHistorialPedidos() {
  const lista = document.getElementById("lista-pedidos");
  if (!lista) return;
  const busqueda = norm(document.getElementById("buscar-pedidos").value);
  const estado = document.getElementById("filtrar-estado").value;
  const visibles = pedidosGuardados.filter(pedido =>
    (!busqueda || norm(`${pedido.numero} ${pedido.cliente}`).includes(busqueda)) &&
    (!estado || pedido.estado === estado)
  );
  lista.innerHTML = visibles.length ? visibles.map(pedido => `
    <div class="pedido-guardado">
      <div><strong>${escaparHTML(pedido.numero || "Sin número")} · ${escaparHTML(pedido.cliente || "Cliente sin completar")}</strong><div class="meta">${escaparHTML(pedido.fecha || "Sin fecha")} · <span class="${claseEstado(pedido.estado || "Borrador")}">${escaparHTML(pedido.estado || "Borrador")}</span> · ${(pedido.items || []).length} prendas · $${Number(pedido.total || 0).toFixed(2)}</div></div>
      <div class="acciones-registro"><button class="btn btn-acento" data-abrir-pedido="${pedido.id}">Abrir y editar</button><button class="btn" data-borrar-pedido="${pedido.id}">Eliminar</button></div>
    </div>`).join("") : '<div id="estado-vacio">No hay pedidos que coincidan con la búsqueda.</div>';
  lista.querySelectorAll("[data-abrir-pedido]").forEach(btn => btn.addEventListener("click", () => cargarPedidoGuardado(btn.dataset.abrirPedido)));
  lista.querySelectorAll("[data-borrar-pedido]").forEach(btn => btn.addEventListener("click", () => {
    const pedido = pedidosGuardados.find(item => item.id === btn.dataset.borrarPedido);
    if (!pedido || !confirm(`¿Eliminar el pedido ${pedido.numero || "sin número"}?`)) return;
    pedidosGuardados = pedidosGuardados.filter(item => item.id !== pedido.id);
    LS.set("bb_pedidos_guardados", pedidosGuardados);
    renderHistorialPedidos();
  }));
}

function agregarItemAlPedido() {
  if (!itemSeleccionado) return;
  const cajas = parseInt(document.getElementById("in-cajas").value || "0", 10) || 0;
  const unidCaja = parseInt(document.getElementById("in-unidcaja").value || "0", 10) || 0;
  const precio = parseFloat((document.getElementById("preview-precio").value || "0").replace(",", ".")) || 0;
  const observacion = document.getElementById("in-observacion-item").value.trim();
  if (cajas <= 0 || unidCaja <= 0) return;

  if (itemSeleccionado.codigo && itemSeleccionado.precio !== precio) {
    fijarPrecioManual(itemSeleccionado.codigo, precio);
  }

  pedidoItems.push({
    codigo: itemSeleccionado.codigo,
    nombre: itemSeleccionado.nombre,
    imagenes: itemSeleccionado.imagenes,
    cajas, unidadesPorCaja: unidCaja, precioUnitario: precio, observacion
  });
  marcarPedidoConCambios();
  renderTablaPedido();
  limpiarSeleccion();
}

function limpiarSeleccion() {
  itemSeleccionado = null;
  document.getElementById("preview-nombre").textContent = "Ningún producto seleccionado";
  document.getElementById("preview-codigo").textContent = "";
  document.getElementById("preview-precio").value = "";
  document.getElementById("in-observacion-item").value = "";
  document.getElementById("in-observacion-item").placeholder = "Ej.: Negro y beige; priorizar talle M";
  document.getElementById("preview-foto").innerHTML = `<span class="sin">Sin<br>selección</span>`;
  document.getElementById("in-cajas").value = "1";
  document.getElementById("in-unidcaja").value = "1";
  document.getElementById("in-unidcaja").readOnly = false;
  document.getElementById("label-unidcaja").classList.remove("automatico");
  document.getElementById("curva-caja").style.display = "none";
  document.getElementById("curva-caja").innerHTML = "";
  recalcularUnidades();
  elBuscador.value = "";
  resultadosActuales = [];
  renderResultados();
  elBuscador.focus();
}

function renderTablaPedido() {
  const tbody = document.getElementById("tbody-pedido");
  tbody.innerHTML = "";
  document.getElementById("estado-vacio").style.display = pedidoItems.length ? "none" : "block";

  pedidoItems.forEach((it, i) => {
    const unidTot = it.cajas * it.unidadesPorCaja;
    const subtotal = unidTot * it.precioUnitario;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${celdaFotoHTML(it.imagenes, "miniatura", "miniatura-vacia")}</td>
      <td>${it.codigo || "-"}</td>
      <td>${it.nombre}</td>
      <td><textarea class="observacion-item" data-idx="${i}" data-campo="observacion" placeholder="Color u observación">${escaparHTML(it.observacion)}</textarea></td>
      <td><input type="number" min="1" value="${it.cajas}" data-idx="${i}" data-campo="cajas" style="width:56px"></td>
      <td><input type="number" min="1" value="${it.unidadesPorCaja}" data-idx="${i}" data-campo="unidades" style="width:68px"></td>
      <td><input type="number" step="0.01" value="${it.precioUnitario}" data-idx="${i}" data-campo="precio" style="width:74px"></td>
      <td>$${subtotal.toFixed(2)}</td>
      <td><button class="btn-borrar" data-idx="${i}">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input[data-campo='cajas']").forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = +e.target.dataset.idx;
      pedidoItems[idx].cajas = parseInt(e.target.value || "0", 10) || 0;
      marcarPedidoConCambios();
      renderTablaPedido();
    });
  });
  tbody.querySelectorAll("input[data-campo='unidades']").forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = +e.target.dataset.idx;
      pedidoItems[idx].unidadesPorCaja = parseInt(e.target.value || "0", 10) || 0;
      marcarPedidoConCambios();
      recalcularResumen();
      const tds = e.target.closest("tr").querySelectorAll("td");
      const unidTot = pedidoItems[idx].cajas * pedidoItems[idx].unidadesPorCaja;
      tds[7].textContent = "$" + (unidTot * pedidoItems[idx].precioUnitario).toFixed(2);
    });
  });
  tbody.querySelectorAll("input[data-campo='precio']").forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = +e.target.dataset.idx;
      pedidoItems[idx].precioUnitario = parseFloat((e.target.value || "0").replace(",", ".")) || 0;
      marcarPedidoConCambios();
      recalcularResumen();
      const tds = e.target.closest("tr").querySelectorAll("td");
      const unidTot = pedidoItems[idx].cajas * pedidoItems[idx].unidadesPorCaja;
      tds[7].textContent = "$" + (unidTot * pedidoItems[idx].precioUnitario).toFixed(2);
    });
  });
  tbody.querySelectorAll("textarea[data-campo='observacion']").forEach(inp => {
    inp.addEventListener("input", e => {
      pedidoItems[+e.target.dataset.idx].observacion = e.target.value;
      marcarPedidoConCambios();
    });
  });
  tbody.querySelectorAll(".btn-borrar").forEach(btn => {
    btn.addEventListener("click", e => {
      pedidoItems.splice(+e.target.dataset.idx, 1);
      marcarPedidoConCambios();
      renderTablaPedido();
    });
  });

  recalcularResumen();
}

function obtenerResumen() {
  const subtotal = pedidoItems.reduce((acc, it) => acc + it.cajas * it.unidadesPorCaja * it.precioUnitario, 0);
  const descuentoPct = parseFloat(document.getElementById("in-descuento").value || "0") || 0;
  const envio = parseFloat(document.getElementById("in-envio").value || "0") || 0;
  const montoDescuento = subtotal * (descuentoPct / 100);
  const total = subtotal - montoDescuento + envio;
  return { subtotal, descuentoPct, envio, montoDescuento, total };
}

function recalcularResumen() {
  const r = obtenerResumen();
  document.getElementById("txt-subtotal").textContent = `Subtotal: $${r.subtotal.toFixed(2)}`;
  document.getElementById("txt-total").textContent = `TOTAL: $${r.total.toFixed(2)}`;
}
document.getElementById("in-descuento").addEventListener("input", recalcularResumen);
document.getElementById("in-envio").addEventListener("input", recalcularResumen);

document.getElementById("btn-vaciar").addEventListener("click", () => {
  if (pedidoItems.length && !confirm("¿Vaciar la selección actual?")) return;
  pedidoItems = [];
  marcarPedidoConCambios();
  renderTablaPedido();
});

/* ==========================================================================
   NÚMERO DE PEDIDO / DATOS DE CABECERA
   ========================================================================== */
function siguienteNumeroPedido() {
  let n = LS.get("bb_siguiente_numero", 1);
  return String(n).padStart(4, "0");
}
document.getElementById("f-numero").value = siguienteNumeroPedido();
document.getElementById("f-fecha").value = new Date().toLocaleDateString("es-AR");

/* ==========================================================================
   GENERAR Y DESCARGAR PDF DIRECTAMENTE
   ========================================================================== */
let libreriasPdfCargadas = false;

function cargarScriptExterno(src) {
  return new Promise((resolve, reject) => {
    const existente = document.querySelector(`script[src="${src}"]`);
    if (existente) {
      if (existente.dataset.cargado === "si") resolve();
      else {
        existente.addEventListener("load", resolve, { once: true });
        existente.addEventListener("error", reject, { once: true });
      }
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => { script.dataset.cargado = "si"; resolve(); };
    script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(script);
  });
}

async function cargarLibreriasPDF() {
  if (libreriasPdfCargadas && window.jspdf && window.jspdf.jsPDF) return;
  await cargarScriptExterno("https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js");
  await cargarScriptExterno("https://unpkg.com/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js");
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("La librería de PDF no quedó disponible.");
  libreriasPdfCargadas = true;
}

function blobADataURL(blob) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result);
    lector.onerror = reject;
    lector.readAsDataURL(blob);
  });
}

async function primeraFotoDisponible(imagenes) {
  for (const src of (imagenes || []).filter(Boolean)) {
    try {
      const respuesta = await fetch(src);
      if (!respuesta.ok) continue;
      return await blobADataURL(await respuesta.blob());
    } catch (e) { /* prueba la siguiente foto */ }
  }
  return null;
}

function nombreArchivoSeguro(texto) {
  return quitarAcentos(texto || "pedido")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "pedido";
}

document.getElementById("btn-pdf").addEventListener("click", async () => {
  if (!pedidoItems.length) { alert("Agregá al menos un producto antes de generar el PDF."); return; }
  const cliente = document.getElementById("f-cliente").value.trim();
  if (!cliente) { alert("Ingresá el nombre del cliente / razón social."); return; }

  const numero = document.getElementById("f-numero").value.trim();
  const fecha = document.getElementById("f-fecha").value.trim();
  const estadoPedido = document.getElementById("f-estado").value;
  const telefono = document.getElementById("f-telefono").value.trim();
  const transporte = document.getElementById("f-transporte").value.trim();
  const observaciones = document.getElementById("f-observaciones").value.trim();
  const r = obtenerResumen();

  const btnPdf = document.getElementById("btn-pdf");
  const textoOriginal = btnPdf.textContent;
  btnPdf.textContent = "Generando PDF…";
  btnPdf.disabled = true;

  try {
    await cargarLibreriasPDF();
    const fotos = await Promise.all(pedidoItems.map(it => primeraFotoDisponible(it.imagenes)));
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("BYE BYE Indumentaria", 12, 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Pedido N° ${numero || "-"}   |   Fecha: ${fecha || "-"}   |   Estado: ${estadoPedido}`, 12, 22);
    doc.text(`Cliente: ${cliente}   |   Teléfono: ${telefono || "-"}`, 12, 27);
    doc.text(`Transporte / Dirección: ${transporte || "-"}`, 12, 32);

    const cuerpo = pedidoItems.map(it => {
      const unidTot = it.cajas * it.unidadesPorCaja;
      const detalle = it.observacion ? `${it.nombre}\nColor / observaciones: ${it.observacion}` : it.nombre;
      return ["", it.codigo || "-", detalle, String(it.cajas), String(unidTot), `$${it.precioUnitario.toFixed(2)}`, `$${(unidTot * it.precioUnitario).toFixed(2)}`];
    });

    doc.autoTable({
      startY: 37,
      head: [["Foto", "Código", "Prenda / color", "Cajas", "Unid.", "Precio", "Subtotal"]],
      body: cuerpo,
      margin: { left: 12, right: 12, bottom: 14 },
      tableWidth: 172,
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8, cellPadding: 2, valign: "middle", lineColor: [180, 180, 180], lineWidth: 0.15 },
      headStyles: { fillColor: [22, 20, 18], textColor: [255, 255, 255], fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 16, minCellHeight: 16 },
        1: { cellWidth: 23 },
        2: { cellWidth: 57 },
        3: { cellWidth: 14, halign: "center" },
        4: { cellWidth: 14, halign: "center" },
        5: { cellWidth: 22, halign: "right" },
        6: { cellWidth: 26, halign: "right" }
      },
      didDrawCell(data) {
        if (data.section !== "body" || data.column.index !== 0) return;
        const foto = fotos[data.row.index];
        if (!foto) return;
        try {
          const props = doc.getImageProperties(foto);
          const max = 12;
          const escala = Math.min(max / props.width, max / props.height);
          const ancho = props.width * escala;
          const alto = props.height * escala;
          doc.addImage(foto, data.cell.x + (data.cell.width - ancho) / 2, data.cell.y + (data.cell.height - alto) / 2, ancho, alto);
        } catch (e) { /* el PDF continúa aunque una foto no sea compatible */ }
      }
    });

    let y = doc.lastAutoTable.finalY + 7;
    const lineasExtra = 4 + (r.descuentoPct ? 1 : 0) + (r.envio ? 1 : 0);
    if (y + lineasExtra * 5 > 282) { doc.addPage(); y = 18; }
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Subtotal: $${r.subtotal.toFixed(2)}`, 198, y, { align: "right" });
    y += 5;
    if (r.descuentoPct) { doc.text(`Descuento (${r.descuentoPct}%): -$${r.montoDescuento.toFixed(2)}`, 198, y, { align: "right" }); y += 5; }
    if (r.envio) { doc.text(`Envío: $${r.envio.toFixed(2)}`, 198, y, { align: "right" }); y += 5; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`TOTAL: $${r.total.toFixed(2)}`, 198, y, { align: "right" });
    y += 9;
    const lineasObs = doc.splitTextToSize(observaciones || "-", 186);
    if (y + 5 + lineasObs.length * 4 > 282) { doc.addPage(); y = 18; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Observaciones para depósito", 12, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.text(lineasObs, 12, y);

    const totalPaginas = doc.getNumberOfPages();
    for (let pagina = 1; pagina <= totalPaginas; pagina++) {
      doc.setPage(pagina);
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`Página ${pagina} de ${totalPaginas}`, 198, 290, { align: "right" });
    }
    doc.setTextColor(0);

    const archivo = `Pedido-${nombreArchivoSeguro(numero)}-${nombreArchivoSeguro(cliente)}.pdf`;
    doc.save(archivo);

    let n = LS.get("bb_siguiente_numero", 1);
    LS.set("bb_siguiente_numero", n + 1);
    document.getElementById("f-numero").value = siguienteNumeroPedido();
  } catch (error) {
    console.error(error);
    alert("No se pudo generar el PDF. Revisá tu conexión a internet e intentá nuevamente.");
  } finally {
    btnPdf.textContent = textoOriginal;
    btnPdf.disabled = false;
  }
});

/* ==========================================================================
   IMPORTAR PRECIOS DESDE EXCEL (SheetJS, cargado sólo al usarlo)
   ========================================================================== */
const modalExcel = document.getElementById("modal-excel");
document.getElementById("btn-importar-excel").addEventListener("click", () => abrirModal("modal-excel"));

let sheetJsCargado = false;
function cargarSheetJS() {
  return new Promise((resolve, reject) => {
    if (sheetJsCargado || window.XLSX) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.onload = () => { sheetJsCargado = true; resolve(); };
    script.onerror = () => reject(new Error("No se pudo cargar la librería de Excel. Verificá tu conexión a internet."));
    document.head.appendChild(script);
  });
}

const CLAVES_CODIGO = ["art", "codigo", "cod.", "sku"];
const CLAVES_NOMBRE = ["nombre"];
const CLAVES_DESCRIPCION = ["descrip"];
const CLAVES_PRECIO = ["precio"];
const CLAVES_PRECIO_EXCLUIR = ["fob"];

function detectarFilaEncabezado(filas) {
  for (let i = 0; i < Math.min(15, filas.length); i++) {
    const celdas = (filas[i] || []).map(c => norm(c));
    const tieneCodigo = celdas.some(c => c && CLAVES_CODIGO.some(k => c.includes(k)));
    const tienePrecio = celdas.some(c => c && CLAVES_PRECIO.some(k => c.includes(k)) && !CLAVES_PRECIO_EXCLUIR.some(k => c.includes(k)));
    if (tieneCodigo && tienePrecio) return i;
  }
  return -1;
}

function mapearColumnas(filaEncabezado) {
  const mapa = {};
  filaEncabezado.forEach((celda, idx) => {
    const c = norm(celda);
    if (!c) return;
    if (mapa.codigo === undefined && CLAVES_CODIGO.some(k => c.includes(k))) mapa.codigo = idx;
    else if (mapa.nombre === undefined && CLAVES_NOMBRE.some(k => c.includes(k))) mapa.nombre = idx;
    else if (mapa.descripcion === undefined && CLAVES_DESCRIPCION.some(k => c.includes(k))) mapa.descripcion = idx;
    else if (mapa.precio === undefined && CLAVES_PRECIO.some(k => c.includes(k)) && !CLAVES_PRECIO_EXCLUIR.some(k => c.includes(k))) mapa.precio = idx;
  });
  return mapa;
}

function valorPrecio(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const t = String(v).trim().replace("$", "").replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

async function procesarArchivoExcel(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  let importados = 0, sinPrecio = 0;
  const avisos = [];

  wb.SheetNames.forEach(nombreHoja => {
    const hoja = wb.Sheets[nombreHoja];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null });
    const idxEnc = detectarFilaEncabezado(filas);
    if (idxEnc === -1) {
      avisos.push(`Hoja "${nombreHoja}": no se detectó encabezado con código y precio. Se omite.`);
      return;
    }
    const mapa = mapearColumnas(filas[idxEnc]);
    if (mapa.codigo === undefined || mapa.precio === undefined) {
      avisos.push(`Hoja "${nombreHoja}": faltan columnas de código o precio. Se omite.`);
      return;
    }
    for (let i = idxEnc + 1; i < filas.length; i++) {
      const fila = filas[i];
      if (!fila || fila.every(c => c === null || c === "")) continue;
      let codigo = fila[mapa.codigo];
      if (codigo === null || codigo === undefined || String(codigo).trim() === "") continue;
      codigo = String(codigo).trim();
      const nombre = mapa.nombre !== undefined ? (fila[mapa.nombre] || "") : "";
      const descripcion = mapa.descripcion !== undefined ? (fila[mapa.descripcion] || "") : "";
      const precio = valorPrecio(fila[mapa.precio]);
      if (precio === null) sinPrecio++;
      preciosImportados[codigo] = {
        codigo, nombre: String(nombre), descripcion: String(descripcion),
        precio, hoja: nombreHoja, archivo: file.name,
        fecha: new Date().toISOString()
      };
      importados++;
    }
  });

  guardarPreciosImportados();
  return { importados, sinPrecio, avisos };
}

document.getElementById("input-excel").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const resultadoDiv = document.getElementById("resultado-excel");
  resultadoDiv.textContent = "Cargando librería de Excel…";
  try {
    await cargarSheetJS();
  } catch (err) {
    resultadoDiv.textContent = err.message;
    return;
  }
  resultadoDiv.textContent = "Procesando…";
  let resumen = [];
  for (const file of files) {
    try {
      const r = await procesarArchivoExcel(file);
      resumen.push(`• ${file.name}: ${r.importados} artículos importados (${r.sinPrecio} sin precio numérico)` +
        (r.avisos.length ? "<br>&nbsp;&nbsp;⚠ " + r.avisos.join("<br>&nbsp;&nbsp;⚠ ") : ""));
    } catch (err) {
      resumen.push(`• ${file.name}: error al procesar (${err.message})`);
    }
  }
  resultadoDiv.innerHTML = resumen.join("<br><br>");
  construirItems();
  actualizarBarraEstado();
});

/* ==========================================================================
   ASISTENTE DE MATCHING
   ========================================================================== */
let matchPendientes = [];
let matchIndice = 0;

function productosPendientesDeMatch() {
  const asociados = new Set(Object.keys(matches.matches));
  const ignorados = new Set(matches.ignorados);
  return CATALOGO.filter(p => !p.codigo && !asociados.has(String(p.id)) && !ignorados.has(p.id));
}

function sugerirArticulos(producto, topN = 5) {
  const texto = `${producto.nombre} ${producto.subcategoria}`;
  const todos = { ...PRECIOS_BASE_MAP, ...preciosImportados };
  const candidatos = Object.values(todos)
    .filter(a => a.nombre || a.descripcion)
    .map(a => ({ ...a, score: similitud(texto, `${a.nombre} ${a.descripcion}`) }));
  candidatos.sort((a, b) => b.score - a.score);
  return candidatos.slice(0, topN);
}

document.getElementById("btn-matching").addEventListener("click", () => {
  matchPendientes = productosPendientesDeMatch();
  matchIndice = 0;
  abrirModal("modal-matching");
  mostrarMatchActual();
});

function mostrarMatchActual() {
  const progreso = document.getElementById("match-progreso");
  const sugerenciasDiv = document.getElementById("match-sugerencias");
  if (matchIndice >= matchPendientes.length) {
    progreso.textContent = "¡Listo! No quedan productos pendientes de asociar.";
    document.getElementById("match-nombre").textContent = "";
    document.getElementById("match-detalle").textContent = "";
    document.getElementById("match-foto").innerHTML = "";
    sugerenciasDiv.innerHTML = "";
    return;
  }
  const p = matchPendientes[matchIndice];
  progreso.textContent = `Producto ${matchIndice + 1} de ${matchPendientes.length} sin código`;
  document.getElementById("match-nombre").textContent = p.nombre;
  document.getElementById("match-detalle").textContent = `${p.categoria} · ${p.subcategoria}`;
  document.getElementById("match-foto").innerHTML = construirImgConFallback(
    p.imagenes,
    `style="width:100%;height:100%;object-fit:cover"`,
    `<span class="sin">Sin imagen</span>`
  );

  const sugerencias = sugerirArticulos(p);
  sugerenciasDiv.innerHTML = "";
  if (!sugerencias.length) {
    sugerenciasDiv.innerHTML = `<p style="font-size:13px;color:var(--tinta-suave)">No hay artículos parecidos importados todavía.</p>`;
  }
  sugerencias.forEach(s => {
    const div = document.createElement("div");
    div.className = "sugerencia";
    const precioTxt = s.precio != null ? `$${s.precio.toFixed(2)}` : "sin precio";
    div.innerHTML = `<span class="texto">${s.codigo} — ${s.nombre} (${precioTxt}) <span class="score">similitud ${Math.round(s.score * 100)}%</span></span>`;
    const btn = document.createElement("button");
    btn.className = "btn btn-acento";
    btn.textContent = "Usar este código";
    btn.addEventListener("click", () => confirmarMatch(s.codigo));
    div.appendChild(btn);
    sugerenciasDiv.appendChild(div);
  });
  document.getElementById("match-manual").value = "";
}

function confirmarMatch(codigo) {
  const p = matchPendientes[matchIndice];
  matches.matches[String(p.id)] = { codigo, fecha: new Date().toISOString() };
  matches.ignorados = matches.ignorados.filter(id => id !== p.id);
  guardarMatches();
  construirItems();
  matchIndice++;
  mostrarMatchActual();
}
document.getElementById("match-confirmar-manual").addEventListener("click", () => {
  const codigo = document.getElementById("match-manual").value.trim();
  if (codigo) confirmarMatch(codigo);
});
document.getElementById("match-omitir").addEventListener("click", () => {
  matchIndice++; mostrarMatchActual();
});
document.getElementById("match-ignorar").addEventListener("click", () => {
  const p = matchPendientes[matchIndice];
  if (!matches.ignorados.includes(p.id)) matches.ignorados.push(p.id);
  guardarMatches();
  construirItems();
  matchIndice++;
  mostrarMatchActual();
});

/* ==========================================================================
   MODALES / BARRA DE ESTADO
   ========================================================================== */
function abrirModal(id) { document.getElementById(id).classList.add("abierto"); }
function cerrarModal(id) { document.getElementById(id).classList.remove("abierto"); }
document.querySelectorAll("[data-cerrar]").forEach(btn => {
  btn.addEventListener("click", () => cerrarModal(btn.dataset.cerrar));
});
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.classList.remove("abierto"); });
});

/* ==========================================================================
   RESTABLECER PRECIOS/MATCHES GUARDADOS EN ESTE NAVEGADOR
   ==========================================================================
   Si en algún momento se importó un Excel viejo, se corrigió un precio a
   mano, o se confirmó un match incorrecto (por ejemplo con la lista de
   Invierno para un producto de Verano), esos datos quedan guardados en el
   navegador y pisan los precios nuevos que vienen cargados en el archivo.
   Este botón los borra para que vuelvan a valer los precios "de fábrica"
   que trae el archivo (los que Claude cargó más recientemente).
   ========================================================================== */
document.getElementById("btn-reset").addEventListener("click", () => {
  const detalle = [];
  if (Object.keys(preciosManuales).length) detalle.push(`${Object.keys(preciosManuales).length} precio(s) editado(s) a mano`);
  if (Object.keys(preciosImportados).length) detalle.push(`${Object.keys(preciosImportados).length} artículo(s) de Excel importados en este navegador`);
  const nMatches = Object.keys(matches.matches || {}).length;
  const nIgnorados = (matches.ignorados || []).length;
  if (nMatches || nIgnorados) detalle.push(`${nMatches} match(es) y ${nIgnorados} producto(s) marcado(s) como "sin match"`);

  if (!detalle.length) {
    alert("No hay datos guardados en este navegador para restablecer. Ya estás usando los precios que trae el archivo.");
    return;
  }

  const mensaje =
    "Esto va a borrar, sólo en este navegador:\n\n- " + detalle.join("\n- ") +
    "\n\nDespués de esto se usarán únicamente los precios que ya vienen cargados " +
    "en el archivo. ¿Confirmás?";
  if (!confirm(mensaje)) return;

  preciosManuales = {};
  preciosImportados = {};
  matches = { matches: {}, ignorados: [] };
  guardarPreciosManuales();
  guardarPreciosImportados();
  guardarMatches();
  construirItems();
  actualizarBarraEstado();
  limpiarSeleccion();
  alert("Listo. Se restablecieron los precios y matches de este navegador.");
});

function actualizarBarraEstado() {
  const enStock = CATALOGO.filter(p => p.enStock !== false);
  const sinStock = CATALOGO.length - enStock.length;
  const conFoto = enStock.filter(p => (p.imagenes || []).length > 0).length;
  const conCodigo = enStock.filter(p => p.codigo).length;
  const totalArticulosPrecio = Object.keys({ ...PRECIOS_BASE_MAP, ...preciosImportados }).length;
  document.getElementById("barra-estado").textContent =
    `Catálogo: ${enStock.length} productos en stock (${conFoto} con foto, ${conCodigo} con código) · ` +
    `${sinStock} sin stock · Precios cargados: ${totalArticulosPrecio} códigos`;
}

/* ==========================================================================
   INICIO
   ========================================================================== */
["f-numero", "f-fecha", "f-cliente", "f-telefono", "f-transporte", "f-observaciones", "f-estado", "in-descuento", "in-envio"].forEach(id => {
  document.getElementById(id).addEventListener("input", marcarPedidoConCambios);
});
document.getElementById("f-estado").addEventListener("change", () => {
  actualizarEstiloEstado();
  marcarPedidoConCambios();
});
document.getElementById("btn-guardar-borrador").addEventListener("click", guardarPedidoActual);
document.getElementById("btn-nuevo-pedido").addEventListener("click", nuevoPedido);
document.getElementById("btn-historial").addEventListener("click", () => {
  renderHistorialPedidos();
  abrirModal("modal-historial");
});
document.getElementById("buscar-pedidos").addEventListener("input", renderHistorialPedidos);
document.getElementById("filtrar-estado").addEventListener("change", renderHistorialPedidos);
window.addEventListener("beforeunload", event => {
  if (!pedidoConCambios) return;
  event.preventDefault();
  event.returnValue = "";
});

construirItems();
renderTablaPedido();
actualizarBarraEstado();
actualizarEstiloEstado();
renderHistorialPedidos();
