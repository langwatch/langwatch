package domain

import (
	"strings"
	"testing"
)

// checkoutWith answers DetectLayout's question for a fixed set of directories,
// so the decision is exercised without a tree on disk.
func checkoutWith(dirs ...string) func(string) bool {
	present := map[string]bool{}
	for _, d := range dirs {
		present[d] = true
	}
	return func(rel string) bool { return present[rel] }
}

// This branch's checkout: two application packages, two Node lanes.
//
// @scenario "A checkout with the two application packages is modular"
func TestDetectLayoutReadsTheTwoApplicationPackagesAsModular(t *testing.T) {
	t.Run("given a checkout with apps/ui and apps/api", func(t *testing.T) {
		t.Run("when the layout is detected, it is modular", func(t *testing.T) {
			if got := DetectLayout(checkoutWith(ModularUIDir, ModularAPIDir)); got != LayoutModular {
				t.Errorf("layout = %q, want %q", got, LayoutModular)
			}
		})
	})
}

// origin/main's checkout: one package serving the browser application and its
// API together, and neither application package to filter on.
//
// @scenario "A checkout with the monolith package is a monolith"
func TestDetectLayoutReadsTheMonolithPackageAsAMonolith(t *testing.T) {
	t.Run("given a checkout with platform/app and neither application package", func(t *testing.T) {
		t.Run("when the layout is detected, it is a monolith", func(t *testing.T) {
			if got := DetectLayout(checkoutWith(MonolithDir)); got != LayoutMonolith {
				t.Errorf("layout = %q, want %q", got, LayoutMonolith)
			}
		})
	})
}

// A half-renamed tree, or one that is neither, is not guessed at: it is
// planned as the layout this haven belongs to, and fails on its own lane's
// error rather than on a guess made here.
//
// @scenario "A checkout with neither shape is treated as modular"
func TestDetectLayoutFallsBackToModular(t *testing.T) {
	t.Run("given a checkout with no recognizable application package", func(t *testing.T) {
		t.Run("when the layout is detected, it is modular", func(t *testing.T) {
			if got := DetectLayout(checkoutWith("docs")); got != LayoutModular {
				t.Errorf("layout = %q, want %q", got, LayoutModular)
			}
			if got := DetectLayout(checkoutWith(ModularUIDir)); got != LayoutModular {
				t.Errorf("a half-modular checkout = %q, want %q", got, LayoutModular)
			}
		})
	})
}

// @scenario "The ui lane cannot be selected on a monolith stack"
func TestMonolithRefusesTheUILaneByName(t *testing.T) {
	t.Run("given a monolith checkout", func(t *testing.T) {
		t.Run("when a developer asks for the ui lane, it is refused by name", func(t *testing.T) {
			_, err := ApplySelectionDeltasForLayout(DefaultSelection(), []string{"-ui"}, LayoutMonolith)
			if err == nil {
				t.Fatal("-ui was accepted on a monolith stack, which has no ui lane to turn off")
			}
			if !strings.Contains(err.Error(), MonolithAppLane) {
				t.Errorf("refusal %q does not name the app lane, so it reads as a typo", err)
			}
			if strings.Contains(err.Error(), "unknown service") {
				t.Errorf("refusal %q is the generic error; the layout is what decides here", err)
			}
		})
		t.Run("when a real service is asked for, it is not refused", func(t *testing.T) {
			if _, err := ApplySelectionDeltasForLayout(DefaultSelection(), []string{"+gateway"}, LayoutMonolith); err != nil {
				t.Errorf("a real service was refused too: %v", err)
			}
		})
	})
}

// @scenario "The backend lane cannot be selected on a monolith stack"
func TestMonolithRefusesTheBackendLaneByName(t *testing.T) {
	t.Run("given a monolith checkout", func(t *testing.T) {
		t.Run("when a developer asks for the backend lane, it is refused by name", func(t *testing.T) {
			_, err := ApplySelectionDeltasForLayout(DefaultSelection(), []string{"+backend"}, LayoutMonolith)
			if err == nil {
				t.Fatal("+backend was accepted on a monolith stack, which has no backend lane")
			}
			if !strings.Contains(err.Error(), MonolithAppLane) {
				t.Errorf("refusal %q does not name the app lane", err)
			}
		})
	})
}
