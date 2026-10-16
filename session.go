package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// La sesión (pestañas abiertas y cambios sin guardar) la arma y la interpreta el
// frontend; Go solo la guarda como texto en %APPDATA%\Pluma\session.json.

func sessionPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "Pluma", "session.json"), nil
}

// LoadSession devuelve la última sesión guardada, o "" si no hay.
func (a *App) LoadSession() (string, error) {
	path, err := sessionPath()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	return string(data), err
}

// SaveSession guarda la sesión de forma atómica (un cierre a mitad de escritura no la corrompe).
func (a *App) SaveSession(data string) error {
	path, err := sessionPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return a.SaveFile(path, data)
}
