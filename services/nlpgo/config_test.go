package nlpgo

import (
	"testing"
)

// TestEngineDefaults_ParityWithLangwatchNLP pins the engine-level
// timeouts that have known parity contracts with langwatch_nlp:
//
//   - StreamIdleTimeoutSeconds = 900 — matches langwatch_nlp regression
//     57e6d1f1c ("increase WebSocket idle timeout from 120s to 900s")
//     so long-running code-node calls (8+ minute external agent calls)
//     are not killed prematurely. The Python path bumped from 120s to
//     match AWS Lambda's max execution timeout; a regression to a
//     shorter default would cause those workflows to fail silently.
//
//   - StreamHeartbeatSeconds = 15 — matches the Python heartbeat
//     cadence (specs/nlp-go/_shared/contract.md §6). Bumping it would
//     break clients that detect a dead stream by missed heartbeats.
//
// Both values are observed by setting up a fresh defaults() and
// inspecting the EngineConfig — the function is deliberately exposed
// so tests + integrators don't reach into env-driven loading.
func TestEngineDefaults_ParityWithLangwatchNLP(t *testing.T) {
	cfg := defaultConfig()
	if cfg.Engine.StreamIdleTimeoutSeconds != 900 {
		t.Errorf("Engine.StreamIdleTimeoutSeconds = %d; want 900 to match langwatch_nlp parity (regression 57e6d1f1c)",
			cfg.Engine.StreamIdleTimeoutSeconds)
	}
	if cfg.Engine.StreamHeartbeatSeconds != 15 {
		t.Errorf("Engine.StreamHeartbeatSeconds = %d; want 15 to match contract.md §6",
			cfg.Engine.StreamHeartbeatSeconds)
	}
}
