<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import EditPanel from './EditPanel.svelte';
  import { renderMarkdown } from './lib/render';
  import { htmlToMarkdown } from './lib/htmlToMarkdown';
  import { isVisualEditable, blockKind, detectBullet, detectEmphasis, toggleTask } from './lib/markdown';
  import { applyRaw, applyVisual, activeVisual, type ActiveFormats, type FormatAction } from './lib/format';
  import { ws, type EditRequest } from './lib/workspace.svelte';
  import { BrowserOpenURL } from '../wailsjs/runtime/runtime';

  interface Props {
    /** Markdown crudo del bloque. La fuente de verdad la tiene el padre. */
    text: string;
    /** Si es true, el bloque arranca directamente en modo edición (bloques nuevos). */
    startInEditMode?: boolean;
    /** Carpeta del documento, para resolver imágenes relativas ("" si no está guardado). */
    baseDir?: string;
    /** Pedido de abrir este bloque en edición (flechas desde el vecino, "Ir a línea"). */
    request?: EditRequest | null;
    /** Se llama al terminar de editar con el Markdown resultante. */
    oncommit: (text: string) => void;
    /** Flecha en el borde del bloque: pasar al vecino. Devuelve false si no hay vecino. */
    onnavigate?: (dir: 1 | -1) => boolean;
    /** Línea del cursor dentro del bloque (0 = primera), para los números relativos. */
    oncaretline?: (line: number) => void;
  }

  let {
    text, startInEditMode = false, request = null, baseDir = '', oncommit, onnavigate, oncaretline,
  }: Props = $props();

  type Mode = 'visual' | 'raw';

  let editing = $state<Mode | null>(null);
  let draft = $state(''); // modo Markdown: contenido del textarea
  let active = $state<ActiveFormats>({}); // modo visual: formato bajo el cursor
  let linkOpen = $state(false);

  let wrapper: HTMLDivElement;
  let view = $state<HTMLDivElement>();
  let textarea = $state<HTMLTextAreaElement>()!;
  let visual = $state<HTMLDivElement>()!;

  // Modo visual: Markdown equivalente al HTML con el que se abrió el editor. Si el
  // usuario no cambió nada, se devuelve tal cual: así un bloque que solo miraste no
  // se reformatea (los `_` no pasan a `*`, las listas conservan su marcador, etc.).
  let baseline = '';
  let initialHTML = '';
  let savedRange: Range | null = null; // selección del editor visual (para el panel)
  // true recién cuando el editor está montado, cargado y con foco. Mientras se abre
  // (o se cambia de modo) se ignoran los focusout: al reemplazar la vista por el editor,
  // el navegador saca el foco del elemento que desaparece, y eso NO es "terminé de editar".
  let ready = false;

  // Solo se re-renderiza cuando cambia `text`, no en cada tecla.
  const html = $derived(renderMarkdown(text, baseDir));
  const source = $derived(editing === 'raw' ? draft : text);
  const canVisual = $derived(isVisualEditable(source));
  const kind = $derived(blockKind(source));

  // Diagramas Mermaid: se dibujan después de insertar el HTML. El import dinámico
  // hace que la librería solo se cargue si algún bloque la necesita.
  $effect(() => {
    if (view && html.includes('language-mermaid')) {
      const el = view;
      import('./lib/mermaid').then((m) => m.renderMermaidIn(el));
    }
  });

  // Mientras se edita visualmente, seguir la selección para resaltar el panel
  // y recordarla (al usar el campo de link el foco sale del editor).
  $effect(() => {
    if (editing !== 'visual') return;
    const onSelection = () => {
      const sel = getSelection();
      if (!sel?.rangeCount || !visual.contains(sel.anchorNode)) return;
      savedRange = sel.getRangeAt(0).cloneRange();
      active = activeVisual(visual);
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  });

  onMount(() => {
    if (startInEditMode) startEdit();
  });

  // Pedidos de edición: el bloque se abre (o mueve el cursor) donde se indica.
  $effect(() => {
    const r = request;
    if (!r) return;
    untrack(() => {
      if (typeof r.at === 'number') wrapper.scrollIntoView({ block: 'center' }); // "Ir a línea"
      if (editing === 'raw') placeRawCaret(r.at);
      else if (!editing) startEdit(undefined, r.at);
    });
  });

  // ---------------------------------------------------------------- Entrar / salir

  type At = EditRequest['at'];

  function startEdit(point?: { x: number; y: number }, at: At = 'end') {
    if (editing) return;
    const mode: Mode = ws.editMode === 'visual' && isVisualEditable(text) ? 'visual' : 'raw';
    enter(mode, text, point, at);
  }

  async function enter(mode: Mode, md: string, point?: { x: number; y: number }, at: At = 'end') {
    ready = false;
    // El contenido se carga ANTES de mostrar el editor: así nunca existe un editor
    // "vacío" que, si se confirmara, borraría el bloque.
    if (mode === 'raw') draft = md;
    else baseline = md;
    editing = mode;
    await tick(); // esperar a que el editor exista en el DOM
    if (mode === 'raw') {
      autosize();
      textarea.focus();
      placeRawCaret(at);
    } else {
      visual.innerHTML = renderMarkdown(md, baseDir);
      initialHTML = visual.innerHTML;
      document.execCommand('defaultParagraphSeparator', false, 'p');
      visual.focus();
      placeCaret(point, at === 'start');
      active = activeVisual(visual);
      oncaretline?.(0);
    }
    ready = true;
  }

  /** Cursor del textarea al inicio, al final o al comienzo de la línea n del bloque. */
  function placeRawCaret(at: At) {
    const v = textarea.value;
    let pos = v.length;
    if (at === 'start') pos = 0;
    else if (typeof at === 'number') {
      pos = 0;
      for (let i = 0; i < at && pos !== -1; i++) pos = v.indexOf('\n', pos) + 1 || v.length;
    }
    textarea.setSelectionRange(pos, pos);
    reportRawLine();
  }

  function reportRawLine() {
    oncaretline?.(textarea.value.slice(0, textarea.selectionStart).split('\n').length - 1);
  }

  /** Cursor donde se hizo clic: el editor visual tiene el mismo HTML en el mismo lugar. */
  function placeCaret(point?: { x: number; y: number }, atStart = false) {
    const sel = getSelection()!;
    let range = point ? document.caretRangeFromPoint(point.x, point.y) : null;
    if (!range || !visual.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(visual);
      range.collapse(atStart); // al inicio o al final
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function currentMarkdown(): string {
    if (editing === 'raw') return draft;
    if (visual.innerHTML === initialHTML) return baseline; // sin cambios: Markdown original
    return htmlToMarkdown(visual, { bullet: detectBullet(baseline), em: detectEmphasis(baseline) });
  }

  function finish() {
    if (!editing || !ready) return; // un editor a medio abrir nunca confirma nada
    const md = currentMarkdown();
    editing = null;
    ready = false;
    linkOpen = false;
    oncommit(md); // el padre decide si hubo cambios, si dividir o si borrar
  }

  function cancel() {
    editing = null;
    ready = false;
    linkOpen = false;
    oncommit(text); // sin cambios (un bloque nuevo vacío se elimina)
  }

  /** El foco salió del bloque (no hacia el panel): se confirma la edición. */
  function onFocusOut(e: FocusEvent) {
    if (!ready || wrapper.contains(e.relatedTarget as Node | null)) return;
    finish();
  }

  async function switchMode(mode: Mode) {
    ws.setEditMode(mode); // la preferencia es global
    if (!editing || editing === mode) return;
    const md = currentMarkdown();
    if (mode === 'visual' && !isVisualEditable(md)) return;
    await enter(mode, md);
  }

  // ---------------------------------------------------------------- Formato

  function applyAction(action: FormatAction, arg?: string) {
    refocusEditor();
    if (editing === 'raw') {
      applyRaw(textarea, action, arg);
    } else if (editing === 'visual') {
      applyVisual(visual, action, arg);
      active = activeVisual(visual);
    }
  }

  /** Volver al editor (con la selección que tenía) al cerrar el campo de link. */
  function refocusEditor() {
    if (editing === 'raw') {
      textarea.focus();
    } else if (editing === 'visual') {
      visual.focus();
      if (savedRange) {
        const sel = getSelection()!;
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
    }
  }

  /** Pasar al bloque vecino (confirmando este) si existe. */
  function navigate(dir: 1 | -1) {
    if (onnavigate?.(dir)) finish();
  }

  /**
   * Rectángulo de la línea del cursor. Entre elementos (p. ej. al inicio del bloque,
   * antes de un <h2>) el navegador no da posición: se usa la del nodo vecino.
   */
  function caretRect(range: Range): DOMRect | null {
    const direct = range.getClientRects()[0];
    if (direct) return direct;
    const { startContainer: c, startOffset: o } = range;
    const after = c.nodeType === Node.ELEMENT_NODE ? c.childNodes[o] : null;
    const neighbor = after ?? (c.nodeType === Node.ELEMENT_NODE ? c.childNodes[o - 1] : c);
    if (!neighbor) return null;
    const r = document.createRange();
    r.selectNodeContents(neighbor);
    const rects = r.getClientRects();
    return (after ? rects[0] : rects[rects.length - 1]) ?? null;
  }

  /** Rectángulos de cada línea de texto y de cada imagen del editor visual. */
  function contentLineRects(): DOMRect[] {
    const rects: DOMRect[] = [];
    const walker = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const r = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (!n.textContent?.trim()) continue;
        r.selectNodeContents(n);
        rects.push(...r.getClientRects());
      } else if ((n as Element).tagName === 'IMG') {
        rects.push((n as Element).getBoundingClientRect());
      }
    }
    return rects.filter((x) => x.height > 0);
  }

  /** ¿El cursor del editor visual está en la primera (dir -1) o última (dir 1) línea? */
  function visualCaretOnEdge(dir: 1 | -1): boolean {
    const sel = getSelection();
    if (!sel?.rangeCount || !sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    const rect = caretRect(range);
    if (!rect) {
      // Sin ninguna referencia: solo cuenta como borde si está literalmente en un extremo.
      const len = range.startContainer.childNodes.length || (range.startContainer.textContent ?? '').length;
      return dir < 0 ? range.startOffset === 0 : range.startOffset >= len;
    }
    // Primera y última línea reales: solo texto e imágenes. Las cajas de los elementos
    // (citas, párrafos con margen) son más altas que sus líneas y engañarían la medida.
    const lines = contentLineRects();
    if (!lines.length) return true; // bloque vacío
    const top = Math.min(...lines.map((r) => r.top));
    const bottom = Math.max(...lines.map((r) => r.bottom));
    const tolerance = (parseFloat(getComputedStyle(visual).lineHeight) || 24) * 0.6;
    return dir < 0 ? rect.top - top < tolerance : bottom - rect.bottom < tolerance;
  }

  /**
   * Flechas ↑/↓ en el borde del bloque → bloque vecino, en el mismo modo de edición.
   * Markdown: en la primera/última línea lógica. Si la línea está cortada por el ancho,
   * la primera pulsación deja que el navegador lleve el cursor al extremo y recién ahí salta.
   */
  function onArrow(e: KeyboardEvent, dir: 1 | -1) {
    if (editing === 'visual') {
      if (visualCaretOnEdge(dir)) {
        e.preventDefault();
        navigate(dir);
      }
      return;
    }
    const { selectionStart: pos, selectionEnd: end, value: v } = textarea;
    if (pos !== end) return;
    const onEdgeLine = dir < 0 ? v.lastIndexOf('\n', pos - 1) === -1 : v.indexOf('\n', pos) === -1;
    if (!onEdgeLine) return;
    const edge = () => (dir < 0 ? 0 : textarea.value.length);
    if (pos === edge()) {
      e.preventDefault();
      navigate(dir);
    } else {
      setTimeout(() => editing === 'raw' && textarea.selectionStart === edge() && navigate(dir));
    }
  }

  function onKeydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !mod && !e.shiftKey && !e.altKey) {
      onArrow(e, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && mod) {
      e.preventDefault();
      finish();
    } else if (mod && !e.shiftKey && ['b', 'i', 'k'].includes(e.key.toLowerCase())) {
      // preventDefault también evita que App use Ctrl+B para la barra lateral
      e.preventDefault();
      const key = e.key.toLowerCase();
      if (key === 'k') linkOpen = true;
      else applyAction(key === 'b' ? 'bold' : 'italic');
    } else if (editing === 'visual' && e.key === 'Tab' && getSelection()?.anchorNode?.parentElement?.closest('li')) {
      e.preventDefault(); // Tab / Shift+Tab anidan o desanidan ítems de lista
      document.execCommand(e.shiftKey ? 'outdent' : 'indent');
    }
  }

  /** Pegar como texto plano: el HTML de otras páginas trae estilos y estructura ajenos. */
  function onPaste(e: ClipboardEvent) {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
  }

  /** Ajusta la altura del textarea al contenido. */
  function autosize() {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  // ---------------------------------------------------------------- Vista

  /**
   * Clic en la vista: una casilla de tarea se marca sin entrar a editar; Ctrl+clic
   * en un link lo abre en el navegador; cualquier otro clic edita en ese punto.
   */
  function onViewClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('summary')) return; // dejar que <details> se abra/cierre
    e.preventDefault(); // nunca navegar el WebView ni cambiar la casilla "a mano"

    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      const boxes = [...view!.querySelectorAll('input[type="checkbox"]')];
      oncommit(toggleTask(text, boxes.indexOf(target)));
      return;
    }
    const link = target.closest('a');
    if (link && (e.ctrlKey || e.metaKey)) {
      if (/^(https?:|mailto:)/i.test(link.href)) BrowserOpenURL(link.href);
      return;
    }
    startEdit({ x: e.clientX, y: e.clientY });
  }
</script>

<div class="block" bind:this={wrapper} onfocusout={onFocusOut}>
  {#if editing}
    <EditPanel
      mode={editing}
      {canVisual}
      {kind}
      {active}
      bind:linkOpen
      onaction={applyAction}
      onmode={switchMode}
      onlinkclose={refocusEditor}
    />
  {/if}

  {#if editing === 'raw'}
    <textarea
      bind:this={textarea}
      bind:value={draft}
      oninput={() => { autosize(); reportRawLine(); }}
      onkeydown={onKeydown}
      onkeyup={reportRawLine}
      onclick={reportRawLine}
      rows="1"
      spellcheck="false"
    ></textarea>
  {:else if editing === 'visual'}
    <!-- El contenido se carga a mano (innerHTML) en enter(): Svelte no lo controla -->
    <div
      bind:this={visual}
      class="view visual"
      contenteditable="true"
      role="textbox"
      tabindex="0"
      aria-multiline="true"
      spellcheck="true"
      onkeydown={onKeydown}
      onpaste={onPaste}
    ></div>
  {:else}
    <!-- Un clic edita el bloque; Ctrl+clic sobre un link lo abre en el navegador -->
    <div
      bind:this={view}
      class="view"
      role="button"
      tabindex="0"
      title={html.includes('<a ') ? 'Ctrl+clic en un link para abrirlo' : undefined}
      onclick={onViewClick}
      onkeydown={(e) => e.key === 'Enter' && startEdit()}
    >
      {@html html}
    </div>
  {/if}
</div>

<style>
  .block { position: relative; margin-bottom: 1em; }

  .view,
  textarea {
    padding: 2px 6px;
    margin: 0 -6px;
    border-radius: 4px;
  }

  /* flow-root: contiene imágenes flotantes (align="right") dentro del bloque */
  .view { cursor: text; min-height: 1.6em; outline: none; display: flow-root; }
  .view:not(.visual):hover { background: var(--hover); }
  .view :global(.mermaid-diagram) { display: flex; justify-content: center; margin: 0.5em 0; }
  .view :global(.mermaid-diagram svg) { max-width: 100%; height: auto; }
  .view :global(.mermaid-diagram.error) { color: #d33; font-size: 0.85em; justify-content: flex-start; }
  .view > :global(:first-child) { margin-top: 0; }
  .view > :global(:last-child) { margin-bottom: 0; }

  /* Edición visual: se ve igual que la vista, con un marco apenas visible */
  .visual { box-shadow: 0 0 0 1px var(--line); caret-color: var(--accent); }
  .visual:empty::before { content: 'Escribí algo…'; color: var(--muted); pointer-events: none; }

  textarea {
    display: block;
    width: calc(100% + 12px);
    box-sizing: border-box;
    resize: none;
    overflow: hidden;
    border: none;
    outline: none;
    background: var(--edit-bg);
    color: inherit;
    font: 0.92em/1.6 ui-monospace, 'Cascadia Code', Consolas, monospace;
  }
</style>
