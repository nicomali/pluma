<script lang="ts">
  import { ws, fileName, parentDir } from './lib/workspace.svelte';
  import { outline } from './lib/markdown';

  const headings = $derived(ws.active ? outline(ws.active.blocks) : []);
  // La indentación es relativa al nivel más alto presente (un doc que arranca en ## no queda corrido).
  const minLevel = $derived(Math.min(6, ...headings.map((h) => h.level)));

  function go(blockId: number) {
    document
      .querySelector(`.editor.visible [data-block-id="${blockId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const isOpen = (path: string) => ws.docs.some((d) => d.path.toLowerCase() === path.toLowerCase());

  // El índice acompaña la lectura: si el título actual queda fuera de vista, se desplaza.
  let nav = $state<HTMLElement>();
  $effect(() => {
    ws.currentHeading;
    nav?.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  });
</script>

<aside class="sidebar" class:open={ws.sidebarOpen} aria-hidden={!ws.sidebarOpen}>
  <div class="inner">
    <div class="brand">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="brand-ink" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stop-color="#2dd4bf" /><stop offset="1" stop-color="#818cf8" />
          </linearGradient>
        </defs>
        <path fill="url(#brand-ink)" d="M20 3c-4.2.4-8.6 3.3-10.4 7.6l2 .3-2.5 1.4c-.4 1.5-.4 3-.1 4.4L4 21.5l.9.9 5.3-5c1.6.3 3.3.1 4.8-.6l-1.3-1.6 2.6.4C19.4 13 20.7 7.6 20 3Z" />
      </svg>
      Pluma
    </div>

    <section class="contents">
      <h2>Contenido</h2>
      {#if headings.length}
        <nav class="scroll" bind:this={nav}>
          {#each headings as h}
            <button
              class="item heading"
              class:current={h.blockId === ws.currentHeading}
              style:padding-left="{(h.level - minLevel) * 0.75 + 0.75}rem"
              title={h.text}
              tabindex={ws.sidebarOpen ? 0 : -1}
              onclick={() => go(h.blockId)}
            >{h.text}</button>
          {/each}
        </nav>
      {:else}
        <p class="empty">Sin títulos</p>
      {/if}
    </section>

    <section class="recents">
      <h2>
        Recientes
        {#if ws.recent.length}
          <button class="clear" tabindex={ws.sidebarOpen ? 0 : -1} onclick={() => ws.clearRecent()}>Limpiar</button>
        {/if}
      </h2>
      <div class="scroll">
        {#each ws.recent as path (path)}
          <button
            class="item recent"
            class:is-open={isOpen(path)}
            title={path}
            tabindex={ws.sidebarOpen ? 0 : -1}
            onclick={() => ws.openPaths([path])}
          >
            <span class="name">{fileName(path)}</span>
            <span class="dir">{parentDir(path)}</span>
          </button>
        {:else}
          <p class="empty">Nada todavía</p>
        {/each}
      </div>
    </section>
  </div>
</aside>

<style>
  .sidebar {
    width: 0;
    flex-shrink: 0;
    overflow: hidden;
    background: var(--panel);
    border-right: 1px solid transparent;
    transition: width 0.18s ease, border-color 0.18s ease;
  }
  .sidebar.open { width: 15rem; border-right-color: var(--line); }

  /*
   * Ancho fijo adentro: al colapsar se recorta en vez de reacomodar el texto.
   * Columna: marca arriba, "Contenido" ocupa el resto y scrollea solo su lista,
   * "Recientes" queda fija abajo.
   */
  .inner {
    width: 15rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    padding: 0.75rem 0.5rem 0;
    font-size: 0.8125rem;
  }

  section { display: flex; flex-direction: column; min-height: 0; }
  .contents { flex: 1; }
  .recents {
    flex-shrink: 0;
    max-height: 45%;
    margin: 0.5rem -0.5rem 0;
    padding: 0.75rem 0.5rem;
    border-top: 1px solid var(--line);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--line) transparent;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.75rem 0.75rem;
    color: var(--fg-soft);
    font-weight: 500;
    letter-spacing: 0.01em;
  }
  .brand svg { width: 1rem; height: 1rem; }

  h2 {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 0 0.25rem;
    padding: 0 0.75rem;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }

  button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }

  .item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.22rem 0.75rem;
    border-radius: 4px;
    color: var(--fg-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.5;
  }
  .item:hover { background: var(--hover); color: var(--fg); }
  .item:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }

  .heading.current { color: var(--fg); box-shadow: inset 2px 0 var(--accent); }

  .recent { display: flex; align-items: baseline; gap: 0.5rem; }
  .recent .name { overflow: hidden; text-overflow: ellipsis; }
  .recent .dir { color: var(--muted); font-size: 0.6875rem; flex-shrink: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; }
  .recent.is-open .name { color: var(--fg); }

  .clear {
    font-size: 0.6875rem;
    font-weight: 400;
    letter-spacing: normal;
    text-transform: none;
    color: var(--muted);
    opacity: 0;
    transition: opacity 0.15s;
  }
  h2:hover .clear, .clear:focus-visible { opacity: 1; }
  .clear:hover { color: var(--fg); }

  .empty { margin: 0; padding: 0.22rem 0.75rem; color: var(--muted); font-style: italic; }
</style>
