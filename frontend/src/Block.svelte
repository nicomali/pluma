<script lang="ts">
  import { onMount, tick } from 'svelte';
  import EditPanel from './EditPanel.svelte';
  import { renderMarkdown } from './lib/render';
  import { htmlToMarkdown } from './lib/htmlToMarkdown';
  import { isVisualEditable, blockKind, detectBullet, detectEmphasis, toggleTask } from './lib/markdown';
  import { applyRaw, applyVisual, activeVisual, type ActiveFormats, type FormatAction } from './lib/format';
  import { ws } from './lib/workspace.svelte';
  import { BrowserOpenURL } from '../wailsjs/runtime/runtime';

  interface Props {
    /** Markdown crudo del bloque. La fuente de verdad la tiene el padre. */
    text: string;
    /** Si es true, el bloque arranca directamente en modo edición (bloques nuevos). */
    startInEditMode?: boolean;
    /** Carpeta del documento, para resolver imágenes relativas ("" si no está guardado). */
    baseDir?: string;
    /** Se llama al terminar de editar con el Markdown resultante. */
    oncommit: (text: string) => void;
  }

  let { text, startInEditMode = false, baseDir = '', oncommit }: Props = $props();

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
  let switching = false; // cambio de modo en curso: ignorar el focusout del editor que se va

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

  // ---------------------------------------------------------------- Entrar / salir

  function startEdit(point?: { x: number; y: number }) {
    if (editing) return;
    const mode: Mode = ws.editMode === 'visual' && isVisualEditable(text) ? 'visual' : 'raw';
    enter(mode, text, point);
  }

  async function enter(mode: Mode, md: string, point?: { x: number; y: number }) {
    editing = mode;
    await tick(); // esperar a que el editor exista en el DOM
    if (mode === 'raw') {
      draft = md;
      await tick();
      autosize();
      textarea.focus();
      textarea.setSelectionRange(md.length, md.length);
    } else {
      baseline = md;
      visual.innerHTML = renderMarkdown(md, baseDir);
      initialHTML = visual.innerHTML;
      document.execCommand('defaultParagraphSeparator', false, 'p');
      visual.focus();
      placeCaret(point);
      active = activeVisual(visual);
    }
  }

  /** Cursor donde se hizo clic: el editor visual tiene el mismo HTML en el mismo lugar. */
  function placeCaret(point?: { x: number; y: number }) {
    const sel = getSelection()!;
    let range = point ? document.caretRangeFromPoint(point.x, point.y) : null;
    if (!range || !visual.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(visual);
      range.collapse(false); // al final
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
    if (!editing) return;
    const md = currentMarkdown();
    editing = null;
    linkOpen = false;
    oncommit(md); // el padre decide si hubo cambios, si dividir o si borrar
  }

  function cancel() {
    editing = null;
    linkOpen = false;
    oncommit(text); // sin cambios (un bloque nuevo vacío se elimina)
  }

  /** El foco salió del bloque (no hacia el panel): se confirma la edición. */
  function onFocusOut(e: FocusEvent) {
    if (switching || wrapper.contains(e.relatedTarget as Node | null)) return;
    finish();
  }

  async function switchMode(mode: Mode) {
    ws.setEditMode(mode); // la preferencia es global
    if (!editing || editing === mode) return;
    const md = currentMarkdown();
    if (mode === 'visual' && !isVisualEditable(md)) return;
    switching = true;
    await enter(mode, md);
    switching = false;
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

  function onKeydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
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
      oninput={autosize}
      onkeydown={onKeydown}
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
