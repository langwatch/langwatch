package cmd

import "testing"

// TestResolveLangWatchBaseURL_FallsBackToLangwatchEndpoint pins the
// fix for the prod regression on 2026-04-29: every evaluator dispatch
// errored with "LangWatchBaseURL is required to call the evaluator
// API" because prod set only `LANGWATCH_ENDPOINT` (the universal
// LangWatch URL env var that terraform pins on every Lambda) and the
// resolver previously only looked at `NLPGO_ENGINE_LANGWATCH_BASE_URL`.
//
// Mirrors the same fallback pattern in services/nlpgo/deps.go's
// configureNLPGoOTel, so a single env var is the canonical source of
// truth for "where the LangWatch app lives" across both OTel export
// and evaluator callbacks.
func TestResolveLangWatchBaseURL_FallsBackToLangwatchEndpoint(t *testing.T) {
	cases := []struct {
		name     string
		explicit string
		env      map[string]string
		want     string
	}{
		{
			name:     "explicit wins over env",
			explicit: "https://app.langwatch.ai",
			env:      map[string]string{"LANGWATCH_ENDPOINT": "https://other.example.com"},
			want:     "https://app.langwatch.ai",
		},
		{
			name:     "env fallback when explicit is empty",
			explicit: "",
			env:      map[string]string{"LANGWATCH_ENDPOINT": "https://app.langwatch.ai"},
			want:     "https://app.langwatch.ai",
		},
		{
			name:     "trailing slash in env is trimmed",
			explicit: "",
			env:      map[string]string{"LANGWATCH_ENDPOINT": "https://app.langwatch.ai/"},
			want:     "https://app.langwatch.ai",
		},
		{
			name:     "neither set returns empty (callers handle the typed evaluator_unconfigured error downstream)",
			explicit: "",
			env:      map[string]string{},
			want:     "",
		},
		{
			name:     "explicit is preserved as-is, no slash trimming (caller decides)",
			explicit: "http://host.docker.internal:5560/",
			env:      map[string]string{},
			want:     "http://host.docker.internal:5560/",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			getenv := func(k string) string { return tc.env[k] }
			got := resolveLangWatchBaseURL(tc.explicit, getenv)
			if got != tc.want {
				t.Errorf("resolveLangWatchBaseURL(%q, env=%v) = %q; want %q",
					tc.explicit, tc.env, got, tc.want)
			}
		})
	}
}
