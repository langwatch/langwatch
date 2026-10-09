package nlpgo

import (
	"testing"
)

// TestEngineDefaults pins the engine-level SSE timeouts at the
// values the owner anchored:
//
//   - StreamIdleTimeoutSeconds = 720 (12min) — must outlive the
//     slowest single agent HTTP call (httpblock.DefaultTimeout =
//     12min) so customers running slow agent backends don't see the
//     inbound SSE stream torn down mid-call. langwatch_nlp regression
//     57e6d1f1c bumped from 120s to 900s but the original Python value
//     was anchored to Lambda's 15min hard cap rather than the
//     workload — Go anchors to the workload (12min agent ceiling)
//     instead, leaving a 3min margin under Lambda's cap for the rest
//     of the workflow to finalize.
//
//   - StreamHeartbeatSeconds = 15 — matches the heartbeat cadence
//     in specs/nlp-go/_shared/contract.md §6. Heartbeats every 15s
//     mean a healthy stream never trips the idle timeout in practice;
//     idle is the safety net for client-side hangs / writer hangs.
//     Bumping the heartbeat would break clients that detect a dead
//     stream by missed heartbeats.
//
// Both values are observed by setting up a fresh defaultConfig()
// (package-private — tests in the same package have access without
// reaching into env-driven loading).
func TestEngineDefaults(t *testing.T) {
	cfg := defaultConfig()
	if cfg.Engine.StreamIdleTimeoutSeconds != 720 {
		t.Errorf("Engine.StreamIdleTimeoutSeconds = %d; want 720 (12min — must outlive the 12min slow-agent httpblock timeout)",
			cfg.Engine.StreamIdleTimeoutSeconds)
	}
	if cfg.Engine.StreamHeartbeatSeconds != 15 {
		t.Errorf("Engine.StreamHeartbeatSeconds = %d; want 15 to match contract.md §6",
			cfg.Engine.StreamHeartbeatSeconds)
	}
}

func TestGatewayEgressPolicyUsesGlobalEnvironmentNames(t *testing.T) {
	t.Setenv("BLOCK_LOCAL_HTTP_CALLS", "true")
	t.Setenv("REQUIRE_HTTPS_CUSTOM_ENDPOINTS", "true")
	t.Setenv("ALLOWED_PROXY_HOSTS", "llm.internal,10.0.0.5")

	cfg, err := LoadConfig(t.Context())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if !cfg.BlockLocalHTTPCalls {
		t.Error("BlockLocalHTTPCalls = false, want true")
	}
	if !cfg.RequireHTTPSCustomerEndpoints {
		t.Error("RequireHTTPSCustomerEndpoints = false, want true")
	}
	if cfg.AllowedProxyHosts != "llm.internal,10.0.0.5" {
		t.Errorf("AllowedProxyHosts = %q, want global ALLOWED_PROXY_HOSTS value", cfg.AllowedProxyHosts)
	}
}

// TestDeployedEnvNamesStillHydrate pins the exact variable names live
// deployments set. The root leaves are bare because `charts/langwatch/
// templates/langwatch_nlp/deployment.yaml` and
// `infra/docker/Dockerfile.langwatch_nlp` set them under those names; the
// engine leaves carry the NLPGO_ENGINE_ prefix the hydrator builds from the
// Engine field's own env tag. Renaming either half silently detaches a
// running deployment from its own configuration, which is why the names are
// asserted here rather than left to the struct tags alone.
//
// The full list, with defaults and read sites, is
// specs/nlp-go/_shared/contract.md §15.
func TestDeployedEnvNamesStillHydrate(t *testing.T) {
	t.Setenv("SERVER_ADDR", ":9999")
	t.Setenv("NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS", "11")
	t.Setenv("NLPGO_ENGINE_HTTP_BLOCK_TIMEOUT_SECONDS", "22")
	t.Setenv("NLPGO_ENGINE_AGENT_WORKFLOW_TIMEOUT_SECONDS", "33")
	t.Setenv("NLPGO_ENGINE_EVALUATOR_TIMEOUT_SECONDS", "44")
	t.Setenv("NLPGO_ENGINE_STREAM_HEARTBEAT_SECONDS", "55")
	t.Setenv("NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_SECONDS", "66")

	cfg, err := LoadConfig(t.Context())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}

	for _, tc := range []struct {
		name string
		got  any
		want any
	}{
		{"SERVER_ADDR", cfg.Server.Addr, ":9999"},
		{"NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS", cfg.Engine.CodeBlockTimeoutSeconds, 11},
		{"NLPGO_ENGINE_HTTP_BLOCK_TIMEOUT_SECONDS", cfg.Engine.HTTPBlockTimeoutSeconds, 22},
		{"NLPGO_ENGINE_AGENT_WORKFLOW_TIMEOUT_SECONDS", cfg.Engine.AgentWorkflowTimeoutSeconds, 33},
		{"NLPGO_ENGINE_EVALUATOR_TIMEOUT_SECONDS", cfg.Engine.EvaluatorTimeoutSeconds, 44},
		{"NLPGO_ENGINE_STREAM_HEARTBEAT_SECONDS", cfg.Engine.StreamHeartbeatSeconds, 55},
		{"NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_SECONDS", cfg.Engine.StreamIdleTimeoutSeconds, 66},
	} {
		if tc.got != tc.want {
			t.Errorf("%s hydrated to %v; want %v", tc.name, tc.got, tc.want)
		}
	}
}

// TestBlockTimeoutDefaultsMatchTodaysHardcodedValues guards the one way
// adding these knobs could have changed an existing deployment: if a default
// did not match the value its executor hardcoded before the knob existed,
// every unconfigured deployment would silently move to a new timeout.
func TestBlockTimeoutDefaultsMatchTodaysHardcodedValues(t *testing.T) {
	cfg := defaultConfig()
	const twelveMinutes = 720
	for _, tc := range []struct {
		name string
		got  int
	}{
		{"HTTPBlockTimeoutSeconds", cfg.Engine.HTTPBlockTimeoutSeconds},
		{"AgentWorkflowTimeoutSeconds", cfg.Engine.AgentWorkflowTimeoutSeconds},
		{"EvaluatorTimeoutSeconds", cfg.Engine.EvaluatorTimeoutSeconds},
	} {
		if tc.got != twelveMinutes {
			t.Errorf("Engine.%s = %d; want %d (12min — the value the executor hardcoded before the knob existed)",
				tc.name, tc.got, twelveMinutes)
		}
	}
}
