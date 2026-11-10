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

## Voces premium (ElevenLabs) 🎙️ — opcional

Viene **apagado**. Se enciende en la ayuda (**?**) con **🎙️ Voces premium (ElevenLabs)** y el juego lo recuerda en ese navegador. Encendido, aparecen:

- **🔊 Voz premium** en la ficha de cada escritorio: el empleado te cuenta su pregunta pendiente, en qué anda o su último resumen.
- **🔊 Que me lo diga** en la recepción: la recepcionista te dice cuántos trabajan y quién te espera.
- **Probar** en la ayuda: Santa en Navidad y la recepcionista el resto del año.

**Las voces.** Cada empleado recibe una voz en español la primera vez que habla y se queda con ella (se guarda en `data/voces.json`). Santa y la recepcionista tienen voz propia. El catálogo está en `voces-premium.js`.

**Lo que cuesta.** Cada frase nueva la genera ElevenLabs con tu cuenta: con el modelo rápido (`eleven_flash_v2_5`, el predeterminado) una frase de 40 letras gasta unos 20 créditos, y una frase tiene como máximo 400 letras. Las frases ya dichas con la misma voz se guardan en `data/audio/` y **no se vuelven a pagar**. Hay un tope de 20 frases nuevas cada 10 minutos. Para usar el modelo de más calidad (gasta el doble), arranca el servidor con `OFICINA_VOZ_MODELO=eleven_v4`.

**Lo que necesita.**

1. El conector de ElevenLabs conectado en Claude (Ajustes → Conectores).
2. El panel **Oficina** abierto en Claude: es él quien le pide la voz a ElevenLabs.
3. Permiso para que el panel use dos herramientas del conector: `creative_generate_speech` y `creative_get_flow_run_status`. El panel no puede mostrarte la ventana de permiso, así que la primera vez el juego te avisa con sus nombres completos (`mcp__<id del conector>__…`). Agrégalos a `permissions.allow` en `~/.claude/settings.json`:

   ```json
   { "permissions": { "allow": ["mcp__<id del conector>__creative_generate_speech", "mcp__<id del conector>__creative_get_flow_run_status"] } }
   ```

**Transcribir (🎙️ premium).** La plomería está lista (el juego graba hasta un minuto, lo sube a `data/uploads/` y deja la orden `transcribe`), pero el botón está oculto: el conector de ElevenLabs solo transcribe audio que le llega por un enlace https público o que eliges a mano en el chat, y una grabación del PC no le llega sola. Cuando haya cómo, se enciende con `TRANSCRIBIR_LISTO` en `public/voz-elevenlabs.js`; el texto solo llena el cuadro de instrucciones y nunca se envía solo.

**Idea para después.** Con `creative_design_voice` se puede diseñar una voz propia por personaje (un Santa latino, risueño y de voz grave) y guardarla en tu biblioteca de ElevenLabs; gasta créditos, así que por ahora no se usa.

## Cómo funciona

- `server.js` (solo usa Node, sin dependencias) lee los hilos guardados en `~/.claude/projects`, arma el mapa y sirve el juego en http://localhost:4317 (solo en tu PC).
- El panel **Oficina** de Claude hace de puente:
  - Escribe en `data/live.json` qué hilos están abiertos en la app.
  - Ejecuta las órdenes que el juego deja en `data/queue/` (enviar mensaje, crear, archivar, abrir y, con las voces premium, `speak` y `transcribe`).
  - Para `speak` llama a ElevenLabs, espera la voz y la baja a `data/audio/` con `plugin/scripts/bajar-audio.cjs` (solo enlaces https de ElevenLabs). El servidor la sirve en `/api/audio?id=`.
- Las órdenes llevan un token que solo conoce la página del juego, así que otras webs no pueden mandarlas. Una orden de más de 10 minutos se descarta.
