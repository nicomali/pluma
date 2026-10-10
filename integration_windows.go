//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// Todo se escribe en HKEY_CURRENT_USER: no requiere permisos de administrador
// y solo afecta al usuario actual.

const (
	progID = "Pluma.Markdown"
	appKey = `Software\Pluma`
)

var mdExtensions = []string{".md", ".markdown"}

type regValue struct{ path, name, value string }

// exeCommands devuelve el comando de apertura ("exe" "%1") y el ícono ("exe",0).
func exeCommands() (open, icon string, err error) {
	exe, err := os.Executable()
	if err != nil {
		return "", "", err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return fmt.Sprintf(`"%s" "%%1"`, exe), fmt.Sprintf(`"%s",0`, exe), nil
}

// registerShell registra Pluma como opción para abrir .md:
//   - ProgID + OpenWithProgids → aparece en "Abrir con".
//   - Capabilities + RegisteredApplications → aparece en Configuración > Apps predeterminadas.
//   - SystemFileAssociations\<ext>\shell → entrada "Abrir con Pluma" en el menú contextual.
func registerShell() error {
	open, icon, err := exeCommands()
	if err != nil {
		return err
	}

	values := []regValue{
		{`Software\Classes\` + progID, "", "Documento Markdown"},
		{`Software\Classes\` + progID + `\DefaultIcon`, "", icon},
		{`Software\Classes\` + progID + `\shell\open\command`, "", open},
		{appKey + `\Capabilities`, "ApplicationName", "Pluma"},
		{appKey + `\Capabilities`, "ApplicationDescription", "Editor de Markdown minimalista"},
		{`Software\RegisteredApplications`, "Pluma", appKey + `\Capabilities`},
	}
	for _, ext := range mdExtensions {
		ctx := `Software\Classes\SystemFileAssociations\` + ext + `\shell\Pluma`
		values = append(values,
			regValue{`Software\Classes\` + ext + `\OpenWithProgids`, progID, ""},
			regValue{appKey + `\Capabilities\FileAssociations`, ext, progID},
			regValue{ctx, "", "Abrir con Pluma"},
			regValue{ctx, "Icon", icon},
			regValue{ctx + `\command`, "", open},
		)
	}

	for _, v := range values {
		if err := setString(v); err != nil {
			return fmt.Errorf("registro %s: %w", v.path, err)
		}
	}
	notifyAssocChanged()
	return nil
}

// unregisterShell borra todo lo que escribió registerShell.
func unregisterShell() error {
	trees := []string{`Software\Classes\` + progID, appKey}
	for _, ext := range mdExtensions {
		trees = append(trees, `Software\Classes\SystemFileAssociations\`+ext+`\shell\Pluma`)
	}
	for _, t := range trees {
		if err := deleteTree(t); err != nil {
			return fmt.Errorf("borrando %s: %w", t, err)
		}
	}

	deleteValue(`Software\RegisteredApplications`, "Pluma")
	for _, ext := range mdExtensions {
		deleteValue(`Software\Classes\`+ext+`\OpenWithProgids`, progID)
	}
	notifyAssocChanged()
	return nil
}

// openDefaultAppsSettings abre la página de Pluma en Configuración > Apps predeterminadas.
// Windows no permite que un programa se ponga como predeterminado solo: lo elige el usuario.
// Se usa ShellExecute (como "Win+R"): explorer.exe no resuelve URIs ms-settings con
// query string y termina abriendo una ventana del Explorador de archivos.
func openDefaultAppsSettings() {
	if shellOpen("ms-settings:defaultapps?registeredAppUser=Pluma") != nil {
		_ = shellOpen("ms-settings:defaultapps") // versiones viejas: página general
	}
}

func shellOpen(target string) error {
	verb, _ := windows.UTF16PtrFromString("open")
	file, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, verb, file, nil, nil, windows.SW_SHOWNORMAL)
}

// --- helpers de registro ---

func setString(v regValue) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, v.path, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.SetStringValue(v.name, v.value)
}

func deleteValue(path, name string) {
	k, err := registry.OpenKey(registry.CURRENT_USER, path, registry.SET_VALUE)
	if err != nil {
		return
	}
	defer k.Close()
	_ = k.DeleteValue(name)
}

// deleteTree borra una clave con todas sus subclaves (registry.DeleteKey solo borra hojas).
func deleteTree(path string) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, path, registry.ENUMERATE_SUB_KEYS)
	if errors.Is(err, registry.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	subkeys, err := k.ReadSubKeyNames(-1)
	k.Close()
	if err != nil {
		return err
	}
	for _, sk := range subkeys {
		if err := deleteTree(path + `\` + sk); err != nil {
			return err
		}
	}
	return registry.DeleteKey(registry.CURRENT_USER, path)
}

// notifyAssocChanged avisa al Explorador que cambiaron las asociaciones (refresca menús e íconos).
func notifyAssocChanged() {
	const shcneAssocChanged = 0x08000000
	windows.NewLazySystemDLL("shell32.dll").NewProc("SHChangeNotify").Call(shcneAssocChanged, 0, 0, 0)
}
