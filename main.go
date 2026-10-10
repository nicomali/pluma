package main

import (
	"embed"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Modo sin ventana para el instalador/desinstalador: registra o quita la
	// integración con Windows y sale (código 1 si falla).
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--register":
			exitOnError(registerShell())
		case "--unregister":
			exitOnError(unregisterShell())
		}
	}

	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "Pluma",
		Width:     1100,
		Height:    780,
		MinWidth:  480,
		MinHeight: 320,
		Menu:      buildMenu(app),
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Middleware: localFilesMiddleware, // imágenes locales referenciadas desde los .md
		},
		// Drag & drop nativo: Wails entrega las rutas absolutas al frontend
		// y el WebView no intenta "navegar" al archivo soltado.
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		// Una sola ventana: los .md que se abran desde el Explorador llegan como pestañas.
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "pluma-markdown-7c1e2a4b",
			OnSecondInstanceLaunch: app.onSecondInstance,
		},
		// El zoom nativo del WebView se desactiva: la escala de fuente la maneja Pluma.
		Windows: &windows.Options{
			IsZoomControlEnabled: false,
		},
		BackgroundColour: &options.RGBA{R: 252, G: 252, B: 250, A: 1},
		OnStartup:        app.startup,
		OnBeforeClose:    app.beforeClose,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

func exitOnError(err error) {
	if err != nil {
		os.Exit(1)
	}
	os.Exit(0)
}

// buildMenu arma la barra de menú nativa. Las acciones de documento se delegan al
// frontend vía eventos (ahí vive el estado). Los atajos de teclado los maneja el
// frontend, por eso los ítems no tienen aceleradores (solo los muestran en el texto).
func buildMenu(app *App) *menu.Menu {
	emit := func(name string) menu.Callback {
		return func(*menu.CallbackData) { runtime.EventsEmit(app.ctx, name) }
	}

	m := menu.NewMenu()

	file := m.AddSubmenu("Archivo")
	file.AddText("Nueva pestaña    Ctrl+T", nil, emit("menu:new"))
	file.AddText("Abrir…    Ctrl+O", nil, emit("menu:open"))
	file.AddSeparator()
	file.AddText("Guardar    Ctrl+S", nil, emit("menu:save"))
	file.AddText("Guardar como…    Ctrl+Shift+S", nil, emit("menu:saveas"))
	file.AddSeparator()
	file.AddText("Cerrar pestaña    Ctrl+W", nil, emit("menu:close"))
	file.AddText("Salir", nil, func(*menu.CallbackData) { runtime.Quit(app.ctx) })

	view := m.AddSubmenu("Ver")
	view.AddText("Barra lateral    Ctrl+B", nil, emit("menu:sidebar"))
	view.AddSeparator()
	mode := app.LoadSettings().EditMode
	setMode := func(value string) menu.Callback {
		return func(*menu.CallbackData) { runtime.EventsEmit(app.ctx, "menu:editmode", value) }
	}
	app.editModeItems = map[string]*menu.MenuItem{
		"raw":    view.AddRadio("Edición Markdown", mode == "raw", nil, setMode("raw")),
		"visual": view.AddRadio("Edición visual", mode == "visual", nil, setMode("visual")),
	}
	view.AddSeparator()
	view.AddText("Aumentar fuente    Ctrl++", nil, emit("menu:zoomin"))
	view.AddText("Reducir fuente    Ctrl+-", nil, emit("menu:zoomout"))
	view.AddText("Tamaño original    Ctrl+0", nil, emit("menu:zoomreset"))

	opts := m.AddSubmenu("Opciones")
	opts.AddText("Integrar con Windows (Abrir con y menú contextual)", nil, func(*menu.CallbackData) { app.integrateWithWindows() })
	opts.AddText("Quitar integración con Windows", nil, func(*menu.CallbackData) { app.removeWindowsIntegration() })

	help := m.AddSubmenu("Ayuda")
	help.AddText("Documento de ejemplo", nil, func(*menu.CallbackData) { app.openExample() })

	return m
}
