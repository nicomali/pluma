// Markdown → HTML seguro, con soporte para imágenes locales.

import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Carpeta del documento que se está renderizando. sanitize() es sincrónico,
// así que el hook de abajo siempre ve el valor de la llamada en curso.
let currentBaseDir = '';

/**
 * El WebView no puede leer archivos del disco: las imágenes con ruta local
 * (relativa al .md, absoluta o file://) se reescriben a /__local, que sirve Go.
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'IMG') {
    const src = node.getAttribute('src');
    if (src) {
      node.setAttribute('data-md-src', src); // ruta original: el editor visual la usa al volver a Markdown
      node.setAttribute('src', resolveImage(src, currentBaseDir));
    }
  }
  // Casillas de tareas clickeables: Block.svelte intercepta el clic y actualiza el Markdown.
  if (node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox') node.removeAttribute('disabled');
});

function resolveImage(src: string, baseDir: string): string {
  if (/^(https?:|data:|blob:)/i.test(src)) return src;

  let path: string;
  if (/^file:/i.test(src)) path = decodeURI(src.replace(/^file:\/*/i, ''));
  else if (/^[a-z]:[\\/]/i.test(src) || src.startsWith('\\\\')) path = src;
  else if (baseDir) path = `${baseDir}/${decodeURI(src)}`; // Go normaliza ./ y ../
  else return src; // documento sin guardar: no hay carpeta contra la cual resolver

  return `/__local?path=${encodeURIComponent(path)}`;
}

/**
 * DOMPurify evita que un .md ajeno ejecute scripts en el WebView (que tiene acceso
 * a las funciones de Go). FORCE_BODY conserva un <style> al inicio de un bloque.
 */
export function renderMarkdown(text: string, baseDir: string): string {
  currentBaseDir = baseDir;
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html, { FORCE_BODY: true });
}
