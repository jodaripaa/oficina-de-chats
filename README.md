# Oficina de chats

Un jueguito en pixel art para ver tus proyectos con Claude Code: caminas por un edificio, cada **oficina es un proyecto** y cada **escritorio es un hilo**, con su trabajador animado.

## Instalar

Necesitas Windows, [Node.js](https://nodejs.org) y Claude Code (la app de escritorio o la terminal).

1. Clona este repositorio:

   ```bash
   git clone https://github.com/jodaripaa/oficina-de-chats.git
   ```

2. Instala el panel **Oficina** de Claude. En la terminal de Claude Code:

   ```
   /plugin install oficina --marketplace jodaripaa/oficina-de-chats
   ```

   Responde `y` para agregar el marketplace y elige el alcance de usuario. Desde una consola normal también puedes usar:

   ```bash
   claude plugin install oficina --marketplace jodaripaa/oficina-de-chats
   ```

   En la app de escritorio, donde `/plugin` no funciona: pulsa **+** junto a la caja del mensaje, luego **Plugins**, **Add marketplace** con `jodaripaa/oficina-de-chats` y después **Add plugin**.

3. Abre una sesión de Claude **en la carpeta del repositorio**. El panel arranca el juego desde ahí y hace de puente con tus hilos.

## Cómo entrar

- **Desde Claude:** en el panel **🏢 Oficina** pulsa **🎮 Entrar a la oficina (juego)**, o escribe `/oficina`. Se abre en su propia ventana.
- **Sin Claude:** doble clic en `abrir-oficina.bat`. Puedes revisar todo, pero tus órdenes a los hilos esperan hasta que el panel esté abierto en Claude.

## Cómo se juega

- Camina con **WASD** o las **flechas**, o haz **clic** donde quieras ir. **M** abre el directorio para saltar a cualquier oficina.
- Acércate a un escritorio y pulsa **E** (o haz clic en él):
  - **Resumen:** la pregunta pendiente, la barra de avance, el paso en curso y el último resumen.
  - **Bitácora:** cada turno del hilo, con lo que pediste, lo que respondió Claude, el resumen y los archivos que tocó.
  - **Tareas:** la lista actual y las anteriores.
  - **Archivos:** todo lo que editó el hilo.
  - Abajo puedes **darle instrucciones** (botones rápidos o texto), **abrirlo** en Claude o **archivarlo**.
- Qué significa cada trabajador:
  - ⚡ teclea con la pantalla verde: está **trabajando**.
  - 🔔 tiene un globo naranja: **te está esperando**.
  - 💤 duerme: lleva más de una semana sin actividad y está en el archivador.
- En cada oficina:
  - 📋 la **pizarra** resume el avance y lista todos los hilos.
  - ➕ el **buzón** crea un hilo nuevo en la carpeta del proyecto.
  - 📣 el **megáfono** pide un resumen de avance a todos los hilos que no están trabajando.
  - 🗄️ el **archivador** guarda los hilos dormidos.
- En el vestíbulo, la **recepción** (o el botón 🔔 de arriba) te muestra quién te espera y quién está trabajando.

## Responder sin caminar y avisos 🔔

- En la **recepción**, cada hilo que te espera tiene su tarjeta: la pregunta, su último resumen y botones de respuesta (los que propuso el hilo, las opciones de la pregunta o **Sí / No**), además de **✍️ Escribir respuesta** e **Ir a su escritorio**.
- Antes de enviar ves **el texto exacto** y a qué hilo va. Todo mensaje sale con su contexto, por ejemplo `[Oficina] Respuesta a tu pregunta «¿Sigo con el bloque B?»: Sí.`, para que el hilo sepa de dónde viene y a qué responde.
- Si la pregunta habla de **subir, hacer push, publicar, desplegar, borrar o pagar**, la oficina te avisa: el hilo te pedirá confirmarlo directamente en su chat, porque la oficina no sirve para aprobar eso.
- Cuando un hilo **pasa a esperarte**, **completa su lista** o **termina un turno**: suena una campanita, su trabajador salta con la mano arriba, sale un aviso (púlsalo para ir) y el título de la ventana muestra cuántos te esperan, por ejemplo «(3) Oficina de chats». Al abrir la oficina no avisa de lo que ya estaba.
- 🔊 / 🔇 arriba silencia la campanita y las notificaciones (se recuerda). En el pie de la recepción puedes activar las **notificaciones de Windows** (salen cuando la oficina no está al frente) y probar el sonido.

## Tema navideño 🎄

Por ahora la oficina viene vestida de Navidad: eres Santa, cae nieve y hay árbol, guirnaldas, coronas y regalos en los hilos que terminaron su lista. El botón 🏢 de arriba la devuelve a la oficina normal (y 🎄 la vuelve a poner navideña).

## Cómo funciona

- `server.js` (solo usa Node, sin dependencias) lee los hilos guardados en `~/.claude/projects`, arma el mapa y sirve el juego en http://localhost:4317 (solo en tu PC).
- El panel **Oficina** de Claude hace de puente:
  - Escribe en `data/live.json` qué hilos están abiertos en la app.
  - Ejecuta las órdenes que el juego deja en `data/queue/` (enviar mensaje, crear, archivar, abrir).
- Las órdenes llevan un token que solo conoce la página del juego, así que otras webs no pueden mandarlas. Una orden de más de 10 minutos se descarta.
