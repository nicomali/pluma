<script lang="ts">
  import Block from './Block.svelte';
  import { ws, dirOf, type Doc } from './lib/workspace.svelte';
  import { outline } from './lib/markdown';

  // Cada pestaña tiene su propio Editor montado (oculto si no está activa), así
  // conserva scroll y estado al cambiar de pestaña sin re-renderizar nada.
  let { doc, visible }: { doc: Doc; visible: boolean } = $props();

  const baseDir = $derived(doc.path ? dirOf(doc.path) : '');

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
  <main>
    {#each doc.blocks as block (block.id)}
      <div class="anchor" data-block-id={block.id}>
        <Block
          text={block.text}
          startInEditMode={block.id === doc.focusId}
          {baseDir}
          oncommit={(t) => ws.commitBlock(doc, block.id, t)}
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

  .anchor { scroll-margin-top: 1.5rem; }
  .tail { flex: 1; min-height: 30vh; cursor: text; outline: none; }
  .hint { color: var(--muted); user-select: none; }
</style>
