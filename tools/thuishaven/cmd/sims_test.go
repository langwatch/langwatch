package cmd

import (
	"slices"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// @scenario "Bare sim lists every simulator"
func TestSimsListsEverySimulatorWithItsStateAndVerbs(t *testing.T) {
	rows := simRows([]app.SessionServiceStatus{
		{Name: "mail", URL: "https://mail.s.langwatch.localhost", Up: true},
		{Name: "llm", URL: "https://llm.s.langwatch.localhost", Up: false},
	})
	if len(rows) != len(simulators) {
		t.Fatalf("got %d rows, want %d", len(rows), len(simulators))
	}
	byName := map[string]simRow{}
	for _, r := range rows {
		byName[r.Name] = r
		if len(r.Verbs) == 0 || r.Skill == "" {
			t.Errorf("%s: want verbs and a skill, got %+v", r.Name, r)
		}
	}
	if mail := byName["mail"]; !mail.Running || mail.Console != "https://mail.s.langwatch.localhost" || mail.Start != "" {
		t.Errorf("mail: got %+v", mail)
	}
	if llm := byName["llm"]; llm.Running || llm.Start != "haven up +llm" {
		t.Errorf("llm: got %+v", llm)
	}
	if !slices.Contains(byName["llm"].Verbs, "clear") || !slices.Contains(byName["idp"].Verbs, "list") {
		t.Errorf("verbs not read from the command table: llm %v, idp %v", byName["llm"].Verbs, byName["idp"].Verbs)
	}
}
