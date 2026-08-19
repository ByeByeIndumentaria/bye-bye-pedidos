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

function guardarPreciosManuales() { LS.set("bb_precios_manuales", preciosManuales); }
function guardarPreciosImportados() { LS.set("bb_precios_importados", preciosImportados); }
function guardarMatches() { LS.set("bb_matches", matches); }

// --- Construcción de la base unificada de ítems buscables ------------------
let ITEMS = [];

function construirItems() {
  const items = [];
  const codigosUsados = new Set();

  CATALOGO.forEach(p => {
    let codigo = p.codigo || (matches.matches[String(p.id)] || null);
    if (codigo) codigosUsados.add(codigo);

    let precio = null, origen = null;
    if (codigo && preciosManuales[codigo] !== undefined) {
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
      imagenes: p.imagenes || [],
      packaging: p.packaging || null,
      precio,
      precioOrigen: origen,
      tieneFoto: (p.imagenes || []).length > 0,
      busqueda: norm(`${p.nombre} ${codigo || ""} ${p.subcategoria} ${p.descripcion}`)
    });
  });

  // Artículos de precio que no corresponden a ningún producto con foto.
  const todosLosArticulos = { ...PRECIOS_BASE_MAP, ...preciosImportados };
  Object.keys(todosLosArticulos).forEach(codigo => {
    if (codigosUsados.has(codigo)) return;
    const art = todosLosArticulos[codigo];
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
    const spanNombre = document.createElement("span");
    spanNombre.textContent = it.nombre + (it.tieneFoto ? "" : "");
    const spanCodigo = document.createElement("span");
    spanCodigo.className = it.tieneFoto ? "codigo" : "codigo sinfoto";
    spanCodigo.textContent = (it.codigo || "sin código") + (it.tieneFoto ? "" : " · sin foto");
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
    inputUnidCaja.readOnly = true;
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
      cont.innerHTML = `<div class="titulo-curva">Caja tipo: ${item.packaging.totalPieces} unidades</div>
        <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
      cont.style.display = "block";
    } else {
      cont.innerHTML = `<div class="titulo-curva">Caja tipo: ${item.packaging.totalPieces} unidades</div>`;
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

function agregarItemAlPedido() {
  if (!itemSeleccionado) return;
  const cajas = parseInt(document.getElementById("in-cajas").value || "0", 10) || 0;
  const unidCaja = parseInt(document.getElementById("in-unidcaja").value || "0", 10) || 0;
  const precio = parseFloat((document.getElementById("preview-precio").value || "0").replace(",", ".")) || 0;
  if (cajas <= 0 || unidCaja <= 0) return;

  if (itemSeleccionado.codigo && itemSeleccionado.precio !== precio) {
    fijarPrecioManual(itemSeleccionado.codigo, precio);
  }

  pedidoItems.push({
    codigo: itemSeleccionado.codigo,
    nombre: itemSeleccionado.nombre,
    imagenes: itemSeleccionado.imagenes,
    cajas, unidadesPorCaja: unidCaja, precioUnitario: precio
  });
  renderTablaPedido();
  limpiarSeleccion();
}

function limpiarSeleccion() {
  itemSeleccionado = null;
  document.getElementById("preview-nombre").textContent = "Ningún producto seleccionado";
  document.getElementById("preview-codigo").textContent = "";
  document.getElementById("preview-precio").value = "";
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
      <td><input type="number" min="1" value="${it.cajas}" data-idx="${i}" data-campo="cajas" style="width:56px"></td>
      <td>${unidTot}</td>
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
      renderTablaPedido();
    });
  });
  tbody.querySelectorAll("input[data-campo='precio']").forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = +e.target.dataset.idx;
      pedidoItems[idx].precioUnitario = parseFloat((e.target.value || "0").replace(",", ".")) || 0;
      recalcularResumen();
      const tds = e.target.closest("tr").querySelectorAll("td");
      const unidTot = pedidoItems[idx].cajas * pedidoItems[idx].unidadesPorCaja;
      tds[6].textContent = "$" + (unidTot * pedidoItems[idx].precioUnitario).toFixed(2);
    });
  });
  tbody.querySelectorAll(".btn-borrar").forEach(btn => {
    btn.addEventListener("click", e => {
      pedidoItems.splice(+e.target.dataset.idx, 1);
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
   GENERAR PDF (vía impresión del navegador — funciona 100% offline)
   ========================================================================== */

// Espera a que todas las <img> de un contenedor terminen de resolverse
// (carguen bien, o agoten su lista de fotos alternativas y se reemplacen
// por el placeholder) antes de seguir. Esto es necesario porque
// window.print() puede dispararse ANTES de que el navegador termine de
// cargar las fotos (sobre todo cuando una foto falla y hay que probar la
// siguiente), y entonces salían en blanco en el PDF.
function esperarImagenes(contenedor, timeoutMs = 4000) {
  const imgs = Array.from(contenedor.querySelectorAll("img"));
  if (!imgs.length) return Promise.resolve();
  const promesas = imgs.map(img => new Promise(resolve => {
    let resuelto = false;
    const terminar = () => { if (!resuelto) { resuelto = true; resolve(); } };

    if (img.complete && img.naturalWidth > 0) { terminar(); return; }

    img.addEventListener("load", terminar);
    img.addEventListener("error", () => {
      // Puede ser un fallo intermedio (todavía va a probar la próxima foto
      // de la lista) o el fallo final (se reemplaza por el placeholder).
      // En ambos casos, esperamos un instante extra a que el DOM se
      // termine de acomodar antes de dar por resuelta esta imagen.
      setTimeout(() => {
        if (!contenedor.contains(img) || (img.complete && img.naturalWidth > 0)) {
          terminar();
        } else {
          // sigue reintentando con la siguiente foto: esperamos un poco más
          img.addEventListener("load", terminar);
          img.addEventListener("error", terminar);
        }
      }, 50);
    });
    // Red de seguridad: nunca esperamos para siempre.
    setTimeout(terminar, timeoutMs);
  }));
  return Promise.all(promesas);
}

document.getElementById("btn-pdf").addEventListener("click", () => {
  if (!pedidoItems.length) { alert("Agregá al menos un producto antes de generar el PDF."); return; }
  const cliente = document.getElementById("f-cliente").value.trim();
  if (!cliente) { alert("Ingresá el nombre del cliente / razón social."); return; }

  const numero = document.getElementById("f-numero").value.trim();
  const fecha = document.getElementById("f-fecha").value.trim();
  const telefono = document.getElementById("f-telefono").value.trim();
  const transporte = document.getElementById("f-transporte").value.trim();
  const observaciones = document.getElementById("f-observaciones").value.trim();
  const r = obtenerResumen();

  let filas = "";
  pedidoItems.forEach(it => {
    const unidTot = it.cajas * it.unidadesPorCaja;
    const subtotal = unidTot * it.precioUnitario;
    const foto = construirImgConFallback(it.imagenes, "", `<span class="sin-mini">Sin<br>foto</span>`);
    filas += `<tr>
      <td>${foto}</td>
      <td>${it.codigo || "-"}</td>
      <td>${it.nombre}</td>
      <td>${it.cajas}</td>
      <td>${unidTot}</td>
      <td>$${it.precioUnitario.toFixed(2)}</td>
      <td>$${subtotal.toFixed(2)}</td>
    </tr>`;
  });

  let filasTotales = `<div>Subtotal: $${r.subtotal.toFixed(2)}</div>`;
  if (r.descuentoPct) filasTotales += `<div>Descuento (${r.descuentoPct}%): -$${r.montoDescuento.toFixed(2)}</div>`;
  if (r.envio) filasTotales += `<div>Envío: $${r.envio.toFixed(2)}</div>`;
  filasTotales += `<div class="total">TOTAL: $${r.total.toFixed(2)}</div>`;

  const hoja = document.getElementById("hoja-impresion");
  hoja.innerHTML = `
    <h1>BYE BYE Indumentaria</h1>
    <div class="meta">
      <div><b>N° de Pedido:</b> ${numero} &nbsp;&nbsp; <b>Fecha:</b> ${fecha}</div>
      <div><b>Cliente:</b> ${cliente} &nbsp;&nbsp; <b>Teléfono:</b> ${telefono}</div>
      <div><b>Transporte / Dirección:</b> ${transporte}</div>
    </div>
    <table>
      <thead><tr><th>Foto</th><th>Código</th><th>Prenda</th><th>Cajas</th><th>Unid.</th><th>Precio</th><th>Subtotal</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div class="totales-imp">${filasTotales}</div>
    <div class="obs"><b>Observaciones para depósito</b><br>${observaciones || "-"}</div>
  `;

  const btnPdf = document.getElementById("btn-pdf");
  const textoOriginal = btnPdf.textContent;
  btnPdf.textContent = "Preparando fotos…";
  btnPdf.disabled = true;

  esperarImagenes(hoja).then(() => {
    btnPdf.textContent = textoOriginal;
    btnPdf.disabled = false;
    window.print();

    let n = LS.get("bb_siguiente_numero", 1);
    LS.set("bb_siguiente_numero", n + 1);
  });
});

window.addEventListener("afterprint", () => {
  document.getElementById("f-numero").value = siguienteNumeroPedido();
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
  const conFoto = CATALOGO.filter(p => (p.imagenes || []).length > 0).length;
  const conCodigo = CATALOGO.filter(p => p.codigo).length;
  const totalArticulosPrecio = Object.keys({ ...PRECIOS_BASE_MAP, ...preciosImportados }).length;
  document.getElementById("barra-estado").textContent =
    `Catálogo: ${CATALOGO.length} productos (${conFoto} con foto, ${conCodigo} con código) · ` +
    `Precios cargados: ${totalArticulosPrecio} artículos`;
}

/* ==========================================================================
   INICIO
   ========================================================================== */
construirItems();
renderTablaPedido();
actualizarBarraEstado();
