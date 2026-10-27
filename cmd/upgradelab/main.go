package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/upgradelab"
)

func main() {
	os.Exit(upgradelab.Run(os.Args[1:], os.Stdout, os.Stderr))
}
