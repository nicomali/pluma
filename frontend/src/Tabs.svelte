<script lang="ts">
  import { ws, fileName } from './lib/workspace.svelte';

  let strip: HTMLDivElement;

  // Mantener visible la pestaña activa cuando hay muchas.
  $effect(() => {
    const id = ws.activeId;
    strip?.querySelector(`[data-tab-id="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
</script>

<div class="tabbar">
  <button
    class="icon"
    class:on={ws.sidebarOpen}
    title="Barra lateral (Ctrl+B)"
    aria-label="Mostrar u ocultar barra lateral"
    onclick={() => ws.toggleSidebar()}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" />
      <path d="M6 2.5v11" stroke="currentColor" />
    </svg>
  </button>

  <div class="tabs" role="tablist" bind:this={strip}>
    {#each ws.docs as doc (doc.id)}
      <div
        class="tab"
        class:active={doc.id === ws.activeId}
        role="tab"
        tabindex="0"
        aria-selected={doc.id === ws.activeId}
        data-tab-id={doc.id}
        title={doc.path || 'Sin título'}
        onclick={() => ws.select(doc.id)}
        onauxclick={(e) => e.button === 1 && ws.close(doc.id)}
        onkeydown={(e) => e.key === 'Enter' && ws.select(doc.id)}
      >
        <span class="title">{fileName(doc.path)}</span>
        <button
          class="close"
          class:dirty={doc.dirty}
          title="Cerrar (Ctrl+W)"
          aria-label="Cerrar pestaña"
          onclick={(e) => { e.stopPropagation(); ws.close(doc.id); }}
        >
          <span class="dot"></span>
          <svg class="x" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" /></svg>
        </button>
      </div>
    {/each}
    <button class="icon new" title="Nueva pestaña (Ctrl+T)" aria-label="Nueva pestaña" onclick={() => ws.newDoc()}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" /></svg>
    </button>
  </div>
</div>

<style>
  .tabbar {
    display: flex;
    align-items: stretch;
    height: 2.25rem;
    flex-shrink: 0;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    font-size: 0.8125rem;
    user-select: none;
  }

  button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }

  .icon {
    display: grid;
    place-items: center;
    width: 2.25rem;
    flex-shrink: 0;
    color: var(--muted);
  }
  .icon:hover, .icon.on { color: var(--fg-soft); }
  .icon svg { width: 1rem; height: 1rem; }

  .tabs {
    display: flex;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 13rem;
    min-width: 6rem;
    padding: 0 0.35rem 0 0.85rem;
    color: var(--muted);
    border-right: 1px solid var(--line);
    cursor: default;
    outline: none;
  }
  .tab:hover { color: var(--fg-soft); }
  .tab.active {
    color: var(--fg);
    background: var(--bg);
    box-shadow: inset 0 -1px var(--bg), inset 0 2px var(--accent); /* tapa el borde inferior y marca arriba */
  }
  .tab:focus-visible { box-shadow: inset 0 0 0 1px var(--accent); }

  .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .close {
    position: relative;
    display: grid;
    place-items: center;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .close:hover { background: var(--hover); }
  .close .x { width: 0.6rem; height: 0.6rem; opacity: 0; }
  .tab:hover .x, .tab.active .x { opacity: 1; }

  /* Con cambios sin guardar se muestra un punto; al pasar el mouse vuelve la × */
  .close .dot { display: none; width: 0.45rem; height: 0.45rem; border-radius: 50%; background: currentColor; }
  .close.dirty .dot { display: block; }
  .close.dirty .x { display: none; }
  .close.dirty:hover .dot { display: none; }
  .close.dirty:hover .x { display: block; opacity: 1; }

  .new { width: 2rem; }
</style>
