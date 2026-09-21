package cmd

import (
	"strings"
	"testing"
)

func TestChooseFeaturesDefaultsToInstallingNothing(t *testing.T) {
	t.Run("given a developer who hits return through the prompts", func(t *testing.T) {
		var out strings.Builder
		chosen := chooseFeatures(strings.NewReader("\n\n\n"), &out)

		t.Run("when the picker finishes", func(t *testing.T) {
			t.Run("nothing is selected, because the safe direction is no", func(t *testing.T) {
				if len(chosen) != 0 {
					t.Fatalf("expected nothing chosen, got %v", chosen)
				}
			})

			t.Run("and every feature was described before being offered", func(t *testing.T) {
				if !strings.Contains(out.String(), "gate-hook") {
					t.Fatalf("expected the feature named, got %q", out.String())
				}
				if !strings.Contains(out.String(), "Install it? [y/N]") {
					t.Fatal("expected an explicit prompt with a no default")
				}
			})
		})
	})

	t.Run("given a developer who says yes", func(t *testing.T) {
		var out strings.Builder
		chosen := chooseFeatures(strings.NewReader("y\n"), &out)

		t.Run("that feature is selected", func(t *testing.T) {
			if len(chosen) != 1 || chosen[0] != "gate-hook" {
				t.Fatalf("expected gate-hook chosen, got %v", chosen)
			}
		})
	})

	t.Run("given input that ends mid-prompt", func(t *testing.T) {
		var out strings.Builder
		chosen := chooseFeatures(strings.NewReader(""), &out)

		t.Run("it declines the rest rather than erroring, leaving the machine untouched", func(t *testing.T) {
			if len(chosen) != 0 {
				t.Fatalf("expected nothing chosen, got %v", chosen)
			}
		})
	})
}
