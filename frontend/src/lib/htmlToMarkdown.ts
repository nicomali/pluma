// HTML (del editor visual) → Markdown. Cubre solo lo que el editor visual permite
// crear: párrafos, títulos, listas (con tareas), citas, negrita, cursiva, tachado,
// código en línea, links, imágenes y saltos de línea. Cualquier otra etiqueta
// (span, font… que agrega contenteditable) se ignora y se conserva su texto.

/** bullet: marcador de lista ('-', '*', '+'); em: delimitador de cursiva ('*' o '_'). */
export type MdOptions = { bullet: string; em: string };

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE',
]);

export function htmlToMarkdown(root: Node, opts: MdOptions): string {
  return blocks(root, opts).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Recorre hijos agrupando nodos inline consecutivos en párrafos. */
function blocks(parent: Node, opts: MdOptions): string[] {
  const out: string[] = [];
  let run: Node[] = [];
  const flush = () => {
    const text = paragraph(inline(run, opts));
    if (text) out.push(text);
    run = [];
  };
  for (const node of parent.childNodes) {
    if (node instanceof HTMLElement && BLOCK_TAGS.has(node.tagName)) {
      flush();
      const md = block(node, opts);
      if (md.trim()) out.push(md);
    } else {
      run.push(node);
    }
  }
  flush();
  return out;
}

function block(el: HTMLElement, opts: MdOptions): string {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) {
    const text = inline([...el.childNodes], opts).replace(/\s*\n\s*/g, ' ').trim();
    return text ? `${'#'.repeat(Number(tag[1]))} ${text}` : '';
  }
  switch (tag) {
    case 'UL':
    case 'OL':
      return list(el, opts);
    case 'BLOCKQUOTE':
      return blocks(el, opts)
        .join('\n\n')
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'PRE': {
      const code = (el.textContent ?? '').replace(/\n$/, '');
      const fence = fenceFor(code, '`', 3);
      return `${fence}\n${code}\n${fence}`;
    }
    case 'HR':
      return '---';
    default: // P, DIV, TABLE (sin soporte: queda su texto)
      return blocks(el, opts).join('\n\n');
  }
}

function list(el: HTMLElement, opts: MdOptions): string {
  const ordered = el.tagName === 'OL';
  let n = Number(el.getAttribute('start')) || 1;
  const items = [...el.children].filter((c) => c.tagName === 'LI');
  // Lista "suelta" (con líneas en blanco entre ítems) si algún ítem tiene párrafos.
  const loose = items.some((li) => [...li.children].some((c) => c.tagName === 'P'));

  return items
    .map((li) => {
      const marker = ordered ? `${n++}.` : opts.bullet;
      const indent = ' '.repeat(marker.length + 1);
      const box = li.querySelector<HTMLInputElement>(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
      const task = box ? (box.checked ? '[x] ' : '[ ] ') : '';
      const body = blocks(li, opts).join(loose ? '\n\n' : '\n');
      const lines = body.split('\n').map((line, i) => (i === 0 || !line ? line : indent + line));
      return `${marker} ${task}${lines.join('\n')}`;
    })
    .join(loose ? '\n\n' : '\n');
}

function inline(nodes: Node[], opts: MdOptions): string {
  return nodes.map((n) => inlineNode(n, opts)).join('');
}

function inlineNode(node: Node, opts: MdOptions): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? '');
  if (!(node instanceof HTMLElement)) return '';
  const inner = () => inline([...node.childNodes], opts);

  switch (node.tagName) {
    case 'STRONG':
    case 'B':
      return wrap(inner(), '**');
    case 'EM':
    case 'I':
      return wrap(inner(), opts.em);
    case 'DEL':
    case 'S':
    case 'STRIKE':
      return wrap(inner(), '~~');
    case 'CODE': {
      const code = node.textContent ?? '';
      const fence = fenceFor(code, '`', 1);
      const pad = code.startsWith('`') || code.endsWith('`') ? ' ' : '';
      return code ? `${fence}${pad}${code}${pad}${fence}` : '';
    }
    case 'A': {
      const href = node.getAttribute('href') ?? '';
      const text = inner();
      if (!href) return text;
      if (node.textContent === href && /^https?:\/\//i.test(href)) return href; // autolink
      const title = node.getAttribute('title');
      return `[${text}](${escapeUrl(href)}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    }
    case 'IMG': {
      // data-md-src guarda la ruta original (render.ts reescribe src para mostrar imágenes locales)
      const src = node.getAttribute('data-md-src') ?? node.getAttribute('src') ?? '';
      return `![${escapeText(node.getAttribute('alt') ?? '')}](${escapeUrl(src)})`;
    }
    case 'BR':
      return '\\\n'; // salto de línea forzado (CommonMark)
    case 'INPUT':
      return ''; // las casillas de tareas las resuelve list()
    default:
      return inner();
  }
}

/** Envuelve con un delimitador dejando afuera los espacios de los bordes (`** x**` no es válido). */
function wrap(s: string, delim: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
  return m[2] ? `${m[1]}${delim}${m[2]}${delim}${m[3]}` : s;
}

/** Escapa lo que en el texto plano se interpretaría como Markdown. */
function escapeText(s: string): string {
  return s
    .replace(/ /g, ' ')
    .replace(/[\\`[\]]/g, '\\$&')
    // Un "*" suelto entre espacios (2 * 3) no es énfasis: no hace falta escaparlo.
    .replace(/\*/g, (m, i: number, str: string) => (/\s/.test(str[i - 1] ?? ' ') && /\s/.test(str[i + 1] ?? ' ') ? m : '\\*'))
    .replace(/~~/g, '\\~\\~')
    .replace(/<(?=[A-Za-z/!?])/g, '\\<')
    // "_" dentro de una palabra (snake_case) no hace falta escaparlo en GFM
    .replace(/(^|[^\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, (m) => m.replace('_', '\\_'));
}

/** Escapa inicios de línea que convertirían un párrafo en título, lista, cita, etc. */
function paragraph(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s*)(#{1,6}(?=\s|$)|>|[-+](?=\s)|-{3,}\s*$|=+\s*$|`{3,}|~{3,})/, '$1\\$2')
        .replace(/^(\s*\d+)([.)])(?=\s)/, '$1\\$2'),
    )
    .join('\n');
}

function escapeUrl(url: string): string {
  return url.replace(/[ ()]/g, (c) => (c === ' ' ? '%20' : `\\${c}`));
}

/** Delimitador de código más largo que cualquier secuencia del mismo carácter dentro del texto. */
function fenceFor(text: string, ch: string, min: number): string {
  const longest = Math.max(0, ...(text.match(new RegExp(`\\${ch}+`, 'g')) ?? []).map((r) => r.length));
  return ch.repeat(Math.max(min, longest + 1));
}
