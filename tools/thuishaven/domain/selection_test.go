package domain

import (
	"strings"
	"testing"
)

// @scenario "A fresh worktree starts lean"
func TestDefaultSelectionIsLean(t *testing.T) {
	sel := DefaultSelection()
	if !sel.Gateway || !sel.NLP || !sel.IDP {
		t.Error("gateway, nlp and the idp simulator run by default")
	}
	if sel.Langy {
		t.Error("langy is opt-in — a fresh worktree must not start it")
	}
}

// The workers lane is not selectable any more: the background worker is its own
// application, so every stack runs it. The delta has to be refused BY NAME
// rather than falling through to "unknown service", which reads as a typo — and
// the failure it prevents is the silent one, a stack that boots and quietly
// processes no jobs.
//
// @scenario "A retired service delta is refused by name"
func TestWorkersIsNoLongerSelectable(t *testing.T) {
	for _, delta := range []string{"+workers", "-workers"} {
		_, err := ApplySelectionDeltas(DefaultSelection(), []string{delta})
		if err == nil {
			t.Fatalf("%s was accepted; the workers lane always runs", delta)
		}
		if !strings.Contains(err.Error(), "its own process") {
			t.Errorf("%s error = %q, want it to say the worker is its own process", delta, err)
		}
	}
}

// @scenario "Adding a service is one word and it sticks"
// @scenario "Removing a service is the same shape"
func TestApplySelectionDeltas(t *testing.T) {
	t.Run("when adding langy and removing nlp", func(t *testing.T) {
		sel, err := ApplySelectionDeltas(DefaultSelection(), []string{"+langy", "-nlp"})
		if err != nil {
			t.Fatalf("ApplySelectionDeltas: %v", err)
		}
		if !sel.Langy || sel.NLP {
			t.Errorf("got %+v, want langy on and nlp off", sel)
		}
		if !sel.Gateway {
			t.Error("untouched services must keep their state")
		}
	})

	t.Run("when naming an unknown service, it fails listing the valid ones", func(t *testing.T) {
		_, err := ApplySelectionDeltas(DefaultSelection(), []string{"+nlpgo"})
		if err == nil || !strings.Contains(err.Error(), "gateway, nlp, langy, idp") {
			t.Fatalf("want the service list in the error, got %v", err)
		}
	})

	t.Run("when the argument is not a delta, it fails with the shape", func(t *testing.T) {
		_, err := ApplySelectionDeltas(DefaultSelection(), []string{"langy"})
		if err == nil || !strings.Contains(err.Error(), "+service") {
			t.Fatalf("want the +service hint, got %v", err)
		}
	})
}

// @scenario "Up reconciles a running stack"
func TestSelectionFromStack(t *testing.T) {
	st := Stack{
		Services: []Service{
			{Name: "app", Port: 100},
			{Name: "gateway", Port: 101},
			{Name: "nlp", Port: 0},                            // opted out, no baseline
			{Name: "langyagent", Port: 103, IsFallback: true}, // baseline fallback ≠ running here
		},
	}
	sel := SelectionFromStack(st)
	if !sel.Gateway {
		t.Error("a locally-served gateway is part of the selection")
	}
	if sel.NLP {
		t.Error("a port-less service is not running here")
	}
	if sel.Langy {
		t.Error("a baseline fallback is not running here")
	}
}

// Describe is the line `haven status` prints for the current worktree, so an
// unselected service has to carry the exact command that adds it — the report is
// the only place the selection is discoverable.
//
// @scenario "Status shows the selection"
func TestDescribeNamesTheDeltas(t *testing.T) {
	got := DefaultSelection().Describe()
	for _, on := range []string{"ui", "api", "workers", "gateway", "nlp"} {
		if !strings.Contains(got, on) {
			t.Errorf("Describe() = %q, want the selected service %q named", got, on)
		}
	}
	if !strings.Contains(got, "haven up +langy") {
		t.Errorf("Describe() = %q, want the exact delta that adds langy", got)
	}
}
