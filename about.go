package main

import "github.com/wailsapp/wails/v2/pkg/runtime"

const (
	appVersion = "0.2.0"
	appAuthor  = "Nicolas Malinovsky nEm"
	appRepo    = "https://github.com/nicomali/pluma"
)

// showAbout muestra el "Acerca de" con autor y licencia.
func (a *App) showAbout() {
	a.showMessage(runtime.InfoDialog, "Acerca de Pluma",
		"Pluma "+appVersion+"\n"+
			"Editor de Markdown minimalista.\n\n"+
			"Creado por "+appAuthor+".\n\n"+
			"Código abierto bajo licencia MIT: podés usarlo, modificarlo y "+
			"distribuirlo libremente, siempre que se mantenga el aviso de autoría.\n\n"+
			appRepo)
}
