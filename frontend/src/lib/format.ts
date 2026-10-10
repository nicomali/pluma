// Acciones de formato del panel de edición, para los dos modos:
// - Markdown: insertan/quitan sintaxis en el textarea alrededor de la selección.
// - Visual: aplican el formato sobre el contenteditable (execCommand + algunos casos a mano).

export type FormatAction =
  | 'p' | 'h1' | 'h2' | 'h3'
  | 'bold' | 'italic' | 'strike' | 'code' | 'link'
  | 'ul' | 'ol' | 'quote';

/** Estado del formato bajo el cursor (para resaltar botones del panel en modo visual). */
export type ActiveFormats = Partial<Record<FormatAction, boolean>>;

// ---------------------------------------------------------------- Markdown (textarea)

const INLINE_MARKS: Partial<Record<FormatAction, string>> = { bold: '**', italic: '*', strike: '~~', code: '`' };

export function applyRaw(ta: HTMLTextAreaElement, action: FormatAction, arg = '') {
  const mark = INLINE_MARKS[action];
  if (mark) toggleWrap(ta, mark);
  else if (action === 'link') insertLink(ta, arg);
  else if (action === 'p') setHeading(ta, 0);
  else if (action === 'h1' || action === 'h2' || action === 'h3') setHeading(ta, Number(action[1]));
  else if (action === 'ul') toggleLinePrefix(ta, /^\s*[-*+]\s+(\[[ xX]\]\s+)?/, () => '- ', true);
  else if (action === 'ol') toggleLinePrefix(ta, /^\s*\d+[.)]\s+/, (i) => `${i + 1}. `, true);
  else if (action === 'quote') toggleLinePrefix(ta, /^>\s?/, () => '> ', false);
  ta.dispatchEvent(new Event('input', { bubbles: true })); // sincroniza bind:value y el autosize
}

function toggleWrap(ta: HTMLTextAreaElement, mark: string) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const sel = v.slice(s, e);
  const n = mark.length;
  // Ya envuelto por fuera (**|sel|**) o por dentro (|**sel**|): se quita.
  if (v.slice(s - n, s) === mark && v.slice(e, e + n) === mark) {
    ta.setRangeText(sel, s - n, e + n, 'select');
  } else if (sel.length >= 2 * n && sel.startsWith(mark) && sel.endsWith(mark)) {
    ta.setRangeText(sel.slice(n, -n), s, e, 'select');
  } else {
    ta.setRangeText(mark + sel + mark, s, e);
    ta.setSelectionRange(s + n, e + n); // queda seleccionado el texto (o el cursor entre las marcas)
  }
}

function insertLink(ta: HTMLTextAreaElement, url: string) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const text = v.slice(s, e) || 'texto';
  ta.setRangeText(`[${text}](${url})`, s, e);
  ta.setSelectionRange(s + 1, s + 1 + text.length); // seleccionar el texto del link
}

/** Rango de líneas completas que toca la selección. */
function selectedLines(ta: HTMLTextAreaElement) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const start = v.lastIndexOf('\n', s - 1) + 1;
  const endIdx = v.indexOf('\n', e);
  const end = endIdx === -1 ? v.length : endIdx;
  return { start, end, lines: v.slice(start, end).split('\n') };
}

function setHeading(ta: HTMLTextAreaElement, level: number) {
  const { start, end, lines } = selectedLines(ta);
  const prefix = level ? '#'.repeat(level) + ' ' : '';
  const already = level > 0 && lines.every((l) => l.startsWith(prefix) && !l.startsWith(prefix + '#'));
  const next = lines.map((l) => {
    const bare = l.replace(/^#{1,6}\s+/, '');
    return already ? bare : prefix + bare; // repetir el mismo nivel lo vuelve párrafo
  });
  ta.setRangeText(next.join('\n'), start, end, 'select');
}

/**
 * Agrega o quita un prefijo de línea. Si todas las líneas ya lo tienen, lo quita.
 * `replaceMarkers`: al convertir a lista, reemplazar el marcador de otro tipo de lista.
 */
function toggleLinePrefix(
  ta: HTMLTextAreaElement, existing: RegExp, prefix: (i: number) => string, replaceMarkers: boolean,
) {
  const { start, end, lines } = selectedLines(ta);
  const content = lines.filter((l) => l.trim());
  const all = content.length > 0 && content.every((l) => existing.test(l));
  let i = 0;
  const next = lines.map((l) => {
    if (!l.trim()) return l;
    if (all) return l.replace(existing, '');
    const bare = replaceMarkers ? l.replace(/^\s*([-*+]|\d+[.)])\s+/, '') : l;
    return prefix(i++) + bare;
  });
  ta.setRangeText(next.join('\n'), start, end, 'select');
}

// ---------------------------------------------------------------- Visual (contenteditable)

export function applyVisual(root: HTMLElement, action: FormatAction, arg = '') {
  const block = currentBlockTag();
  switch (action) {
    case 'bold': exec('bold'); break;
    case 'italic': exec('italic'); break;
    case 'strike': exec('strikeThrough'); break;
    case 'code': toggleInlineCode(root); break;
    case 'link': insertVisualLink(arg); break;
    case 'p': exec('formatBlock', 'P'); break;
    case 'h1': case 'h2': case 'h3':
      exec('formatBlock', block === action ? 'P' : action.toUpperCase()); // repetir → párrafo
      break;
    case 'ul': exec('insertUnorderedList'); break;
    case 'ol': exec('insertOrderedList'); break;
    case 'quote': exec('formatBlock', block === 'blockquote' ? 'P' : 'BLOCKQUOTE'); break;
  }
}

export function activeVisual(root: HTMLElement): ActiveFormats {
  const block = currentBlockTag();
  return {
    bold: document.queryCommandState('bold'),
    italic: document.queryCommandState('italic'),
    strike: document.queryCommandState('strikeThrough'),
    code: !!closestInRoot(root, 'code'),
    link: !!closestInRoot(root, 'a'),
    ul: document.queryCommandState('insertUnorderedList'),
    ol: document.queryCommandState('insertOrderedList'),
    h1: block === 'h1', h2: block === 'h2', h3: block === 'h3',
    quote: !!closestInRoot(root, 'blockquote'),
    p: block === 'p' || block === 'div' || block === '',
  };
}

// execCommand está "deprecado" pero sigue siendo la única API nativa de edición rica
// con deshacer integrado, y en WebView2 (Chromium) funciona de forma estable.
function exec(cmd: string, value?: string) {
  document.execCommand(cmd, false, value);
}

function currentBlockTag(): string {
  return String(document.queryCommandValue('formatBlock') || '').toLowerCase();
}

function closestInRoot(root: HTMLElement, selector: string): Element | null {
  const node = getSelection()?.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  const found = el?.closest(selector);
  return found && root.contains(found) ? found : null;
}

function toggleInlineCode(root: HTMLElement) {
  const sel = getSelection();
  if (!sel?.rangeCount) return;
  const existing = closestInRoot(root, 'code');
  if (existing) {
    existing.replaceWith(document.createTextNode(existing.textContent ?? ''));
    return;
  }
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const code = document.createElement('code');
  code.textContent = range.toString();
  range.deleteContents();
  range.insertNode(code);
  sel.selectAllChildren(code);
}

function insertVisualLink(url: string) {
  const sel = getSelection();
  if (!url || !sel?.rangeCount) return;
  if (sel.getRangeAt(0).collapsed) {
    const a = document.createElement('a');
    a.href = url;
    a.textContent = url;
    exec('insertHTML', a.outerHTML);
  } else {
    exec('createLink', url);
  }
}
