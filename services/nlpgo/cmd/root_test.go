package cmd

import (
	"os"
	"testing"
	"time"

	nlpgo "github.com/langwatch/langwatch/services/nlpgo"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
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
			if got := resolveTimeoutSeconds(tc.seconds); got != tc.want {
				t.Errorf("resolveTimeoutSeconds(%d) = %v; want %v", tc.seconds, got, tc.want)
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

// TestNewHTTPExecutor_AppliesConfiguredCeiling pins the HTTP-block operator
// knob to the executor that enforces it.
// @scenario "The HTTP block ceiling comes from NLPGO_ENGINE_HTTP_BLOCK_TIMEOUT_SECONDS"
func TestNewHTTPExecutor_AppliesConfiguredCeiling(t *testing.T) {
	exec := newHTTPExecutor(nlpgo.EngineConfig{HTTPBlockTimeoutSeconds: 300}, httpblock.SSRFOptions{})
	if got, want := exec.DefaultTimeout(), 5*time.Minute; got != want {
		t.Errorf("DefaultTimeout() = %v; want %v (NLPGO_ENGINE_HTTP_BLOCK_TIMEOUT_SECONDS=300)", got, want)
	}
}

// TestNewAgentWorkflowRunner_AppliesConfiguredCeiling pins the agent
// sub-workflow operator knob to the runner that enforces it.
// @scenario "The agent sub-workflow ceiling comes from NLPGO_ENGINE_AGENT_WORKFLOW_TIMEOUT_SECONDS"
func TestNewAgentWorkflowRunner_AppliesConfiguredCeiling(t *testing.T) {
	runner := newAgentWorkflowRunner(nlpgo.EngineConfig{AgentWorkflowTimeoutSeconds: 300})
	if got, want := runner.DefaultTimeout(), 5*time.Minute; got != want {
		t.Errorf("DefaultTimeout() = %v; want %v (NLPGO_ENGINE_AGENT_WORKFLOW_TIMEOUT_SECONDS=300)", got, want)
	}
}

// TestNewEvaluatorExecutor_AppliesConfiguredCeiling pins the evaluator
// operator knob to the executor that enforces it.
// @scenario "The evaluator ceiling comes from NLPGO_ENGINE_EVALUATOR_TIMEOUT_SECONDS"
func TestNewEvaluatorExecutor_AppliesConfiguredCeiling(t *testing.T) {
	exec := newEvaluatorExecutor(nlpgo.EngineConfig{EvaluatorTimeoutSeconds: 300})
	if got, want := exec.DefaultTimeout(), 5*time.Minute; got != want {
		t.Errorf("DefaultTimeout() = %v; want %v (NLPGO_ENGINE_EVALUATOR_TIMEOUT_SECONDS=300)", got, want)
	}
}

// TestBlockCeilings_UnsetOrNegativeKeepTheTwelveMinuteDefault guards the
// wiring against two ways of turning an operator's mistake into an outage: an
// unset knob must not become a zero-length (already-expired) budget, and a
// negative one must not become a negative duration. Both defer to the
// executor's own 12-minute default, which is what every deployment runs on
// today.
// @scenario "An unset or negative block-timeout knob keeps today's twelve-minute default"
func TestBlockCeilings_UnsetOrNegativeKeepTheTwelveMinuteDefault(t *testing.T) {
	const want = 12 * time.Minute

	for _, cfg := range []nlpgo.EngineConfig{
		{},
		{HTTPBlockTimeoutSeconds: -30, AgentWorkflowTimeoutSeconds: -30, EvaluatorTimeoutSeconds: -30},
	} {
		if got := newHTTPExecutor(cfg, httpblock.SSRFOptions{}).DefaultTimeout(); got != want {
			t.Errorf("http DefaultTimeout() = %v; want %v", got, want)
		}
		if got := newAgentWorkflowRunner(cfg).DefaultTimeout(); got != want {
			t.Errorf("agent DefaultTimeout() = %v; want %v", got, want)
		}
		if got := newEvaluatorExecutor(cfg).DefaultTimeout(); got != want {
			t.Errorf("evaluator DefaultTimeout() = %v; want %v", got, want)
		}
	}
}

// TestCodeBlockTimeout_ReachesTheExecutorFromTheEnvironment closes the gap the
// hand-built EngineConfig tests above leave open: they prove the wiring reads
// the field, and config_test.go proves the variable fills the field, but
// nothing joined the two. A rename on either side of that seam would leave
// both halves green while the operator's variable selected nothing — which is
// the exact failure this branch exists to fix.
//
// This is the environment-driven half of specs/nlp-go/code-block.feature's
// wall-clock-timeout Rule. The remaining @unimplemented scenario there is the
// end-to-end HTTP path (the kill surfacing on /go/studio/execute_sync, plus
// orphan-process reaping), which this does not cover.
// @scenario "the operator's code-block timeout reaches the executor from the environment"
func TestCodeBlockTimeout_ReachesTheExecutorFromTheEnvironment(t *testing.T) {
	t.Setenv("NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS", "7")

	cfg, err := nlpgo.LoadConfig(t.Context())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	exec, err := newCodeExecutor(cfg.Engine, os.Getenv)
	if err != nil {
		t.Fatalf("newCodeExecutor: %v", err)
	}

	if got, want := exec.DefaultTimeout(), 7*time.Second; got != want {
		t.Errorf("DefaultTimeout() = %v; want %v (NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS=7)", got, want)
	}
}
