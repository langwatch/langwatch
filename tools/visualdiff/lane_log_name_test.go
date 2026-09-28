package visualdiff

import "testing"

func TestLaneLogNameCarriesNoColon(t *testing.T) {
	if got := laneLogName("base", "dev:app"); got != "base-dev-app.log" {
		t.Errorf("laneLogName(base, dev:app) = %q, want base-dev-app.log", got)
	}
}
