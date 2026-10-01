package domain

import "testing"

// @scenario "A stack running langevals points the app at it"
func TestOverlayPointsLangevalsEndpointAtTheStacksOwnLangevals(t *testing.T) {
	base := Stack{Slug: "brave-otter", APIPort: 1}
	if hasKey(base.OverlayEnv(), "LANGEVALS_ENDPOINT") {
		t.Fatal("a stack without langevals must leave LANGEVALS_ENDPOINT to .env")
	}
	running := base
	running.Services = []Service{{Name: LangevalsService, Port: 45562}}
	if got := valueOf(running.OverlayEnv(), "LANGEVALS_ENDPOINT"); got != "http://127.0.0.1:45562" {
		t.Errorf("LANGEVALS_ENDPOINT = %q, want the lane's loopback port", got)
	}
}

// @scenario "Langevals is off until a worktree asks for it"
func TestLangevalsIsAnOffByDefaultSelection(t *testing.T) {
	if DefaultSelection().Langevals {
		t.Fatal("a fresh worktree must not pay for langevals")
	}
	sel, err := ApplySelectionDeltas(DefaultSelection(), []string{"+langevals"})
	if err != nil || !sel.Langevals {
		t.Fatalf("+langevals = %+v, %v; want it selected", sel, err)
	}
	if !SelectionFromStack(Stack{Services: []Service{{Name: LangevalsService, Port: 45562}}}).Langevals {
		t.Error("a stack running langevals must read back as selecting it")
	}
}
