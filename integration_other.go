//go:build !windows

package main

import "errors"

// La integración con el shell solo existe en Windows.

var errUnsupported = errors.New("integración disponible solo en Windows")

func registerShell() error     { return errUnsupported }
func unregisterShell() error   { return errUnsupported }
func openDefaultAppsSettings() {}
