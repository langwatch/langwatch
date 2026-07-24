package domain

import "testing"

// langyStack builds a minimal stack with the langyagent + gateway services on
// fixed ports, so the overlay's langy wiring can be asserted for a given tier.
func langyStack(tier LangyTier) Stack {
	return Stack{
		Slug: "happy-tiger", APIPort: 41001, LangyTier: tier,
		Services: []Service{
			{Name: "gateway", Port: 45000},
			{Name: "langyagent", Port: 46000},
		},
	}
}

func TestOverlayLangyIsolationNeverLeaks(t *testing.T) {
	// The langyagent-only isolation flag is set on the worker per tier by the plan,
	// never on the shared overlay the control plane reads.
	for _, tier := range []LangyTier{LangyTierSandboxed, LangyTierContainerUnsafe, LangyTierHostUnsafe} {
		t.Run("given the "+tier.String()+" tier", func(t *testing.T) {
			if keyPresent(langyStack(tier).OverlayEnv(), "LANGY_UNSAFE_DEV_DISABLE_ISOLATION") {
				t.Fatal("LANGY_UNSAFE_DEV_DISABLE_ISOLATION must never be in the overlay")
			}
		})
	}
}

func TestOverlayLangyWorkerOverrides(t *testing.T) {
	t.Run("given a container tier", func(t *testing.T) {
		for _, tier := range []LangyTier{LangyTierSandboxed, LangyTierContainerUnsafe} {
			t.Run("when tier is "+tier.String(), func(t *testing.T) {
				env := langyStack(tier).OverlayEnv()
				t.Run("points the worker callback at the host via host.docker.internal", func(t *testing.T) {
					if got := valueOf(env, "LANGY_WORKER_CALLBACK_URL"); got != "http://host.docker.internal:41001" {
						t.Fatalf("LANGY_WORKER_CALLBACK_URL = %q, want the API port on host.docker.internal", got)
					}
				})
				t.Run("points the worker gateway at the host via host.docker.internal", func(t *testing.T) {
					if got := valueOf(env, "LANGY_WORKER_GATEWAY_URL"); got != "http://host.docker.internal:45000" {
						t.Fatalf("LANGY_WORKER_GATEWAY_URL = %q, want the gateway port on host.docker.internal", got)
					}
				})
			})
		}
	})

	t.Run("given the host-unsafe tier", func(t *testing.T) {
		env := langyStack(LangyTierHostUnsafe).OverlayEnv()
		t.Run("emits no host.docker.internal overrides (the worker uses the portless URLs)", func(t *testing.T) {
			if keyPresent(env, "LANGY_WORKER_CALLBACK_URL") || keyPresent(env, "LANGY_WORKER_GATEWAY_URL") {
				t.Fatal("host tier must not emit the container callback/gateway overrides")
			}
		})
	})

	t.Run("still advertises OPENCODE_AGENT_URL and the internal secret in every tier", func(t *testing.T) {
		for _, tier := range []LangyTier{LangyTierSandboxed, LangyTierContainerUnsafe, LangyTierHostUnsafe} {
			env := langyStack(tier).OverlayEnv()
			if got := valueOf(env, "OPENCODE_AGENT_URL"); got != "http://127.0.0.1:46000" {
				t.Fatalf("[%s] OPENCODE_AGENT_URL = %q, want the langyagent loopback port", tier, got)
			}
			if valueOf(env, "LANGY_INTERNAL_SECRET") != DefaultLangyInternalSecret {
				t.Fatalf("[%s] LANGY_INTERNAL_SECRET missing", tier)
			}
		}
	})
}
