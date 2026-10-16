//go:build dev

package main

// En `wails dev` (que compila con la etiqueta "dev") se usa otro identificador, para
// que la versión de desarrollo no le pase sus archivos a una Pluma instalada y abierta.
const instanceID = "pluma-markdown-dev-7c1e2a4b"

// Preferencias y sesión aparte: probar en desarrollo no toca las de la Pluma instalada.
const configDirName = "Pluma-dev"
