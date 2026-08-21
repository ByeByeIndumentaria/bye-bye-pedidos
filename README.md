# BYE BYE — Notas de Pedido (versión web, sin instalación)

Esta es la versión simple: **un archivo HTML que abrís haciendo doble clic**,
en cualquier computadora, sin instalar Python, sin instalar nada. Funciona
sin conexión a internet (excepto una función puntual: importar Excel, que se
explica más abajo).

---

## 1. Cómo abrirlo

1. Copiá la carpeta completa **`bye_bye_pedidos_web/`** a la computadora
   donde la vayas a usar (podés llevarla en un pendrive, por mail, por
   WhatsApp comprimida en .zip, como quieras).
2. Adentro de esa carpeta, reemplazá la carpeta `images/` (que viene vacía)
   por tu carpeta real de fotos de productos — los mismos archivos que usa
   tu sitio web (`prod_35_1.jpg`, etc.).
3. Hacé doble clic en **`pedidos.html`**. Se abre en tu navegador (Chrome,
   Edge, Firefox — cualquiera sirve) y ya podés usarlo.

**Importante:** los archivos `pedidos.html`, `app.js` y la carpeta `images/`
tienen que estar siempre juntos, en la misma carpeta. Si copiás sólo el
`.html` suelto, no va a encontrar las fotos.

Podés copiar esta misma carpeta a varias computadoras (mostrador, depósito,
notebook personal) — cada una funciona de forma independiente.

---

## 2. Qué trae cargado de entrada

Ya viene con:
- El catálogo completo de tu sitio web (productos, fotos, códigos).
- Los precios de la lista **Venta Final Invierno 2026** que ya me habías
  pasado.

Si tu catálogo o tus precios cambiaron desde ahora, seguí leyendo.

---

## 3. Cargar o actualizar precios (Excel)

**Ya viene con la lista completa y corregida cargada** (Invierno 2026 +
Verano SS27 Hombre y Dama combinados — 152 artículos con código). Si en
algún momento usaste una versión anterior de esta carpeta en esa misma
computadora, puede haber quedado algún precio viejo o una asociación de
código incorrecta guardada en el navegador — usá el botón **"Restablecer
precios guardados"** (arriba a la derecha) para limpiar eso y que valgan
los precios nuevos que trae este archivo.

Para cargar una lista de precios nueva en el futuro: botón **"Importar
precios (Excel)"** → elegís uno o varios archivos `.xlsx`. Se detecta
automáticamente la estructura (igual que hasta ahora).

⚠️ Esta función puntual necesita internet la primera vez que la usás en esa
computadora (para descargar la librería que lee archivos Excel). El resto
de la app sigue funcionando offline igual que siempre.

Los precios importados quedan guardados **en esa computadora**. Si cargás
la misma carpeta en otra compu, vas a tener que volver a importar los Excel
ahí también.

---

## 4. Asistente de matching

Igual que en la versión anterior: botón **"Asistente de matching"** te
muestra, uno por uno, los productos sin código propio y te sugiere el
artículo de precio más parecido por nombre. Confirmás, corregís a mano, o
marcás "sin match". Esto también queda guardado en esa computadora.

Actualmente hay **13 productos sin código** en tu catálogo (los mismos que
ya te había listado). Si les agregás el código directamente en tu
`script.js` y me lo volvés a pasar, regenero este archivo con todo ya
resuelto.

---

## 5. Cargar un pedido

Igual que antes:
1. Completá los datos del cliente.
2. Buscá por código o nombre — aparece la lista de coincidencias.
3. Elegís el producto (clic, o con el teclado), se muestra la foto y el
   precio.
4. **Si ese producto ya tiene la "caja tipo" cargada** (la curva de colores
   y talles que arma cada caja, tal como está en tu sitio web), el campo
   **"Unid. por caja" se completa solo** y aparece la tabla con el
   desglose exacto (qué color y qué talle trae cada caja). Vos sólo
   tenés que indicar cuántas **cajas** pedís — el total de unidades y el
   subtotal se calculan solos.
5. **Si ese producto todavía no tiene la curva cargada en tu sitio web**,
   el campo "Unid. por caja" queda editable como antes, para que lo
   completes a mano.
6. **Enter** (o clic en "Agregar"): se suma al pedido y el cursor vuelve
   solo al buscador.
7. Podés editar cantidades/precio o borrar cualquier ítem ya cargado, ahí
   mismo en la tabla.
8. Descuento % y Envío $ opcionales — el total se recalcula solo.

### Guardar y continuar pedidos

- **Guardar pedido** conserva el pedido actual en este navegador, incluso si todavía es un borrador.
- **Pedidos guardados** permite buscar, abrir y seguir editando cualquier pedido anterior.
- Cada pedido puede marcarse como Borrador, En confirmación, Por pagar, Pagado, En preparación, Entregado o Cancelado.
- Si intentás cerrar la página con cambios pendientes, el navegador muestra una advertencia.

Actualmente **136 de 180 productos** ya tienen su curva de caja cargada
(la misma info que usa tu sitio web). Los que todavía no la tienen son,
sobre todo, productos de la colección anterior a "Producción Invierno
2027". Si les cargás la curva en el sitio (con `packaging: { totalPieces:
..., rows: [...] }`, como los demás) y me volvés a pasar el `script.js`,
te regenero el archivo con eso ya resuelto también para esos.

---

## 6. Generar el PDF del pedido

Botón **"Generar PDF del pedido"**. Se abre el diálogo de impresión del
navegador con la nota de pedido ya armada (con fotos incluidas). Ahí:

- Como destino/impresora, elegís **"Guardar como PDF"** (todos los
  navegadores modernos lo traen de fábrica).
- Le ponés nombre al archivo y elegís dónde guardarlo.

Esto reemplaza a un generador de PDF por software: usa la función de
impresión que ya trae el navegador, así que no depende de ninguna librería
ni de internet.

---

## 7. Dónde queda todo guardado

Todo lo que la app "recuerda" (precios importados, precios corregidos a
mano, matches confirmados, el próximo número de pedido) se guarda en el
navegador de **esa computadora específica**, no en el archivo HTML. Si
querés llevarte esos datos a otra compu, por ahora hay que volver a hacer
esos pasos ahí (importar Excel, confirmar matches). Si esto te complica el
uso en varias computadoras a la vez, avisame y lo resolvemos de otra forma
(por ejemplo, generando un archivo de precios ya "horneado" adentro del
HTML, como el catálogo).

---

## 8. Si el catálogo cambia en tu sitio web

Mandame el `script.js` actualizado (como hiciste ahora) y te regenero este
mismo archivo `pedidos.html` con el catálogo al día — no hace falta que
hagas nada técnico de tu lado.
