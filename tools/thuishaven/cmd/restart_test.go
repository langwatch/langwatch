package cmd

import (
	"strings"
	"testing"
)

// The three scopes are one command with one flag vocabulary, not three
// commands: bare, one named service, and --unhealthy. -t follows afterwards and
// means what it means on `haven logs`.
// @scenario "Restarting is one verb with three scopes"
func TestRestartDeclaresTheThreeScopes(t *testing.T) {
	spec := specByName(t, "restart")

	if spec.maxArgs != 1 {
		t.Errorf("restart takes %d positionals, want the one optional service name", spec.maxArgs)
	}
	declared := map[string]flagSpec{}
	for _, f := range spec.flags {
		declared[f.long] = f
	}
	if _, ok := declared["--unhealthy"]; !ok {
		t.Error("restart does not declare --unhealthy — there is no way to bounce only what is broken")
	}
	tail, ok := declared["--tail"]
	if !ok {
		t.Fatal("restart does not declare --tail")
	}
	if tail.short != "-t" {
		t.Errorf("--tail's shorthand on restart is %q, want -t as everywhere else", tail.short)
	}
	if tail.takesValue {
		t.Error("--tail takes no value on logs, so it must take none here either")
	}
}

// doctor was two questions wearing one name; ADR-064 retired the spelling into
// `status`, which only ever reported. The pointer now names both halves, so the
// developer who types it lands on the one that heals.
// @scenario "Restarting is one verb with three scopes"
func TestDoctorPointsAtBothHalvesOfWhatItMeant(t *testing.T) {
	hint, gone := removed["doctor"]
	if !gone {
		t.Fatal("doctor is no longer a removed spelling — a healing verb must not be a second name for restart")
	}
	for _, want := range []string{"haven status", "haven restart --unhealthy"} {
		if !strings.Contains(hint, want) {
			t.Errorf("the doctor pointer %q does not name %q", hint, want)
		}
	}
}

// @scenario "Restarting can stay attached to what comes next"
func TestTailSubject(t *testing.T) {
	for _, tc := range []struct {
		name  string
		names []string
		want  string
	}{
		{name: "the whole stack", names: nil, want: "every service"},
		{name: "one service", names: []string{"nlp"}, want: "nlp"},
		{name: "two services", names: []string{"nlp", "gateway"}, want: "nlp and gateway"},
		{name: "more than two", names: []string{"nlp", "gateway", "api"}, want: "nlp and 2 others"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tailSubject(tc.names); got != tc.want {
				t.Errorf("tailSubject(%v) = %q, want %q", tc.names, got, tc.want)
			}
		})
	}
}

// --unhealthy picks its own targets, so naming one too is a contradiction
// rather than a refinement — and a silent winner between them would bounce
// something the developer did not ask for.
// @scenario "Restarting is one verb with three scopes"
func TestRestartRefusesUnhealthyWithAService(t *testing.T) {
	inv, err := parse(specByName(t, "restart"), []string{"--unhealthy", "nlp"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if err := runRestartCmd(t.Context(), deps{}, inv); err == nil {
		t.Error("restart --unhealthy nlp was accepted; it names two different target sets")
	}
}
