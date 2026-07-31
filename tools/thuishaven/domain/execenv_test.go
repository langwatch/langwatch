package domain

import (
	"slices"
	"testing"
)

// @scenario "an inline variable still wins over the overlay"
func TestExecEnvLetsAnInlineVariableWin(t *testing.T) {
	t.Run("when the shell already exports the key", func(t *testing.T) {
		env := ExecEnv(
			[]string{"DATABASE_URL=postgres://inline"},
			map[string]string{"DATABASE_URL": "postgres://overlay"},
		)
		if !slices.Contains(env, "DATABASE_URL=postgres://inline") {
			t.Errorf("inline value lost: %v", env)
		}
		if slices.Contains(env, "DATABASE_URL=postgres://overlay") {
			t.Errorf("overlay shadowed the inline value: %v", env)
		}
	})

	t.Run("when the exported value is empty it still counts as set", func(t *testing.T) {
		// Exporting an empty value is how a shell says "not this one" — treating
		// it as absent would quietly hand the variable back to the overlay.
		env := ExecEnv([]string{"HTTP_PROXY="}, map[string]string{"HTTP_PROXY": "http://overlay"})
		if slices.Contains(env, "HTTP_PROXY=http://overlay") {
			t.Errorf("an exported empty value was overridden: %v", env)
		}
	})
}

// @scenario "an inline variable still wins over the overlay"
func TestExecEnvSuppliesOnlyWhatTheShellDidNot(t *testing.T) {
	env := ExecEnv(
		[]string{"PATH=/usr/bin"},
		map[string]string{"NODE_EXTRA_CA_CERTS": "/ca.pem", "PATH": "/overlay/bin"},
	)
	if !slices.Contains(env, "NODE_EXTRA_CA_CERTS=/ca.pem") {
		t.Errorf("overlay-only variable missing: %v", env)
	}
	if !slices.Contains(env, "PATH=/usr/bin") {
		t.Errorf("PATH should have stayed the shell's: %v", env)
	}
}

// @scenario "one command runs anything against the stack"
func TestExecEnvOrdersOverlayKeysTheSameEveryRun(t *testing.T) {
	// Map iteration order is randomized, so without the sort a child's
	// environment would differ run to run for no reason at all.
	dotenv := map[string]string{"B": "2", "A": "1", "C": "3", "D": "4", "E": "5"}
	first := ExecEnv(nil, dotenv)
	for range 20 {
		if got := ExecEnv(nil, dotenv); !slices.Equal(got, first) {
			t.Fatalf("environment varies between runs:\n %v\n %v", first, got)
		}
	}
}
