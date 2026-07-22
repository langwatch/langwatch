package herrgen_test

import (
	"io"
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/herrgen"
)

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
			name: "a NodeError whose Type is not a string literal is skipped, the literal beside it kept",
			files: map[string]string{
				"services/nlpgo/app/engine/forward.go": `package engine

func forward(res upstream) *NodeError {
	// Forwarding an upstream code carries nothing we can name.
	return &NodeError{Type: res.Error.Type, Message: res.Error.Message}
}

var _ = NodeError{Type: "engine_error"}
`,
			},
			want: []herrgen.NodeCode{{
				Code:    "engine_error",
				Sources: []string{"services/nlpgo/app/engine/forward.go"},
			}},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, got, err := herrgen.Parse(tree(t, test.files), io.Discard)
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
