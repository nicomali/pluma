<script lang="ts">
  import { tick } from 'svelte';
  import type { ActiveFormats, FormatAction } from './lib/format';

  interface Props {
    mode: 'visual' | 'raw';
    /** false si el bloque (código, tabla, HTML…) solo se puede editar como Markdown. */
    canVisual: boolean;
    /** Tipo de bloque cuando no es editable visualmente ("código", "tabla"…). */
    kind: string;
    active: ActiveFormats;
    /** Abre el campo de URL (Ctrl+K lo activa desde el bloque). */
    linkOpen: boolean;
    onaction: (action: FormatAction, arg?: string) => void;
    onmode: (mode: 'visual' | 'raw') => void;
    onlinkclose: () => void;
  }

  let { mode, canVisual, kind, active, linkOpen = $bindable(), onaction, onmode, onlinkclose }: Props = $props();

  let url = $state('https://');
  let urlInput = $state<HTMLInputElement>();

  // Al abrir el campo de link, enfocarlo con la URL seleccionada para reemplazarla de una.
  $effect(() => {
    if (linkOpen) tick().then(() => urlInput?.select());
  });

  function submitLink() {
    const value = url.trim();
    linkOpen = false;
    if (value && value !== 'https://') onaction('link', value);
    url = 'https://';
    onlinkclose();
  }

  function onUrlKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); submitLink(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); linkOpen = false; onlinkclose(); }
  }

  type Btn = { action: FormatAction; title: string; icon: string };

  // Íconos de 16×16 dibujados con trazo fino (currentColor).
  const blockBtns: Btn[] = [
    { action: 'p', title: 'Párrafo', icon: '<path d="M10 3v10M12.5 3v10M12.5 3H7.5a3 3 0 0 0 0 6H10"/>' },
    { action: 'h1', title: 'Título 1', icon: '<text x="8" y="12" text-anchor="middle" font-size="9" font-weight="600" stroke="none" fill="currentColor">H1</text>' },
    { action: 'h2', title: 'Título 2', icon: '<text x="8" y="12" text-anchor="middle" font-size="9" font-weight="600" stroke="none" fill="currentColor">H2</text>' },
    { action: 'h3', title: 'Título 3', icon: '<text x="8" y="12" text-anchor="middle" font-size="9" font-weight="600" stroke="none" fill="currentColor">H3</text>' },
  ];
  const inlineBtns: Btn[] = [
    { action: 'bold', title: 'Negrita (Ctrl+B)', icon: '<path d="M5 3h4a2.5 2.5 0 0 1 0 5H5zM5 8h4.5a2.5 2.5 0 0 1 0 5H5z" stroke-width="1.6"/>' },
    { action: 'italic', title: 'Cursiva (Ctrl+I)', icon: '<path d="M7 3h5M4 13h5M10 3 6 13"/>' },
    { action: 'strike', title: 'Tachado', icon: '<path d="M3 8h10M11 4.5C10.3 3.6 9.3 3 8 3 6.3 3 5 4 5 5.3c0 .9.5 1.6 1.4 2M5 11.5c.7.9 1.8 1.5 3.1 1.5 1.7 0 3-1 3-2.3 0-.5-.2-1-.5-1.3"/>' },
    { action: 'code', title: 'Código', icon: '<path d="M6 4 2 8l4 4M10 4l4 4-4 4"/>' },
    { action: 'link', title: 'Link (Ctrl+K)', icon: '<path d="M7 9a3 3 0 0 0 4.2.2l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9 7a3 3 0 0 0-4.2-.2l-2 2A3 3 0 0 0 7 13l.8-.8"/>' },
  ];
  const listBtns: Btn[] = [
    { action: 'ul', title: 'Lista', icon: '<path d="M6 4h8M6 8h8M6 12h8"/><circle cx="2.8" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="2.8" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="2.8" cy="12" r=".9" fill="currentColor" stroke="none"/>' },
    { action: 'ol', title: 'Lista numerada', icon: '<path d="M7 4h7M7 8h7M7 12h7"/><text x="3.3" y="6" text-anchor="middle" font-size="5" stroke="none" fill="currentColor">1</text><text x="3.3" y="10" text-anchor="middle" font-size="5" stroke="none" fill="currentColor">2</text><text x="3.3" y="14" text-anchor="middle" font-size="5" stroke="none" fill="currentColor">3</text>' },
    { action: 'quote', title: 'Cita', icon: '<path d="M3 3v10M6.5 5h7M6.5 8h7M6.5 11h4.5"/>' },
  ];
  const groups = [blockBtns, inlineBtns, listBtns];

  function press(action: FormatAction) {
    if (action === 'link') linkOpen = !linkOpen;
    else onaction(action);
  }
</script>

<!-- mousedown preventDefault: los botones no le sacan el foco (ni la selección) al bloque -->
<div class="panel" role="toolbar" aria-label="Formato" tabindex="-1" onmousedown={(e) => e.target !== urlInput && e.preventDefault()}>
  <div class="modes" role="radiogroup" aria-label="Modo de edición">
    <button
      class="mode"
      class:on={mode === 'visual'}
      role="radio"
      aria-checked={mode === 'visual'}
      disabled={!canVisual}
      title={canVisual ? 'Edición visual' : `Este ${kind} se edita como Markdown`}
      onclick={() => onmode('visual')}
    >Visual</button>
    <button
      class="mode"
      class:on={mode === 'raw'}
      role="radio"
      aria-checked={mode === 'raw'}
      title="Editar el Markdown"
      onclick={() => onmode('raw')}
    >Markdown</button>
  </div>

  {#if canVisual}
    {#if linkOpen}
      <span class="sep"></span>
      <input
        class="url"
        bind:this={urlInput}
        bind:value={url}
        onkeydown={onUrlKeydown}
        placeholder="https://…"
        aria-label="Dirección del link"
        spellcheck="false"
      />
      <button class="btn text" title="Aplicar (Enter)" onclick={submitLink}>OK</button>
    {:else}
      {#each groups as group}
        <span class="sep"></span>
        {#each group as b (b.action)}
          <button
            class="btn"
            class:on={mode === 'visual' && active[b.action]}
            title={b.title}
            aria-label={b.title}
            onclick={() => press(b.action)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">{@html b.icon}</svg>
          </button>
        {/each}
      {/each}
    {/if}
  {:else}
    <span class="sep"></span>
    <span class="note">{kind[0].toUpperCase() + kind.slice(1)} · se edita como Markdown</span>
  {/if}
</div>

<style>
  .panel {
    position: absolute;
    bottom: calc(100% + 6px);
    left: -6px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 3px;
    border-radius: 8px;
    background: var(--panel);
    border: 1px solid var(--line);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
    font-size: 0.75rem;
    user-select: none;
    animation: appear 0.12s ease-out;
    outline: none;
  }
  @keyframes appear {
    from { opacity: 0; transform: translateY(3px); }
  }

  button { font: inherit; color: var(--fg-soft); background: none; border: 0; cursor: pointer; padding: 0; }
  button:disabled { cursor: default; opacity: 0.4; }

  .modes { display: flex; background: var(--hover); border-radius: 6px; padding: 1px; }
  .mode { padding: 0.15rem 0.55rem; border-radius: 5px; color: var(--muted); }
  .mode.on { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
  .mode:not(.on):not(:disabled):hover { color: var(--fg-soft); }

  .sep { width: 1px; height: 1rem; margin: 0 3px; background: var(--line); }

  .btn { display: grid; place-items: center; width: 1.6rem; height: 1.6rem; border-radius: 5px; }
  .btn:hover { background: var(--hover); color: var(--fg); }
  .btn.on { color: var(--accent); background: var(--hover); }
  .btn svg { width: 0.95rem; height: 0.95rem; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
  .btn.text { width: auto; padding: 0 0.5rem; font-weight: 600; }

  .url {
    width: 16rem;
    font: inherit;
    font-size: 0.8125rem;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 0.2rem 0.45rem;
    outline: none;
  }
  .url:focus { border-color: var(--accent); }

  .note { padding: 0 0.4rem; color: var(--muted); white-space: nowrap; }
</style>
