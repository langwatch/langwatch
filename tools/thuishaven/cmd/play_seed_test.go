package cmd

import (
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// The sandbox seeds from the same registry as `haven db seed` — one list, one
// meaning, whichever command asks for it (ADR-064).
// @scenario "An unknown preset is rejected before anything is created"
func TestPlaySeedFlagTakesTheSharedPresets(t *testing.T) {
	spec := specByName(t, "play")
	var seed *flagSpec
	for i := range spec.flags {
		if spec.flags[i].long == "--seed" {
			seed = &spec.flags[i]
		}
	}
	if seed == nil {
		t.Fatal("play does not declare --seed — a sandbox would always open on the onboarding screen")
	}
	if !seed.takesValue {
		t.Error("--seed takes a preset name; a valueless flag would have to pick one for the developer")
	}
	for _, name := range app.SeedPresetNames() {
		if !strings.Contains(seed.summary, name) {
			t.Errorf("--seed's help %q does not offer %q", seed.summary, name)
		}
	}

	t.Run("given a preset that is not in the registry", func(t *testing.T) {
		t.Run("when play parses it, the value is rejected rather than passed on", func(t *testing.T) {
			inv, err := parse(spec, []string{"4913", "--seed", "nosuch"})
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			// runPlay validates this before it looks the PR up, so a typo costs a
			// line of output rather than a checkout and a container set.
			if app.ValidateSeedPreset(inv.value("--seed")) == nil {
				t.Error("a preset outside the registry was accepted")
			}
		})
	})
}

// The launcher is a separate process, so a preset the parent parsed and did not
// pass on would be silently dropped — the sandbox would come up empty with no
// sign anything was asked for.
// @scenario "The preset reaches the backgrounded launcher"
func TestPresetTravelsToTheBackgroundedLauncher(t *testing.T) {
	t.Run("given a preset", func(t *testing.T) {
		argv := playLaunchArgs(4913, "demo")
		if !slices.Equal(argv, []string{"4913", "demo"}) {
			t.Fatalf("launcher argv = %v, want the number then the preset", argv)
		}
		inv, err := parse(specByName(t, "play-launch"), argv)
		if err != nil {
			t.Fatalf("the launcher rejects what play sends it: %v", err)
		}
		if len(inv.args) != 2 || inv.args[1] != "demo" {
			t.Errorf("launcher args = %v, want the preset as the second positional", inv.args)
		}
	})

	t.Run("given no preset", func(t *testing.T) {
		argv := playLaunchArgs(4913, "")
		if !slices.Equal(argv, []string{"4913"}) {
			t.Fatalf("launcher argv = %v, want the number alone — never an empty preset", argv)
		}
		if _, err := parse(specByName(t, "play-launch"), argv); err != nil {
			t.Fatalf("the launcher rejects a plain sandbox: %v", err)
		}
	})
}
