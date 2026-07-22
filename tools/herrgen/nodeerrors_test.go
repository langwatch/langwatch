package herrgen_test

import (
	"io"
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/herrgen"
)

// nodeErrorDeclaration is the engine's type, which is what makes a bare
// `NodeError{...}` in that package the engine's rather than any type anywhere
// that happens to share the name.
const nodeErrorDeclaration = `package engine

// NodeError is the structured error attached to a failed node.
type NodeError struct {
	NodeID  string
	Type    string
	Message string
}
`

// engineTree writes the engine package's type declaration alongside the files
// under test, so the fixture stands for the tree it is modelling.
func engineTree(t *testing.T, files map[string]string) string {
	t.Helper()
	all := map[string]string{"services/nlpgo/app/engine/nodeerror.go": nodeErrorDeclaration}
	for path, source := range files {
		all[path] = source
	}
	return tree(t, all)
}

func TestParseNodeErrors(t *testing.T) {
	tests := []struct {
		name  string
		files map[string]string
		want  []herrgen.NodeCode
	}{
		{
			name: "a NodeError value literal contributes its Type code",
			files: map[string]string{
				"services/nlpgo/app/engine/engine.go": `package engine

var _ = NodeError{Type: "invalid_condition", Message: "bad condition"}
`,
			},
			want: []herrgen.NodeCode{{
				Code:    "invalid_condition",
				Sources: []string{"services/nlpgo/app/engine/engine.go"},
			}},
		},
		{
			name: "an &NodeError pointer literal is read too",
			files: map[string]string{
				"services/nlpgo/app/engine/llm.go": `package engine

func fail() *NodeError {
	return &NodeError{Type: "llm_error", Message: "no reply"}
}
`,
			},
			want: []herrgen.NodeCode{{
				Code:    "llm_error",
				Sources: []string{"services/nlpgo/app/engine/llm.go"},
			}},
		},
		{
			name: "a qualified literal from another package is read through the import",
			files: map[string]string{
				"services/nlpgo/adapters/httpapi/handler.go": `package httpapi

import "example.com/repo/services/nlpgo/app/engine"

func fail() *engine.NodeError {
	return &engine.NodeError{Type: "idle_timeout"}
}
`,
			},
			want: []herrgen.NodeCode{{
				Code:    "idle_timeout",
				Sources: []string{"services/nlpgo/adapters/httpapi/handler.go"},
			}},
		},
		{
			name: "a NodeError from some other package contributes nothing",
			files: map[string]string{
				"services/aigateway/app/router/errors.go": `package router

// A different type that happens to share the name.
type NodeError struct {
	Type string
}

var _ = NodeError{Type: "not_an_engine_code"}
`,
			},
			want: nil,
		},
		{
			name: "the same code in two files folds to one entry naming both, path-sorted",
			files: map[string]string{
				"services/nlpgo/app/engine/http.go": `package engine

var _ = NodeError{Type: "http_error"}
`,
				"services/nlpgo/app/engine/attachment.go": `package engine

func attach() *NodeError {
	return &NodeError{Type: "http_error"}
}
`,
			},
			want: []herrgen.NodeCode{{
				Code: "http_error",
				Sources: []string{
					"services/nlpgo/app/engine/attachment.go",
					"services/nlpgo/app/engine/http.go",
				},
			}},
		},
		{
			name: "a literal that sets no Type carries no code",
			files: map[string]string{
				"services/nlpgo/app/engine/run.go": `package engine

func blank(id string) *NodeError {
	return &NodeError{NodeID: id}
}
`,
			},
			want: nil,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, got, err := herrgen.Parse(engineTree(t, test.files), io.Discard)
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}
			if len(got) != len(test.want) {
				t.Fatalf("Parse() returned %d node codes, want %d: %+v", len(got), len(test.want), got)
			}
			for i, want := range test.want {
				if got[i].Code != want.Code {
					t.Errorf("node code %d = %q, want %q", i, got[i].Code, want.Code)
				}
				if !slices.Equal(got[i].Sources, want.Sources) {
					t.Errorf("node code %q sources = %v, want %v", want.Code, got[i].Sources, want.Sources)
				}
			}
		})
	}
}

func TestParseReportsAForwardedNodeErrorType(t *testing.T) {
	// Forwarding an upstream error type puts a code on the wire that no
	// generated union carries — a customer's Python `ValueError` arriving as if
	// it were one of our codes. Dropping the site silently is what let that ship
	// with the drift check green, so the site is named instead.
	root := engineTree(t, map[string]string{
		"services/nlpgo/app/engine/forward.go": `package engine

func forward(res upstream) *NodeError {
	return &NodeError{Type: res.Error.Type, Message: res.Error.Message}
}

var _ = NodeError{Type: "engine_error"}
`,
	})

	_, _, err := herrgen.Parse(root, io.Discard)
	if err == nil {
		t.Fatal("Parse() error = nil, want the forwarded Type to fail the run")
	}
	for _, want := range []string{"services/nlpgo/app/engine/forward.go:4", "Normalise"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("Parse() error = %q, want it to mention %q", err, want)
		}
	}
}

func TestRenderNodeCodes(t *testing.T) {
	t.Run("an entry derives its service from the source and lists it", func(t *testing.T) {
		got := string(herrgen.RenderNodeCodes([]herrgen.NodeCode{{
			Code:    "http_error",
			Sources: []string{"services/nlpgo/app/engine/engine.go"},
		}}))
		for _, want := range []string{
			"export const nodeErrorCodes = {\n",
			"   * @source services/nlpgo/app/engine/engine.go\n",
			`  http_error: { service: "nlpgo" },`,
			"} as const;\n",
			"export type NodeErrorCode = keyof typeof nodeErrorCodes;\n",
		} {
			if !strings.Contains(got, want) {
				t.Errorf("RenderNodeCodes() is missing %q\n\ngot:\n%s", want, got)
			}
		}
	})

	t.Run("a code with no sources renders rather than panicking", func(t *testing.T) {
		// RenderNodeCodes is exported, so a caller can hand it a code Parse
		// never built. Indexing [0] made that a panic.
		got := string(herrgen.RenderNodeCodes([]herrgen.NodeCode{{Code: "orphaned"}}))
		if !strings.Contains(got, `  orphaned: { service: "" },`) {
			t.Errorf("RenderNodeCodes() should render a sourceless code\n\ngot:\n%s", got)
		}
	})

	t.Run("a source path that closes a block comment cannot end the generated one", func(t *testing.T) {
		got := string(herrgen.RenderNodeCodes([]herrgen.NodeCode{{
			Code:    "http_error",
			Sources: []string{"services/nlpgo/*/engine.go"},
		}}))
		if !strings.Contains(got, `@source services/nlpgo/*\/engine.go`) {
			t.Errorf("RenderNodeCodes() should escape the comment terminator\n\ngot:\n%s", got)
		}
	})

	t.Run("a code that is not a bare identifier is quoted", func(t *testing.T) {
		got := string(herrgen.RenderNodeCodes([]herrgen.NodeCode{{
			Code:    "http-error",
			Sources: []string{"services/nlpgo/app/engine/engine.go"},
		}}))
		if !strings.Contains(got, `  "http-error": { service: "nlpgo" },`) {
			t.Errorf("RenderNodeCodes() should quote a non-identifier key\n\ngot:\n%s", got)
		}
	})

	t.Run("the same input renders the same bytes", func(t *testing.T) {
		codes := []herrgen.NodeCode{
			{Code: "engine_error", Sources: []string{"services/nlpgo/app/engine/engine.go"}},
			{Code: "http_error", Sources: []string{"services/nlpgo/app/engine/http.go"}},
		}
		first := string(herrgen.RenderNodeCodes(codes))
		for range 5 {
			if got := string(herrgen.RenderNodeCodes(codes)); got != first {
				t.Fatalf("RenderNodeCodes() is not stable:\n%s\n\nvs\n\n%s", first, got)
			}
		}
	})
}
