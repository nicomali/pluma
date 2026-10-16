<script lang="ts">
  import { tick } from 'svelte';
  import Block from './Block.svelte';
  import { ws, dirOf, type Doc } from './lib/workspace.svelte';
  import { outline, lineStarts, lineCount } from './lib/markdown';

  // Cada pestaña tiene su propio Editor montado (oculto si no está activa), así
  // conserva scroll y estado al cambiar de pestaña sin re-renderizar nada.
  let { doc, visible }: { doc: Doc; visible: boolean } = $props();

  const baseDir = $derived(doc.path ? dirOf(doc.path) : '');
  const starts = $derived(lineStarts(doc.blocks));

  /**
   * Número del margen para el bloque i. Relativo (estilo vim): distancia a la línea
   * del cursor; el bloque que contiene el cursor muestra su número absoluto.
   */
  function lineLabel(i: number): { text: number; current: boolean } {
    const start = starts[i];
    const current = visible && ws.cursorLine >= start && ws.cursorLine < start + lineCount(doc.blocks[i].text);
    if (ws.lineNumbers !== 'relative' || current) return { text: current ? ws.cursorLine : start, current };
    return { text: Math.abs(start - ws.cursorLine), current };
  }

  /**
   * Flechas en el borde de un bloque en edición: abrir el vecino en edición. El vecino se
   * calcula antes de que el bloque actual confirme (puede dividirse o borrarse).
   */
  function navigate(fromId: number, dir: 1 | -1): boolean {
    const i = doc.blocks.findIndex((b) => b.id === fromId);
    const target = doc.blocks[i + dir];
    if (!target) return false;
    tick().then(() => ws.requestEdit(doc, target.id, dir < 0 ? 'end' : 'start'));
    return true;
  }

  let scroller: HTMLDivElement;
  let raf = 0;

  /** Scroll-spy: marca como actual el último título que pasó el borde superior. */
  function updateCurrentHeading() {
    const limit = scroller.getBoundingClientRect().top + 48;
    let current = -1;
    for (const h of outline(doc.blocks)) {
      const el = scroller.querySelector(`[data-block-id="${h.blockId}"]`);
      if (!el) continue;
      if (el.getBoundingClientRect().top <= limit) current = h.blockId;
      else break;
    }
    // Arriba de todo, el primer título cuenta como actual.
    ws.currentHeading = current === -1 ? (outline(doc.blocks)[0]?.blockId ?? -1) : current;
  }

  function onScroll() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(updateCurrentHeading);
  }

  // Recalcular al activar la pestaña o cuando cambia el contenido.
  $effect(() => {
    if (visible && doc.blocks) onScroll();
  });
</script>

<div class="editor" class:visible bind:this={scroller} onscroll={visible ? onScroll : undefined}>
  <main class:numbered={ws.lineNumbers !== 'off'}>
    {#each doc.blocks as block, i (block.id)}
      <div class="anchor" data-block-id={block.id}>
        {#if ws.lineNumbers !== 'off'}
          {@const label = lineLabel(i)}
          <span class="ln" class:current={label.current} aria-hidden="true">{label.text}</span>
        {/if}
        <Block
          text={block.text}
          startInEditMode={block.id === doc.focusId}
          request={doc.editRequest?.id === block.id ? doc.editRequest : null}
          {baseDir}
          oncommit={(t) => ws.commitBlock(doc, block.id, t)}
          onnavigate={(dir) => navigate(block.id, dir)}
          oncaretline={(line) => visible && (ws.cursorLine = starts[i] + line)}
        />
      </div>
    {/each}

    <!-- Zona libre al final: un clic agrega un bloque nuevo -->
    <div
      class="tail"
      role="button"
      tabindex="0"
      onclick={() => ws.addBlockAtEnd(doc)}
      onkeydown={(e) => e.key === 'Enter' && ws.addBlockAtEnd(doc)}
    >
      {#if doc.blocks.length === 0}
        <p class="hint">Hacé clic para escribir · Ctrl+O abrir · o soltá un .md acá · Ayuda → Documento de ejemplo</p>
      {/if}
    </div>
  </main>
</div>

<style>
  /* visibility (no display:none) para que cada pestaña conserve su posición de scroll */
  .editor {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    visibility: hidden;
    pointer-events: none;
  }
  .editor.visible { visibility: visible; pointer-events: auto; }

  main {
    /* Crece con el espacio disponible (el contenedor descuenta la barra lateral) */
    max-width: clamp(45rem, 82cqw, 88rem);
    margin: 0 auto;
    padding: 2.5rem 1.5rem 0;
    min-height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }

  main.numbered { padding-left: 3.5rem; }

  .anchor { position: relative; scroll-margin-top: 1.5rem; }

  /* Número de línea en el margen, alineado con la primera línea del bloque */
  .ln {
    position: absolute;
    right: calc(100% + 0.9rem);
    top: 2px;
    font-size: 0.75rem;
    line-height: 1.6rem;
    color: var(--muted);
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
    user-select: none;
    pointer-events: none;
  }
  .ln.current { color: var(--accent); opacity: 1; }
  .tail { flex: 1; min-height: 30vh; cursor: text; outline: none; }
  .hint { color: var(--muted); user-select: none; }
</style>
