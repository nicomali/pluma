package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Settings son las preferencias persistentes de Pluma.
// Se guardan en %APPDATA%\Pluma\settings.json (os.UserConfigDir en otros sistemas).
type Settings struct {
	Recent      []string `json:"recent"`      // archivos abiertos recientemente, el más nuevo primero
	Zoom        float64  `json:"zoom"`        // escala de fuente (1 = 100%)
	SidebarOpen bool     `json:"sidebarOpen"` // barra lateral visible
	EditMode    string   `json:"editMode"`    // "raw" (Markdown) o "visual"
	LineNumbers string   `json:"lineNumbers"` // "off", "absolute" o "relative"
}

func defaultSettings() Settings {
	return Settings{Recent: []string{}, Zoom: 1, SidebarOpen: true, EditMode: "raw", LineNumbers: "off"}
}

func settingsPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, configDirName, "settings.json"), nil
}

// LoadSettings devuelve las preferencias guardadas (o las default si no hay archivo
// o está corrupto). Los recientes que ya no existen en disco se descartan.
func (a *App) LoadSettings() Settings {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	s := defaultSettings()
	path, err := settingsPath()
	if err != nil {
		return s
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return s
	}
	if json.Unmarshal(data, &s) != nil {
		return defaultSettings()
	}

	existing := []string{}
	for _, p := range s.Recent {
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			existing = append(existing, p)
		}
	}
	s.Recent = existing
	if s.Zoom <= 0 {
		s.Zoom = 1
	}
	if s.EditMode != "visual" {
		s.EditMode = "raw"
	}
	if s.LineNumbers != "absolute" && s.LineNumbers != "relative" {
		s.LineNumbers = "off"
	}
	return s
}

// SaveSettings persiste las preferencias.
func (a *App) SaveSettings(s Settings) error {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	path, err := settingsPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
