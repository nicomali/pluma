package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App es el struct cuyos métodos públicos Wails expone al frontend.
type App struct {
	ctx        context.Context
	quitting   atomic.Bool // la sesión ya se guardó: el próximo cierre no se intercepta
	settingsMu sync.Mutex

	editModeItems map[string]*menu.MenuItem // radios "Edición Markdown/visual" del menú Ver
}

func NewApp() *App { return &App{} }

// startup lo llama Wails al arrancar. Guardamos el ctx para usar el runtime (diálogos, etc.).
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// GetStartupFiles devuelve los archivos con los que se lanzó la app (doble clic en un .md,
// "Abrir con" o el menú contextual pasan las rutas como argumentos).
func (a *App) GetStartupFiles() []string {
	return filesFromArgs(os.Args[1:])
}

// onSecondInstance: con SingleInstanceLock, abrir otro .md desde el Explorador no lanza
// otra ventana; los argumentos llegan acá y se abren como pestañas en la ventana existente.
func (a *App) onSecondInstance(data options.SecondInstanceData) {
	runtime.WindowUnminimise(a.ctx)
	runtime.WindowShow(a.ctx)
	if files := filesFromArgs(data.Args); len(files) > 0 {
		runtime.EventsEmit(a.ctx, "open-files", files)
	}
}

// filesFromArgs se queda con los argumentos que son archivos existentes (rutas absolutas).
func filesFromArgs(args []string) []string {
	files := []string{}
	for _, arg := range args {
		path, err := filepath.Abs(arg)
		if err != nil {
			continue
		}
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			files = append(files, path)
		}
	}
	return files
}

// ConfirmDiscard pregunta con un diálogo nativo si se cierra un documento sin guardar.
func (a *App) ConfirmDiscard(name string) bool {
	res, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type:    runtime.QuestionDialog,
		Title:   "Cambios sin guardar",
		Message: fmt.Sprintf("\"%s\" tiene cambios sin guardar. ¿Cerrarlo igual?", name),
	})
	return err == nil && res == "Yes"
}

// SetEditModeMenu sincroniza la marca del menú Ver cuando el modo se cambia desde el panel.
func (a *App) SetEditModeMenu(mode string) {
	for m, item := range a.editModeItems {
		item.Checked = m == mode
	}
	runtime.MenuUpdateApplicationMenu(a.ctx)
}

// beforeClose no pregunta por cambios sin guardar: nada se pierde, porque la sesión
// (pestañas y cambios pendientes) se recupera al volver a abrir. Le pide al frontend
// que confirme el bloque en edición y guarde la sesión; el frontend llama a QuitApp.
// Si no responde (por ejemplo, porque se colgó), se sale igual a los pocos segundos.
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	if a.quitting.Load() {
		return false
	}
	runtime.EventsEmit(ctx, "app:before-close")
	time.AfterFunc(3*time.Second, a.QuitApp)
	return true
}

// QuitApp cierra la app sin volver a interceptar el cierre.
func (a *App) QuitApp() {
	if a.quitting.Swap(true) {
		return // ya se está cerrando
	}
	runtime.Quit(a.ctx)
}

// integrateWithWindows registra Pluma en el shell y abre Configuración para
// que el usuario la elija como predeterminada (Windows no permite hacerlo por código).
func (a *App) integrateWithWindows() {
	if err := registerShell(); err != nil {
		a.showMessage(runtime.ErrorDialog, "No se pudo integrar con Windows", err.Error())
		return
	}
	a.showMessage(runtime.InfoDialog, "Integración lista",
		"Pluma ya aparece en \"Abrir con\" y en el menú del botón derecho de los .md "+
			"(en Windows 11, dentro de \"Mostrar más opciones\").\n\n"+
			"Para que sea la app predeterminada, elegila en la ventana de Configuración que se abre ahora.")
	openDefaultAppsSettings()
}

func (a *App) removeWindowsIntegration() {
	if err := unregisterShell(); err != nil {
		a.showMessage(runtime.ErrorDialog, "No se pudo quitar la integración", err.Error())
		return
	}
	a.showMessage(runtime.InfoDialog, "Integración quitada", "Pluma ya no figura en \"Abrir con\" ni en el menú contextual.")
}

func (a *App) showMessage(t runtime.DialogType, title, msg string) {
	_, _ = runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{Type: t, Title: title, Message: msg})
}

// ReadFile devuelve el contenido completo de un archivo como string (UTF-8).
func (a *App) ReadFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("no se pudo leer %q: %w", path, err)
	}
	return string(data), nil
}

// SaveFile escribe de forma atómica: primero a un temporal en la misma carpeta y
// después lo renombra encima del original. Si la app se cae a mitad de la escritura,
// el archivo original queda intacto.
func (a *App) SaveFile(path string, content string) error {
	mode := os.FileMode(0o644)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm() // conservar los permisos del archivo existente
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), ".pluma-*.tmp")
	if err != nil {
		return fmt.Errorf("no se pudo crear el temporal: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no hace nada si el rename salió bien

	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		return fmt.Errorf("error escribiendo: %w", err)
	}
	if err := tmp.Sync(); err != nil { // forzar el flush a disco antes del rename
		tmp.Close()
		return fmt.Errorf("error en fsync: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, mode); err != nil {
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("no se pudo guardar %q: %w", path, err)
	}
	return nil
}

// --- Diálogos nativos. Si el usuario cancela, devuelven vacío sin error. ---

var mdFilters = []runtime.FileFilter{
	{DisplayName: "Markdown (*.md)", Pattern: "*.md;*.markdown;*.txt"},
}

func (a *App) OpenFilesDialog() ([]string, error) {
	return runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Abrir Markdown",
		Filters: mdFilters,
	})
}

func (a *App) SaveFileDialog() (string, error) {
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Guardar como",
		DefaultFilename: "sin-titulo.md",
		Filters:         mdFilters,
	})
}
