package main

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// El documento de ejemplo (con sus imágenes) va embebido en el ejecutable.
//
//go:embed all:examples/ejemplo
var exampleFS embed.FS

const exampleRoot = "examples/ejemplo"
const exampleDoc = "bienvenida.md"

// extractExample copia el ejemplo a %APPDATA%\Pluma\ejemplo (se sobrescribe cada vez,
// así siempre se abre la versión original) y devuelve la ruta del .md.
func extractExample() (string, error) {
	cfg, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dest := filepath.Join(cfg, configDirName, "ejemplo")

	err = fs.WalkDir(exampleFS, exampleRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(exampleRoot, path)
		target := filepath.Join(dest, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := exampleFS.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
	if err != nil {
		return "", err
	}
	return filepath.Join(dest, exampleDoc), nil
}

// openExample abre el documento de ejemplo en una pestaña nueva.
func (a *App) openExample() {
	path, err := extractExample()
	if err != nil {
		a.showMessage(runtime.ErrorDialog, "No se pudo abrir el ejemplo", err.Error())
		return
	}
	runtime.EventsEmit(a.ctx, "open-files", []string{path})
}
