package main

import (
	"net/http"
	"path/filepath"
	"strings"
)

// El WebView solo ve los assets embebidos de la app. Para que un .md pueda mostrar
// imágenes de su carpeta, el frontend reescribe esas rutas a /__local?path=<ruta>
// y este middleware las sirve desde el disco. Solo se sirven imágenes.

const localFilesRoute = "/__local"

var imageExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
	".svg": true, ".avif": true, ".bmp": true, ".ico": true,
}

func localFilesMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != localFilesRoute {
			next.ServeHTTP(w, r)
			return
		}
		path := filepath.Clean(r.URL.Query().Get("path"))
		if !filepath.IsAbs(path) || !imageExts[strings.ToLower(filepath.Ext(path))] {
			http.Error(w, "solo se sirven imágenes con ruta absoluta", http.StatusForbidden)
			return
		}
		// Un SVG podría traer scripts: aunque en <img> no se ejecutan, se bloquean igual
		// por si alguien abre la URL directamente.
		w.Header().Set("Content-Security-Policy", "script-src 'none'")
		w.Header().Set("Cache-Control", "no-cache") // reflejar cambios en la imagen al re-renderizar
		http.ServeFile(w, r, path)
	})
}
