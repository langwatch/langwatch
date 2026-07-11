package otlpreceiver

import "testing"

func TestClassify(t *testing.T) {
	tests := []struct {
		name  string
		span  string
		attrs map[string]any
		want  Kind
	}{
		{
			name:  "gen-ai attributes classify as llm",
			span:  "chat gpt-5-mini",
			attrs: map[string]any{"gen_ai.system": "openai", "gen_ai.usage.input_tokens": int64(120)},
			want:  KindLLM,
		},
		{
			name:  "any gen_ai attribute is enough",
			span:  "anonymous",
			attrs: map[string]any{"gen_ai.request.model": "gpt-5-mini"},
			want:  KindLLM,
		},
		{
			name:  "gen_ai.tool.name classifies as tool, not llm",
			span:  "execute_tool read",
			attrs: map[string]any{"gen_ai.tool.name": "read", "gen_ai.system": "openai"},
			want:  KindTool,
		},
		{
			name:  "gen_ai.operation.name=execute_tool classifies as tool",
			span:  "opencode.tool",
			attrs: map[string]any{"gen_ai.operation.name": "execute_tool", "gen_ai.system": "openai"},
			want:  KindTool,
		},
		{
			name:  "a bare tool.name classifies as tool",
			span:  "bash",
			attrs: map[string]any{"tool.name": "bash"},
			want:  KindTool,
		},
		{
			name:  "an execute_tool span name classifies as tool without attributes",
			span:  "execute_tool grep",
			attrs: nil,
			want:  KindTool,
		},
		{
			name:  "an http client span is other",
			span:  "GET /api/traces",
			attrs: map[string]any{"http.request.method": "GET"},
			want:  KindOther,
		},
		{
			name:  "a langwatch CLI span is other — the attributes carry the meaning",
			span:  "langwatch traces list",
			attrs: map[string]any{"langwatch.resource": "traces", "langwatch.verb": "list"},
			want:  KindOther,
		},
		{
			name:  "no name and no attributes is other",
			span:  "",
			attrs: nil,
			want:  KindOther,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := classify(tc.span, tc.attrs); got != tc.want {
				t.Errorf("classify(%q) = %q, want %q", tc.span, got, tc.want)
			}
		})
	}
}
