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
- En el vestíbulo, la **recepción** te muestra quién te espera y quién está trabajando.

## Tema navideño 🎄

Por ahora la oficina viene vestida de Navidad: eres Santa, cae nieve y hay árbol, guirnaldas, coronas y regalos en los hilos que terminaron su lista. El botón 🏢 de arriba la devuelve a la oficina normal (y 🎄 la vuelve a poner navideña).

## Cómo funciona

- `server.js` (solo usa Node, sin dependencias) lee los hilos guardados en `~/.claude/projects`, arma el mapa y sirve el juego en http://localhost:4317 (solo en tu PC).
- El panel **Oficina** de Claude hace de puente:
  - Escribe en `data/live.json` qué hilos están abiertos en la app.
  - Ejecuta las órdenes que el juego deja en `data/queue/` (enviar mensaje, crear, archivar, abrir).
- Las órdenes llevan un token que solo conoce la página del juego, así que otras webs no pueden mandarlas. Una orden de más de 10 minutos se descarta.
