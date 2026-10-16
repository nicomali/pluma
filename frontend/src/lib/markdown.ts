// Utilidades puras sobre el Markdown: partir en bloques, serializar y extraer títulos.

import { marked } from 'marked';

export type BlockData = {
  id: number;
  text: string; // Markdown del bloque, sin saltos de línea finales
  gap: string; // saltos de línea que lo separaban del bloque siguiente (round-trip exacto)
};
export type Heading = { blockId: number; level: number; text: string };

let nextBlockId = 0;
export const newBlockId = () => nextBlockId++;

/** Separador por defecto entre bloques nuevos o editados: una línea en blanco. */
export const BLANK_GAP = '\n\n';

/**
 * Divide el Markdown en bloques usando el lexer de marked: cada elemento de primer
 * nivel (párrafo, título, lista, bloque de código, tabla, HTML…) es un bloque, así
 * que un ``` con líneas vacías adentro no se parte. Normaliza CRLF → LF.
 */
export function toBlocks(src: string): BlockData[] {
  const text = src.replace(/\r\n?/g, '\n');
  const tokens = marked.lexer(text);

  // El lexer debería cubrir el texto completo. Si no (p. ej. definiciones de links
  // que marked consume aparte), caemos al corte simple por líneas en blanco para no perder nada.
  if (tokens.map((t) => t.raw).join('') !== text) return splitByBlankLines(text);

  const blocks: BlockData[] = [];
  for (const token of tokens) {
    if (token.type === 'space') {
      if (blocks.length) blocks[blocks.length - 1].gap += token.raw;
      continue;
    }
    const trailing = /\n*$/.exec(token.raw)![0];
    blocks.push({ id: newBlockId(), text: token.raw.slice(0, token.raw.length - trailing.length), gap: trailing });
  }
  return blocks.filter((b) => b.text.trim() !== '');
}

function splitByBlankLines(text: string): BlockData[] {
  return text
    .split(/\n\s*\n/)
    .filter((s) => s.trim() !== '')
    .map((t) => ({ id: newBlockId(), text: t.replace(/\n+$/, ''), gap: BLANK_GAP }));
}

/** Reconstruye el archivo respetando los separadores originales. */
export function serialize(blocks: BlockData[]): string {
  const out = blocks
    .map((b, i) => b.text + (i < blocks.length - 1 ? b.gap || BLANK_GAP : ''))
    .join('');
  return out + '\n';
}

/** Extrae los títulos ATX (`# ...`) de los bloques, ignorando los bloques de código. */
export function outline(blocks: BlockData[]): Heading[] {
  const headings: Heading[] = [];
  for (const block of blocks) {
    if (/^\s*(```|~~~)/.test(block.text)) continue;
    for (const line of block.text.split('\n')) {
      const m = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
      if (m) headings.push({ blockId: block.id, level: m[1].length, text: plainText(m[2]) });
    }
  }
  return headings;
}

/** Quita el formato inline más común para mostrar un título como texto plano. */
function plainText(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links e imágenes → su texto
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`~]/g, '')
    .trim();
}

// ---------------------------------------------------------------- Edición visual

const VISUAL_TYPES = new Set(['paragraph', 'heading', 'list', 'blockquote']);
const RAW_ONLY = new Set(['html', 'code', 'table', 'hr', 'def']);

type AnyToken = { type: string; tokens?: AnyToken[]; items?: AnyToken[] };

function hasRawOnly(t: AnyToken): boolean {
  if (RAW_ONLY.has(t.type)) return true;
  return [...(t.tokens ?? []), ...(t.items ?? [])].some(hasRawOnly);
}

/**
 * ¿El bloque se puede editar visualmente sin perder información? Solo párrafos,
 * títulos, listas y citas sin HTML ni código adentro. El resto (código, tablas,
 * HTML, Mermaid…) se edita siempre como Markdown.
 */
export function isVisualEditable(text: string): boolean {
  const tokens = marked.lexer(text).filter((t) => t.type !== 'space') as AnyToken[];
  return tokens.every((t) => VISUAL_TYPES.has(t.type) && !hasRawOnly(t));
}

/** Nombre corto del tipo de bloque, para avisar en el panel por qué se edita como Markdown. */
export function blockKind(text: string): string {
  const first = marked.lexer(text).find((t) => t.type !== 'space') as AnyToken | undefined;
  if (!first) return 'bloque';
  if (first.type === 'code') return /^\s*(```|~~~)\s*mermaid/.test(text) ? 'diagrama' : 'código';
  if (first.type === 'table') return 'tabla';
  if (first.type === 'html' || hasRawOnly(first)) return 'HTML';
  if (first.type === 'hr') return 'separador';
  return 'bloque';
}

/** Marcador de viñeta que usa el bloque ("-" por defecto), para respetarlo al convertir. */
export function detectBullet(text: string): string {
  return /^\s*([-*+])\s/m.exec(text)?.[1] ?? '-';
}

/** Delimitador de cursiva que usa el bloque: "_" si lo usa para énfasis, si no "*". */
export function detectEmphasis(text: string): string {
  return /(^|[^\p{L}\p{N}_\\])_[^_\s]/u.test(text) ? '_' : '*';
}

/** Alterna la casilla de la tarea número `index` (0 = la primera del bloque). */
export function toggleTask(text: string, index: number): string {
  let i = -1;
  return text.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/gm, (match, pre: string, mark: string) =>
    ++i === index ? `${pre}[${mark === ' ' ? 'x' : ' '}]` : match,
  );
}

/**
 * Línea (1 = primera) en la que empieza cada bloque dentro del archivo guardado.
 * Cuenta las líneas del texto y los saltos del separador, igual que serialize().
 */
export function lineStarts(blocks: BlockData[]): number[] {
  const starts: number[] = [];
  let line = 1;
  for (const b of blocks) {
    starts.push(line);
    line += b.text.split('\n').length - 1 + Math.max(1, (b.gap || BLANK_GAP).length);
  }
  return starts;
}

/** Cantidad de líneas que ocupa el texto de un bloque. */
export const lineCount = (text: string) => text.split('\n').length;
