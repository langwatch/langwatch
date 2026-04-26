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
