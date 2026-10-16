<script lang="ts">
  import { onMount } from 'svelte';
  import Editor from './Editor.svelte';
  import Sidebar from './Sidebar.svelte';
  import Tabs from './Tabs.svelte';
  import { ws, fileName, flushEditing } from './lib/workspace.svelte';
  import { GetStartupFiles, QuitApp } from '../wailsjs/go/main/App';
  import { WindowSetTitle, EventsOn, OnFileDrop, OnFileDropOff } from '../wailsjs/runtime/runtime';

  // Título de la ventana: "• notas.md — Pluma" cuando la pestaña activa tiene cambios.
  $effect(() => {
    const doc = ws.active;
    WindowSetTitle(`${doc?.dirty ? '• ' : ''}${fileName(doc?.path ?? '')} — Pluma`);
  });

  // Sesión: se guarda un segundo después de cada cambio (pestañas, contenido, pestaña
  // activa). Así, aunque la app se cierre de golpe, se recupera casi todo al reabrir.
  let sessionTimer = 0;
  $effect(() => {
    if (!ws.restored) return; // nunca pisar la sesión anterior antes de restaurarla
    ws.sessionSnapshot(); // lectura que registra las dependencias del efecto
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => ws.saveSession(), 1000);
  });

  // Escala de fuente: toda la UI está en rem, así que alcanza con cambiar la raíz.
  let zoomToast = $state(false);
  let toastTimer = 0;
  let firstZoom = true;
  $effect(() => {
    document.documentElement.style.fontSize = `${ws.zoom * 100}%`;
    if (firstZoom) { firstZoom = false; return; }
    zoomToast = true;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (zoomToast = false), 900);
  });

  onMount(() => {
    // Archivos recibidos por línea de comandos (doble clic, "Abrir con", menú contextual).
    GetStartupFiles().then((files) => ws.init(files ?? []));

    const offs = [
      // Cierre de la ventana (o Archivo → Salir): confirmar el bloque en edición,
      // guardar la sesión y recién ahí salir. Al reabrir se recupera todo.
      EventsOn('app:before-close', async () => {
        await flushEditing();
        clearTimeout(sessionTimer);
        await ws.saveSession();
        QuitApp();
      }),
      // Otra instancia (doble clic en un .md con Pluma ya abierta) manda sus archivos acá.
      EventsOn('open-files', (files: string[]) => ws.openPaths(files)),
      EventsOn('menu:new', () => ws.newDoc()),
      EventsOn('menu:open', () => ws.openDialog()),
      EventsOn('menu:save', () => ws.save()),
      EventsOn('menu:saveas', () => ws.save(true)),
      EventsOn('menu:close', () => ws.close()),
      EventsOn('menu:sidebar', () => ws.toggleSidebar()),
      EventsOn('menu:zoomin', () => ws.zoomStep(1)),
      EventsOn('menu:zoomout', () => ws.zoomStep(-1)),
      EventsOn('menu:zoomreset', () => ws.zoomReset()),
      EventsOn('menu:editmode', (mode: 'raw' | 'visual') => ws.setEditMode(mode)),
    ];

    // Drag & drop: se abren todos los Markdown soltados (o el primer archivo si no hay .md).
    OnFileDrop((_x, _y, paths) => {
      const md = paths.filter((p) => /\.(md|markdown)$/i.test(p));
      ws.openPaths(md.length ? md : paths.slice(0, 1));
    }, true);

    // Ctrl + rueda escala la fuente (el zoom nativo del WebView está desactivado).
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      ws.zoomStep(e.deltaY < 0 ? 1 : -1);
    };
    window.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      offs.forEach((off) => off());
      OnFileDropOff();
      window.removeEventListener('wheel', onWheel);
    };
  });

  function onKeydown(e: KeyboardEvent) {
    // Un bloque en edición ya usó la tecla (Ctrl+B = negrita mientras se edita).
    if (e.defaultPrevented || !(e.ctrlKey || e.metaKey)) return;
    switch (e.key.toLowerCase()) {
      case 's': ws.save(e.shiftKey); break;
      case 'o': ws.openDialog(); break;
      case 't': ws.newDoc(); break;
      case 'w': ws.close(); break;
      case 'b': ws.toggleSidebar(); break;
      case 'tab': ws.cycle(e.shiftKey ? -1 : 1); break;
      case '+': case '=': ws.zoomStep(1); break;
      case '-': case '_': ws.zoomStep(-1); break;
      case '0': ws.zoomReset(); break;
      default: return;
    }
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- --wails-drop-target marca toda la ventana como zona de drop; Wails le agrega
     la clase .wails-drop-target-active mientras se arrastra un archivo encima. -->
<div class="shell" style="--wails-drop-target: drop">
  <Sidebar />

  <div class="workspace">
    <Tabs />
    <div class="editors">
      {#each ws.docs as doc (doc.id)}
        <Editor {doc} visible={doc.id === ws.activeId} />
      {/each}
    </div>
  </div>

  {#if ws.error}
    <button class="toast error" title="Cerrar" onclick={() => (ws.error = '')}>{ws.error}</button>
  {/if}
  <div class="toast zoom" class:show={zoomToast} aria-live="polite">{Math.round(ws.zoom * 100)}%</div>
</div>

<style>
  .shell { display: flex; height: 100vh; }

  .workspace { flex: 1; min-width: 0; display: flex; flex-direction: column; }

  /* container-type: el editor calcula su ancho sobre este espacio (sin la barra lateral) */
  .editors { position: relative; flex: 1; container-type: inline-size; }

  /* Overlay mientras se arrastra un archivo sobre la ventana */
  .shell:global(.wails-drop-target-active)::after {
    content: 'Soltá para abrir';
    position: fixed;
    inset: 0.75rem;
    display: grid;
    place-items: center;
    border: 2px dashed var(--accent);
    border-radius: 10px;
    background: var(--drop-bg);
    color: var(--fg);
    font-size: 1.1rem;
    pointer-events: none;
    z-index: 10;
  }

  .toast {
    position: fixed;
    bottom: 1rem;
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
    font: inherit;
    font-size: 0.8125rem;
    background: var(--panel);
    border: 1px solid var(--line);
    color: var(--fg-soft);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  }
  .toast.error { right: 1rem; max-width: 28rem; text-align: left; color: #d33; cursor: pointer; }
  .toast.zoom {
    left: 50%;
    transform: translateX(-50%);
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }
  .toast.zoom.show { opacity: 1; }
</style>
