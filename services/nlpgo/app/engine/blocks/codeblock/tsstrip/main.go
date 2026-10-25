// Command tsstrip erases a TypeScript code block's types. It is built for
// wasip1 and runs inside the engine's wasm runtime, under the run's deadline
// and memory cap: esbuild's parser is quadratic on some input, so it never
// runs on the host (ADR-183).
package main

import (
	"encoding/json"
	"io"
	"os"

	"github.com/evanw/esbuild/pkg/api"
)

// Stripped is what tsstrip writes to stdout: the JavaScript and its source
// map, or the first error at its 1-based line and column.
type Stripped struct {
	JS    string `json:"js,omitempty"`
	Map   string `json:"map,omitempty"`
	Error *struct {
		Text   string `json:"text"`
		Line   int    `json:"line"`
		Column int    `json:"column"`
	} `json:"error,omitempty"`
}

func main() {
	code, err := io.ReadAll(os.Stdin)
	if err != nil {
		os.Exit(2)
	}
	out := api.Transform(string(code), api.TransformOptions{
		Loader:         api.LoaderTS,
		Target:         api.ESNext,
		Sourcemap:      api.SourceMapExternal,
		SourcesContent: api.SourcesContentExclude,
		Sourcefile:     "code-block.ts",
		LogLevel:       api.LogLevelSilent,
	})
	var result Stripped
	if len(out.Errors) > 0 {
		first := out.Errors[0]
		result.Error = &struct {
			Text   string `json:"text"`
			Line   int    `json:"line"`
			Column int    `json:"column"`
		}{Text: first.Text}
		if loc := first.Location; loc != nil {
			result.Error.Line, result.Error.Column = loc.Line, loc.Column+1
		}
	} else {
		result.JS, result.Map = string(out.Code), string(out.Map)
	}
	if json.NewEncoder(os.Stdout).Encode(result) != nil {
		os.Exit(2)
	}
}
