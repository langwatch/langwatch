// Command modelcapsgen mirrors the model registry's endpoint-scoped
// reasoning capabilities into the Go table nlpgo enforces at dispatch.
//
// Usage: modelcapsgen [-root .] [-registry ...llmModels.json] [-out ...reasoningcaps.generated.go] [-check]
//
// The rules live in tools/modelcapsgen; this is only the process shell.
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/modelcapsgen"
)

func main() {
	os.Exit(modelcapsgen.Run(os.Args[1:], os.Stdout, os.Stderr))
}
