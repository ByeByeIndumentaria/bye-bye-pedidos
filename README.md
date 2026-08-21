# BYE BYE Pedidos

Aplicación web para crear, guardar y exportar pedidos mayoristas de BYE BYE.

## Funciones principales

- Catálogo con fotografías, precios, stock y filtros.
- Cálculo automático de cajas, unidades y totales.
- Validación de cliente, productos, precios y cantidades.
- Vista previa y descarga o impresión en PDF.
- Historial con búsqueda, estados, duplicación y eliminación.
- Exportación e importación de respaldos JSON.
- Importación de precios desde Excel.
- Diseño adaptable para computadora, tablet y teléfono.

## Uso

1. Completá los datos del pedido y del cliente.
2. Buscá las prendas por nombre o código y agregalas al pedido.
3. Ajustá color, precio, cajas y unidades por caja.
4. Guardá el pedido.
5. Abrí **Vista previa** para descargar o imprimir la confirmación.
6. Exportá periódicamente un respaldo desde **Pedidos guardados**.

Los pedidos y las modificaciones de precios quedan guardados en el navegador de cada computadora. Para trasladarlos o conservar una copia se debe usar la función de respaldo.

## Archivos principales

- `index.html`: estructura de la aplicación.
- `styles.css`: diseño general y responsive.
- `stock.css`: presentación de disponibilidad.
- `renderer.js`: catálogo, pedidos, validaciones e historial.
- `data/catalog.json`: catálogo y precios publicados.
- `images/`: fotografías de productos.
- `vendor/xlsx.full.min.js`: lectura local de listas Excel.
