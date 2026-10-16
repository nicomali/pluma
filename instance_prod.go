//go:build !dev

package main

// instanceID identifica la ventana única de Pluma (ver SingleInstanceLock en main.go).
const instanceID = "pluma-markdown-7c1e2a4b"

// configDirName es la carpeta de preferencias y sesión dentro de %APPDATA%.
const configDirName = "Pluma"
