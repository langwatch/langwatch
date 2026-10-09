package domain

import "testing"

// @scenario "The idp lane runs by default and can be turned off per worktree"
func TestIDPLaneRunsByDefault(t *testing.T) {
	if !DefaultSelection().IDP {
		t.Error("a fresh worktree must run the IdP simulator")
	}

	sel, err := ApplySelectionDeltas(DefaultSelection(), []string{"-idp"})
	if err != nil {
		t.Fatalf("-idp was rejected: %v", err)
	}
	if sel.IDP {
		t.Error("-idp did not turn the lane off")
	}

	sel, err = ApplySelectionDeltas(sel, []string{"+idp"})
	if err != nil {
		t.Fatalf("+idp was rejected: %v", err)
	}
	if !sel.IDP {
		t.Error("+idp did not turn the lane back on")
	}
}

// @scenario "The idp lane runs by default and can be turned off per worktree"
func TestIDPSelectionDerivesFromStack(t *testing.T) {
	st := Stack{Services: []Service{{Name: "idp", Port: 5565}}}
	if !SelectionFromStack(st).IDP {
		t.Error("a stack running idp locally must read back as selected")
	}
	fallback := Stack{Services: []Service{{Name: "idp", Port: 5565, IsFallback: true}}}
	if SelectionFromStack(fallback).IDP {
		t.Error("a baseline fallback must not read back as a local selection")
	}
}
