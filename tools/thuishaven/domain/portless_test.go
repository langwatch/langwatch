package domain

import "testing"

// The pin is the whole contract: it is recorded in exactly one place and every
// decision below reads it, so a bump cannot leave half the code on the old
// version. Nothing here touches npm or the network — the decision is pure.
func TestPlanPortless(t *testing.T) {
	t.Run("given no portless on the machine", func(t *testing.T) {
		t.Run("when planning the bootstrap", func(t *testing.T) {
			if got := PlanPortless(false, ""); got != PortlessInstall {
				t.Fatalf("missing portless must be installed, got %v", got)
			}
		})
	})

	t.Run("given portless already at the pinned version", func(t *testing.T) {
		t.Run("when planning the bootstrap", func(t *testing.T) {
			if got := PlanPortless(true, PortlessVersion); got != PortlessReady {
				t.Fatalf("the pinned version must be left alone, got %v", got)
			}
		})
		t.Run("when the binary prints it v-prefixed or in a banner", func(t *testing.T) {
			for _, raw := range []string{"v" + PortlessVersion, "portless " + PortlessVersion, "  " + PortlessVersion + "\n"} {
				if got := PlanPortless(true, raw); got != PortlessReady {
					t.Fatalf("%q reports the pinned version, got %v", raw, got)
				}
			}
		})
	})

	t.Run("given portless at another version", func(t *testing.T) {
		t.Run("when planning the bootstrap", func(t *testing.T) {
			if got := PlanPortless(true, "0.0.1"); got != PortlessUpgrade {
				t.Fatalf("another version must be upgraded to the pin, got %v", got)
			}
		})
	})

	t.Run("given a portless that will not report a version", func(t *testing.T) {
		t.Run("when planning the bootstrap", func(t *testing.T) {
			if got := PlanPortless(true, ""); got != PortlessUnknownVersion {
				t.Fatalf("an unreadable version must not be reinstalled every up, got %v", got)
			}
		})
	})
}

func TestPortlessPackagePinsTheRecordedVersion(t *testing.T) {
	if got, want := PortlessPackage(), "portless@"+PortlessVersion; got != want {
		t.Fatalf("install spec %q must pin the recorded version %q", got, want)
	}
}
