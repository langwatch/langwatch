package postgresbrew

import "testing"

func TestParseHealthReadsTheOneRow(t *testing.T) {
	got := parseHealth("postgresql@17", "14|t|19\n")
	if got.formula != "postgresql@14" || !got.untuned || got.databases != 19 {
		t.Errorf("parseHealth = %+v, want postgresql@14, untuned, 19 databases", got)
	}
}

func TestParseHealthKeepsTheFallbackOnAnUnreadableRow(t *testing.T) {
	got := parseHealth("postgresql@17", "")
	if got.formula != "postgresql@17" || got.untuned || got.databases != 0 {
		t.Errorf("parseHealth = %+v, want the fallback formula, tuned, no databases", got)
	}
}
