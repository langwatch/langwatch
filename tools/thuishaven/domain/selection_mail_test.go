package domain

import "testing"

// @scenario "The mail lane runs by default and can be turned off per worktree"
func TestMailLaneRunsByDefault(t *testing.T) {
	if !DefaultSelection().Mail {
		t.Error("a fresh worktree must run the mail sink")
	}

	sel, err := ApplySelectionDeltas(DefaultSelection(), []string{"-mail"})
	if err != nil {
		t.Fatalf("-mail was rejected: %v", err)
	}
	if sel.Mail {
		t.Error("-mail did not turn the lane off")
	}

	sel, err = ApplySelectionDeltas(sel, []string{"+mail"})
	if err != nil {
		t.Fatalf("+mail was rejected: %v", err)
	}
	if !sel.Mail {
		t.Error("+mail did not turn the lane back on")
	}
}

func TestMailSelectionDerivesFromStack(t *testing.T) {
	st := Stack{Services: []Service{{Name: MailService, Port: 5580}}}
	if !SelectionFromStack(st).Mail {
		t.Error("a stack running the mail sink locally must read back as selected")
	}
	fallback := Stack{Services: []Service{{Name: MailService, Port: 5580, IsFallback: true}}}
	if SelectionFromStack(fallback).Mail {
		t.Error("a baseline fallback must not read back as a local selection")
	}
}

// mail was retired as the mail-room studio's old selector spelling; that
// rename freed the name for the actual mail lane, so "mail" must no longer be
// refused as a typo of "mail-room".
func TestMailIsNoLongerRefusedAsTheStudiosOldName(t *testing.T) {
	if _, refused := RetiredSelectionServices["mail"]; refused {
		t.Fatal(`"mail" is still listed as retired — it should select the mail sink lane now`)
	}
	if _, err := ApplySelectionDeltas(DefaultSelection(), []string{"+mail"}); err != nil {
		t.Fatalf("+mail was rejected: %v", err)
	}
}
