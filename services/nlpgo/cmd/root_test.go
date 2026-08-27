package cmd

import (
	"testing"
	"time"

	nlpgo "github.com/langwatch/langwatch/services/nlpgo"
)

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

// TestResolveSandboxPython_HonorsTheUnprefixedImageSetting pins the fix for a
// setting that selected nothing. The config hydrator prefixes every field of
// EngineConfig, so `cfg.Engine.SandboxPython` is fed by
// NLPGO_ENGINE_SANDBOX_PYTHON, while both runtime images (the K8s service and
// the Lambda) set the unprefixed SANDBOX_PYTHON. Code blocks ran on whatever
// `python3` PATH resolved to, which matched the named interpreter by accident
// rather than by the setting, and an operator who pointed the documented
// variable at their own interpreter was ignored without a word.
//
// Found by running the committed shared-session example through the real
// runner on a local stack: every row failed with "No module named 'langwatch'"
// while the interpreter that holds the SDK was named and ignored.
func TestResolveSandboxPython_HonorsTheUnprefixedImageSetting(t *testing.T) {
	cases := []struct {
		name     string
		explicit string
		env      map[string]string
		want     string
	}{
		{
			name:     "the prefixed setting wins over the image one",
			explicit: "/opt/venv/bin/python",
			env:      map[string]string{"SANDBOX_PYTHON": "/usr/bin/python3.11"},
			want:     "/opt/venv/bin/python",
		},
		{
			name:     "the image setting is honored when nothing is prefixed",
			explicit: nlpgo.DefaultSandboxPython,
			env:      map[string]string{"SANDBOX_PYTHON": "/usr/bin/python3.11"},
			want:     "/usr/bin/python3.11",
		},
		{
			name:     "an empty config field falls back to the image setting",
			explicit: "",
			env:      map[string]string{"SANDBOX_PYTHON": "/usr/bin/python3.11"},
			want:     "/usr/bin/python3.11",
		},
		{
			name:     "neither set keeps the default",
			explicit: nlpgo.DefaultSandboxPython,
			env:      map[string]string{},
			want:     nlpgo.DefaultSandboxPython,
		},
		{
			name:     "a blank image setting is not an interpreter",
			explicit: nlpgo.DefaultSandboxPython,
			env:      map[string]string{"SANDBOX_PYTHON": "   "},
			want:     nlpgo.DefaultSandboxPython,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			getenv := func(k string) string { return tc.env[k] }
			got := resolveSandboxPython(tc.explicit, getenv)
			if got != tc.want {
				t.Errorf("resolveSandboxPython(%q, env=%v) = %q; want %q",
					tc.explicit, tc.env, got, tc.want)
			}
		})
	}
}

// TestNewCodeExecutor_AppliesConfiguredCodeBlockTimeout pins the operator
// knob to the executor that enforces it. `CodeBlockTimeoutSeconds` was
// declared, defaulted and documented but never read: `codeblock.New` was
// called without `DefaultTimeout`, so the executor's own 60s fallback won
// every time and a long-running code block could not be given more room
// from configuration.
func TestNewCodeExecutor_AppliesConfiguredCodeBlockTimeout(t *testing.T) {
	getenv := func(string) string { return "" }

	exec, err := newCodeExecutor(nlpgo.EngineConfig{
		SandboxPython:           nlpgo.DefaultSandboxPython,
		CodeBlockTimeoutSeconds: 300,
	}, getenv)
	if err != nil {
		t.Fatalf("newCodeExecutor: %v", err)
	}
	if got, want := exec.DefaultTimeout(), 5*time.Minute; got != want {
		t.Errorf("DefaultTimeout() = %v; want %v (NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS=300)", got, want)
	}
}

// TestNewCodeExecutor_UnsetTimeoutKeepsTheSixtySecondDefault guards the
// wiring against turning an unset knob into a zero-length — that is,
// already-expired — timeout.
func TestNewCodeExecutor_UnsetTimeoutKeepsTheSixtySecondDefault(t *testing.T) {
	getenv := func(string) string { return "" }

	exec, err := newCodeExecutor(nlpgo.EngineConfig{
		SandboxPython: nlpgo.DefaultSandboxPython,
	}, getenv)
	if err != nil {
		t.Fatalf("newCodeExecutor: %v", err)
	}
	if got, want := exec.DefaultTimeout(), 60*time.Second; got != want {
		t.Errorf("DefaultTimeout() = %v; want %v", got, want)
	}
}

// TestResolveCodeBlockTimeout covers the misconfiguration edge: a zero or
// negative NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS must not become a negative duration.
// codeblock.Execute feeds this straight into context.WithTimeout, so a
// negative value would produce an already-expired context and kill every
// code block instantly. Zero defers to codeblock.New's 60s fallback.
func TestResolveCodeBlockTimeout(t *testing.T) {
	cases := []struct {
		name    string
		seconds int
		want    time.Duration
	}{
		{name: "a configured value is seconds", seconds: 300, want: 5 * time.Minute},
		{name: "one second is honored", seconds: 1, want: time.Second},
		{name: "unset defers to the executor default", seconds: 0, want: 0},
		{name: "negative defers rather than expiring", seconds: -1, want: 0},
		{name: "a large negative still defers", seconds: -3600, want: 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveCodeBlockTimeout(tc.seconds); got != tc.want {
				t.Errorf("resolveCodeBlockTimeout(%d) = %v; want %v", tc.seconds, got, tc.want)
			}
		})
	}
}

// TestNewCodeExecutor_NegativeTimeoutDoesNotExpireImmediately is the
// end-to-end half of the edge above: the wiring, not just the helper, must
// never hand codeblock.New a negative DefaultTimeout.
func TestNewCodeExecutor_NegativeTimeoutDoesNotExpireImmediately(t *testing.T) {
	getenv := func(string) string { return "" }

	exec, err := newCodeExecutor(nlpgo.EngineConfig{
		SandboxPython:           nlpgo.DefaultSandboxPython,
		CodeBlockTimeoutSeconds: -30,
	}, getenv)
	if err != nil {
		t.Fatalf("newCodeExecutor: %v", err)
	}
	if got := exec.DefaultTimeout(); got <= 0 {
		t.Errorf("DefaultTimeout() = %v; want a positive duration", got)
	}
	if got, want := exec.DefaultTimeout(), 60*time.Second; got != want {
		t.Errorf("DefaultTimeout() = %v; want %v", got, want)
	}
}
