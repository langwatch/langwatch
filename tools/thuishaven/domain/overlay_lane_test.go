package domain

import "testing"

// LaneEnv is the signal a nested `make service`/`make service-watch` checks
// before rendering a Go service's own JSON for a person (Makefile:141) - the
// same one dev/scripts/lane.sh sets for the plain `pnpm dev` path. Every
// child haven supervises already has haven's own renderer in front of it, so
// each must carry this line or its output is rendered twice.
func TestLaneEnv(t *testing.T) {
	t.Run("given a lane name", func(t *testing.T) {
		t.Run("names the LANGWATCH_LANE variable that variable", func(t *testing.T) {
			if got, want := LaneEnv("go"), "LANGWATCH_LANE=go"; got != want {
				t.Fatalf("LaneEnv(%q) = %q, want %q", "go", got, want)
			}
		})

		t.Run("carries the lane's own name, not a fixed one", func(t *testing.T) {
			if got, want := LaneEnv("idp"), "LANGWATCH_LANE=idp"; got != want {
				t.Fatalf("LaneEnv(%q) = %q, want %q", "idp", got, want)
			}
		})
	})
}
