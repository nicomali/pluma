<script lang="ts">
  import { onMount } from 'svelte';
  import Editor from './Editor.svelte';
  import Sidebar from './Sidebar.svelte';
  import Tabs from './Tabs.svelte';
  import { tick } from 'svelte';
  import { ws, fileName, flushEditing, type LineNumbers } from './lib/workspace.svelte';
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

  // Aviso breve abajo al centro (escala de fuente, modo de números de línea).
  let toast = $state('');
  let toastTimer = 0;
  function showToast(text: string) {
    toast = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 900);
  }

  // Escala de fuente: toda la UI está en rem, así que alcanza con cambiar la raíz.
  let firstZoom = true;
  $effect(() => {
    document.documentElement.style.fontSize = `${ws.zoom * 100}%`;
    if (firstZoom) { firstZoom = false; return; }
    showToast(`${Math.round(ws.zoom * 100)}%`);
  });

  const LINE_NUMBER_LABELS: Record<LineNumbers, string> = {
    off: 'Sin números de línea',
    absolute: 'Números absolutos',
    relative: 'Números relativos',
  };

  function setLineNumbers(mode: LineNumbers) {
    ws.setLineNumbers(mode);
    showToast(LINE_NUMBER_LABELS[mode]);
  }

  // "Ir a línea" (Ctrl+G): 42 absoluta, +5 / -3 relativas a la línea del cursor.
  let gotoOpen = $state(false);
  let gotoValue = $state('');
  let gotoInput = $state<HTMLInputElement>();

  async function openGoto() {
    gotoValue = '';
    gotoOpen = true;
    await tick();
    gotoInput?.focus();
  }

  function onGotoKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (ws.goToLine(gotoValue)) gotoOpen = false;
      else showToast('Escribí un número: 42, +5 o -3');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      gotoOpen = false;
    }
  }

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
      EventsOn('menu:linenumbers', (mode: LineNumbers) => setLineNumbers(mode)),
      EventsOn('menu:gotoline', openGoto),
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
      case 'l': showToast(LINE_NUMBER_LABELS[ws.cycleLineNumbers()]); break;
      case 'g': openGoto(); break;
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
  <div class="toast info" class:show={!!toast} aria-live="polite">{toast}</div>

  {#if gotoOpen}
    <div class="goto">
      <input
        bind:this={gotoInput}
        bind:value={gotoValue}
        onkeydown={onGotoKeydown}
        onblur={() => (gotoOpen = false)}
        placeholder="Ir a línea: 42 · +5 · -3"
        aria-label="Ir a línea"
        inputmode="numeric"
        spellcheck="false"
      />
      <span class="hint">actual: {ws.cursorLine}</span>
    </div>
  {/if}
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
  .goto {
    position: fixed;
    top: 2.75rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem 0.6rem;
    border-radius: 8px;
    background: var(--panel);
    border: 1px solid var(--line);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  }
  .goto input {
    width: 14rem;
    font: inherit;
    font-size: 0.875rem;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: 5px;
    padding: 0.25rem 0.5rem;
    outline: none;
  }
  .goto .hint { font-size: 0.75rem; color: var(--muted); font-variant-numeric: tabular-nums; }

  .toast.info {
    left: 50%;
    transform: translateX(-50%);
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }
  .toast.info.show { opacity: 1; }
</style>
