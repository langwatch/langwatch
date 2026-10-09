package domain

import "testing"

// idpStack builds a stack whose IdP simulator is routed and has a nameserver,
// which is the shape a worktree running the idp lane ends up with.
func idpStack(idp Service) Stack {
	return Stack{
		Slug:     "happy-tiger",
		APIPort:  41001,
		Services: []Service{{Name: "app", Port: 44000}, idp},
	}
}

func TestOverlayIdPSimulatorWiring(t *testing.T) {
	t.Run("given a worktree running the IdP simulator", func(t *testing.T) {
		env := idpStack(Service{
			Name:    "idp",
			Port:    45500,
			DNSPort: 45501,
			URL:     "https://idp.happy-tiger.langwatch.localhost",
		}).OverlayEnv()

		t.Run("trusts the simulator's origin, or discovery is refused before it is fetched", func(t *testing.T) {
			if got := valueOf(env, "SSO_TRUSTED_IDP_ORIGINS"); got != "https://idp.happy-tiger.langwatch.localhost" {
				t.Fatalf("SSO_TRUSTED_IDP_ORIGINS = %q, want the simulator's own URL", got)
			}
		})

		t.Run("points domain proofs at the simulator's nameserver, not the machine's", func(t *testing.T) {
			if got := valueOf(env, "SSO_DOMAIN_PROOF_DNS_SERVERS"); got != "127.0.0.1:45501" {
				t.Fatalf("SSO_DOMAIN_PROOF_DNS_SERVERS = %q, want the allocated nameserver", got)
			}
		})
	})

	t.Run("given a worktree with no IdP simulator", func(t *testing.T) {
		env := idpStack(Service{Name: "idp"}).OverlayEnv()

		// A dead pointer is worse than none: the app would refuse every real
		// issuer's discovery while trusting an origin nothing is serving, and
		// resolve domain proofs against a port nobody is listening on.
		for _, name := range []string{
			"LANGWATCH_IDPSIM_URL",
			"SSO_TRUSTED_IDP_ORIGINS",
			"SSO_DOMAIN_PROOF_DNS_SERVERS",
		} {
			t.Run("emits no "+name, func(t *testing.T) {
				if keyPresent(env, name) {
					t.Fatalf("%s must not be emitted when no simulator is reachable", name)
				}
			})
		}
	})

	t.Run("given a simulator whose nameserver could not be allocated", func(t *testing.T) {
		env := idpStack(Service{
			Name: "idp",
			Port: 45500,
			URL:  "https://idp.happy-tiger.langwatch.localhost",
		}).OverlayEnv()

		t.Run("still trusts it, because OIDC does not need the nameserver", func(t *testing.T) {
			if !keyPresent(env, "SSO_TRUSTED_IDP_ORIGINS") {
				t.Fatal("a simulator without DNS still terminates sign-ins")
			}
		})

		t.Run("names no resolver rather than one nothing answers on", func(t *testing.T) {
			if keyPresent(env, "SSO_DOMAIN_PROOF_DNS_SERVERS") {
				t.Fatal("a resolver override pointing at nothing fails every proof")
			}
		})
	})
}

func TestBaselineServiceCarriesEveryEndpoint(t *testing.T) {
	alive := func(int) bool { return true }
	baseline := []Stack{{
		IsBaseline:  true,
		LauncherPID: 1,
		Services: []Service{
			{Name: "idp", Port: 45500, DNSPort: 45501},
		},
	}}

	t.Run("given a worktree falling back to a baseline's simulator", func(t *testing.T) {
		svc, ok := BaselineService(baseline, "idp", alive)
		if !ok {
			t.Fatal("the baseline's simulator was not found")
		}

		// Taking the HTTP port alone would leave the fallback resolving domain
		// proofs against a nameserver this worktree allocated for a simulator
		// it never started.
		t.Run("carries the baseline's nameserver too", func(t *testing.T) {
			if svc.DNSPort != 45501 {
				t.Fatalf("DNSPort = %d, want the baseline's nameserver", svc.DNSPort)
			}
		})
	})

	t.Run("given a caller that only routes a hostname", func(t *testing.T) {
		t.Run("answers the port on its own", func(t *testing.T) {
			if port, ok := BaselinePort(baseline, "idp", alive); !ok || port != 45500 {
				t.Fatalf("BaselinePort = %d, %v; want the baseline's HTTP port", port, ok)
			}
		})
	})
}
