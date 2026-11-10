# Oficina

Panel lateral para la app de escritorio de Claude: una oficina virtual de tus proyectos.

**Portada**
- Un edificio donde cada piso es un proyecto. Las ventanas verdes son hilos trabajando y las naranjas, hilos que te esperan.
- **🔔 Te esperan:** los hilos que terminaron con una pregunta para ti.
- Una tarjeta-dibujo por proyecto, cada una con su color: escritorios animados, barra de avance y contadores. Con ☆ fijas tus oficinas favoritas arriba.

**Dentro de una oficina**
- La oficina grande, con un escritorio rotulado por hilo (pasa el mouse para ver cuál es).
- Una fila por hilo, con un anillo de avance y una línea que dice en qué está.
- **➕ Nuevo hilo:** escribes la tarea y se crea un hilo nuevo en la carpeta del proyecto.
- **📣 Pedir avance a todos:** les pide un resumen corto a los hilos que no están trabajando ahora.

**Dentro de un hilo**
- Los pasos de su lista, el último resumen y la pregunta pendiente.
- **💬 Dile qué hacer:** botones rápidos (Continúa, Sí hazlo, ¿Cómo vas?) o una instrucción escrita.
- **↗ Abrir hilo** y **🗄 Archivar** (pide confirmación).

**En el chat:** pregúntale a Claude "¿cómo van mis proyectos?" y lo responde con la herramienta `resumen` de este panel.

Cuando la app no deja que el panel haga algo directamente (enviar, crear, archivar), se lo pasa a Claude en el chat para que lo haga.

Los datos salen de `~/.claude/projects` (los hilos guardados en tu PC) y de la lista de sesiones de la app. Se actualiza solo cada 15 segundos. `/oficina` abre el panel. Requiere Node en el PATH.
