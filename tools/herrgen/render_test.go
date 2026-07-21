package herrgen_test

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/herrgen"
)

func TestRender(t *testing.T) {
	tests := []struct {
		name    string
		entries []herrgen.Entry
		want    []string
		absent  []string
	}{
		{
			name: "an entry carries its doc, source and status",
			entries: []herrgen.Entry{{
				Code:      "conversation_busy",
				Status:    409,
				HasStatus: true,
				Declarations: []herrgen.Declaration{{
					Name:    "ErrConversationBusy",
					Code:    "conversation_busy",
					Doc:     "ErrConversationBusy signals a second concurrent turn for a conversation\nwhose single-stream opencode session is already answering.\n",
					Source:  "services/langyagent/domain/errors.go",
					Service: "langyagent",
				}},
			}},
			want: []string{
				"  /**\n   * ErrConversationBusy — signals a second concurrent turn for a conversation\n   * whose single-stream opencode session is already answering.\n",
				"   * @source services/langyagent/domain/errors.go\n",
				`  conversation_busy: { service: "langyagent", httpStatus: 409 },`,
			},
		},
		{
			name: "an unregistered code omits httpStatus entirely",
			entries: []herrgen.Entry{{
				Code: "circuit_open",
				Declarations: []herrgen.Declaration{{
					Name:    "ErrCircuitOpen",
					Code:    "circuit_open",
					Source:  "services/aigateway/domain/errors.go",
					Service: "aigateway",
				}},
			}},
			want:   []string{`  circuit_open: { service: "aigateway" },`},
			absent: []string{"httpStatus"},
		},
		{
			name: "a code with no doc still names the const it came from",
			entries: []herrgen.Entry{{
				Code: "rate_limited",
				Declarations: []herrgen.Declaration{{
					Name:    "ErrRateLimited",
					Code:    "rate_limited",
					Source:  "services/aigateway/domain/errors.go",
					Service: "aigateway",
				}},
			}},
			want:   []string{"   * ErrRateLimited\n"},
			absent: []string{"ErrRateLimited —"},
		},
		{
			name: "a shared code names every service that declares it",
			entries: []herrgen.Entry{{
				Code:      "bad_request",
				Status:    400,
				HasStatus: true,
				Declarations: []herrgen.Declaration{
					{Name: "ErrBadRequest", Code: "bad_request", Doc: "ErrBadRequest is the catch-all.\n", Source: "services/nlpgo/domain/errors.go", Service: "nlpgo"},
					{Name: "CodeBadRequest", Code: "bad_request", Source: "pkg/rpc/decode.go", Service: "rpc"},
				},
			}},
			want: []string{
				"   * Also declared by rpc (CodeBadRequest).\n",
				"   * @source pkg/rpc/decode.go\n   * @source services/nlpgo/domain/errors.go\n",
				`  bad_request: { service: "nlpgo", httpStatus: 400 },`,
			},
		},
		{
			name: "a doc that closes a block comment cannot end the generated one",
			entries: []herrgen.Entry{{
				Code: "weird",
				Declarations: []herrgen.Declaration{{
					Name:    "ErrWeird",
					Code:    "weird",
					Doc:     "ErrWeird is written as /* like this */ in Go.\n",
					Source:  "pkg/rpc/decode.go",
					Service: "rpc",
				}},
			}},
			want:   []string{`*\/`},
			absent: []string{"this */ in"},
		},
		{
			name:    "the file is valid TypeScript with no entries at all",
			entries: nil,
			want:    []string{"export const goErrorCodes = {\n} as const;\n", "export type GoErrorCode = keyof typeof goErrorCodes;\n"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := string(herrgen.Render(test.entries))
			for _, want := range test.want {
				if !strings.Contains(got, want) {
					t.Errorf("Render() is missing %q\n\ngot:\n%s", want, got)
				}
			}
			for _, absent := range test.absent {
				if strings.Contains(got, absent) {
					t.Errorf("Render() should not contain %q\n\ngot:\n%s", absent, got)
				}
			}
		})
	}
}

func TestRenderIsStable(t *testing.T) {
	// The file lands in a PR diff, so the same input must produce the same bytes
	// — no map iteration order leaking into the output.
	entries := []herrgen.Entry{
		{Code: "a", Declarations: []herrgen.Declaration{{Name: "ErrA", Code: "a", Source: "pkg/rpc/decode.go", Service: "rpc"}}},
		{Code: "b", Status: 500, HasStatus: true, Declarations: []herrgen.Declaration{{Name: "ErrB", Code: "b", Source: "services/nlpgo/domain/errors.go", Service: "nlpgo"}}},
	}
	first := string(herrgen.Render(entries))
	for range 5 {
		if got := string(herrgen.Render(entries)); got != first {
			t.Fatalf("Render() is not stable:\n%s\n\nvs\n\n%s", first, got)
		}
	}
}
