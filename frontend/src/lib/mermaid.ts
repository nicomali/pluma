// Diagramas Mermaid. Este módulo se importa dinámicamente (ver Block.svelte), así que
// la librería solo se carga cuando un documento tiene un bloque ```mermaid.

import mermaid from 'mermaid';

let theme = '';
let counter = 0;
const cache = new Map<string, string>(); // fuente → SVG, para no re-renderizar al salir de edición

function ensureInitialized() {
  const wanted = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'neutral';
  if (wanted === theme) return;
  // securityLevel 'strict': sin HTML ni clics con scripts dentro de los diagramas.
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: wanted, fontFamily: 'inherit' });
  theme = wanted;
  cache.clear();
}

/** Reemplaza cada <pre><code class="language-mermaid"> dentro de `root` por su diagrama SVG. */
export async function renderMermaidIn(root: HTMLElement) {
  ensureInitialized();
  for (const code of root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')) {
    const source = code.textContent ?? '';
    const box = document.createElement('div');
    box.className = 'mermaid-diagram';
    try {
      let svg = cache.get(source);
      if (!svg) {
        await mermaid.parse(source); // valida antes: render() con errores deja basura en el DOM
        svg = (await mermaid.render(`mermaid-${counter++}`, source)).svg;
        cache.set(source, svg);
      }
      box.innerHTML = svg;
    } catch (e) {
      box.classList.add('error');
      box.textContent = `Error en el diagrama Mermaid: ${e instanceof Error ? e.message : e}`;
    }
    code.parentElement?.replaceWith(box);
  }
}
