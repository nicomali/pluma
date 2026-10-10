// Estado global de la app (documentos abiertos, pestaña activa, recientes y preferencias)
// y las acciones sobre él. Vive en un módulo para que pestañas, barra lateral y editor
// compartan la misma instancia sin pasarse props de un lado a otro.

import { tick } from 'svelte';
import { toBlocks, serialize, newBlockId, BLANK_GAP, type BlockData } from './markdown';
import {
  ReadFile, SaveFile, OpenFilesDialog, SaveFileDialog, ConfirmDiscard, LoadSettings, SaveSettings, SetEditModeMenu,
} from '../../wailsjs/go/main/App';
import { main } from '../../wailsjs/go/models';

/** Cómo se edita un bloque: el Markdown crudo o visualmente (con formato aplicado). */
export type EditMode = 'raw' | 'visual';

export type Doc = {
  id: number;
  path: string; // "" = sin guardar todavía
  blocks: BlockData[];
  dirty: boolean;
  focusId: number; // bloque que debe montarse ya en modo edición (bloques nuevos)
};

const MAX_RECENT = 10;
const ZOOM_STEPS = [0.75, 0.85, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];

let nextDocId = 0;

export const fileName = (path: string) => (path ? path.split(/[\\/]/).pop()! : 'Sin título');

/** Carpeta del archivo (ruta completa), para resolver imágenes relativas. */
export const dirOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '');

/** Carpeta contenedora (solo el nombre), para mostrar junto al archivo. */
export const parentDir = (path: string) => path.split(/[\\/]/).slice(-2, -1)[0] ?? '';

// En Windows las rutas no distinguen mayúsculas.
const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const isPristine = (d: Doc) => !d.path && !d.dirty && d.blocks.length === 0;

/** Si hay un bloque en edición, lo saca de foco para que haga commit antes de seguir. */
export async function flushEditing() {
  (document.activeElement as HTMLElement | null)?.blur();
  await tick();
}

class Workspace {
  docs = $state<Doc[]>([]);
  activeId = $state(-1);
  recent = $state<string[]>([]);
  zoom = $state(1);
  sidebarOpen = $state(true);
  editMode = $state<EditMode>('raw');
  error = $state('');
  /** blockId del título visible en el editor activo (scroll-spy para la barra lateral). */
  currentHeading = $state(-1);

  active = $derived(this.docs.find((d) => d.id === this.activeId));
  dirtyCount = $derived(this.docs.filter((d) => d.dirty).length);

  async init(startupFiles: string[]) {
    const s = await LoadSettings();
    this.recent = s.recent ?? [];
    this.zoom = s.zoom || 1;
    this.sidebarOpen = s.sidebarOpen;
    this.editMode = s.editMode === 'visual' ? 'visual' : 'raw';
    if (startupFiles.length) await this.openPaths(startupFiles);
    if (this.docs.length === 0) this.newDoc();
  }

  private persist() {
    SaveSettings(
      main.Settings.createFrom({
        recent: [...this.recent],
        zoom: this.zoom,
        sidebarOpen: this.sidebarOpen,
        editMode: this.editMode,
      }),
    ).catch(() => {}); // perder una preferencia no justifica interrumpir al usuario
  }

  // --- Documentos y pestañas ---

  newDoc() {
    const doc: Doc = { id: nextDocId++, path: '', blocks: [], dirty: false, focusId: -1 };
    this.docs.push(doc);
    this.activeId = doc.id;
  }

  select(id: number) {
    this.activeId = id;
  }

  cycle(dir: 1 | -1) {
    const n = this.docs.length;
    if (n < 2) return;
    const i = this.docs.findIndex((d) => d.id === this.activeId);
    this.activeId = this.docs[(i + dir + n) % n].id;
  }

  /** Abre rutas como pestañas. Si ya estaban abiertas, las activa; si la pestaña activa está vacía, la reutiliza. */
  async openPaths(paths: string[]) {
    for (const path of paths) {
      const existing = this.docs.find((d) => samePath(d.path, path));
      if (existing) {
        this.activeId = existing.id;
        continue;
      }
      try {
        const blocks = toBlocks(await ReadFile(path));
        const target = this.active && isPristine(this.active) ? this.active : null;
        if (target) {
          target.path = path;
          target.blocks = blocks;
        } else {
          const doc: Doc = { id: nextDocId++, path, blocks, dirty: false, focusId: -1 };
          this.docs.push(doc);
          this.activeId = doc.id;
        }
        this.addRecent(path);
        this.error = '';
      } catch (e) {
        this.error = String(e);
        this.recent = this.recent.filter((p) => !samePath(p, path)); // ya no existe o no se puede leer
        this.persist();
      }
    }
  }

  async openDialog() {
    try {
      const paths = await OpenFilesDialog();
      if (paths?.length) await this.openPaths(paths);
    } catch (e) {
      this.error = String(e);
    }
  }

  async save(saveAs = false) {
    await flushEditing();
    const doc = this.active;
    if (!doc) return;
    try {
      if (saveAs || !doc.path) {
        const path = await SaveFileDialog();
        if (!path) return;
        doc.path = path;
        this.addRecent(path);
      }
      await SaveFile(doc.path, serialize(doc.blocks));
      doc.dirty = false;
      this.error = '';
    } catch (e) {
      this.error = String(e);
    }
  }

  async close(id = this.activeId) {
    await flushEditing();
    const i = this.docs.findIndex((d) => d.id === id);
    if (i === -1) return;
    const doc = this.docs[i];
    if (doc.dirty && !(await ConfirmDiscard(fileName(doc.path)))) return;

    this.docs.splice(i, 1);
    if (this.activeId === id) {
      const next = this.docs[Math.min(i, this.docs.length - 1)];
      this.activeId = next ? next.id : -1;
    }
    if (this.docs.length === 0) this.newDoc(); // siempre queda al menos una pestaña
  }

  // --- Bloques ---

  /**
   * Se llama cuando un bloque pierde el foco. Si el texto nuevo tiene "\n\n",
   * se divide en varios bloques; si quedó vacío, el bloque se elimina.
   */
  commitBlock(doc: Doc, blockId: number, newText: string) {
    const index = doc.blocks.findIndex((b) => b.id === blockId);
    if (index === -1) return;
    const old = doc.blocks[index];
    if (newText === old.text && newText.trim() !== '') return; // sin cambios

    const parts = toBlocks(newText);
    if (parts.length > 0) {
      parts[0].id = old.id; // mismo id → Svelte reutiliza el componente
      // El último fragmento hereda la separación original con el bloque siguiente, con al
      // menos una línea en blanco: si el bloque cambió de tipo, un solo salto podría fusionarlo.
      parts[parts.length - 1].gap = old.gap.includes(BLANK_GAP) ? old.gap : BLANK_GAP;
    }
    doc.blocks.splice(index, 1, ...parts);
    if (newText !== old.text) doc.dirty = true;
  }

  addBlockAtEnd(doc: Doc) {
    const id = newBlockId();
    const last = doc.blocks[doc.blocks.length - 1];
    if (last && !last.gap.includes(BLANK_GAP)) last.gap = BLANK_GAP; // que no se fusione con el anterior
    doc.blocks.push({ id, text: '', gap: BLANK_GAP });
    doc.focusId = id;
  }

  // --- Recientes ---

  private addRecent(path: string) {
    this.recent = [path, ...this.recent.filter((p) => !samePath(p, path))].slice(0, MAX_RECENT);
    this.persist();
  }

  clearRecent() {
    this.recent = [];
    this.persist();
  }

  // --- Vista ---

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    this.persist();
  }

  /** Cambia el modo de edición (desde el panel o el menú) y sincroniza la marca del menú Ver. */
  setEditMode(mode: EditMode) {
    if (mode === this.editMode) return;
    this.editMode = mode;
    SetEditModeMenu(mode);
    this.persist();
  }

  /** Sube o baja un escalón de escala de fuente (75% … 200%). */
  zoomStep(dir: 1 | -1) {
    const i = ZOOM_STEPS.findIndex((z) => z >= this.zoom - 0.001);
    const current = i === -1 ? ZOOM_STEPS.length - 1 : i;
    const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, current + dir))];
    if (next !== this.zoom) {
      this.zoom = next;
      this.persist();
    }
  }

  zoomReset() {
    this.zoom = 1;
    this.persist();
  }
}

export const ws = new Workspace();
