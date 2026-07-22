package domain

import (
	"strings"
	"testing"
)

// @scenario "A fresh worktree starts lean"
func TestDefaultSelectionIsLean(t *testing.T) {
	sel := DefaultSelection()
	if !sel.Gateway || !sel.NLP {
		t.Error("gateway and nlp run by default")
	}
	if sel.Langy {
		t.Error("langy is opt-in — a fresh worktree must not start it")
	}
	if sel.Workers {
		t.Error("workers default to in-process, not a standalone lane")
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
		if err == nil || !strings.Contains(err.Error(), "workers, gateway, nlp, langy") {
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
		HasStandaloneWorkers: false,
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

func TestDescribeNamesTheDeltas(t *testing.T) {
	got := DefaultSelection().Describe()
	if !strings.Contains(got, "workers (in-process)") {
		t.Errorf("Describe() = %q, want the in-process workers note", got)
	}
	if !strings.Contains(got, "haven up +langy") {
		t.Errorf("Describe() = %q, want the exact delta that adds langy", got)
	}
}
