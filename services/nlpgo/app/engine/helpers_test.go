package engine

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// strParam builds a `paramString`-readable DSL field. Node parameters carry
// JSON-encoded values on the wire, so a fixture that hand-writes a bare Go
// string would not exercise the read path the engine actually uses.
func strParam(name, value string) dsl.Field {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return dsl.Field{Identifier: name, Type: "str", Value: raw}
}

// codeParam is the `code` parameter every code-executing node reads.
func codeParam(src string) dsl.Field { return strParam("code", src) }

// newCodeEngine returns an engine wired with a real code runner.
func newCodeEngine(t *testing.T) *Engine {
	t.Helper()
	codeExec, err := codeblock.New(codeblock.Options{})
	require.NoError(t, err)
	return New(Options{Code: codeExec})
}
