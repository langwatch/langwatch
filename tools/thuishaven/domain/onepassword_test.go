package domain

import (
	"encoding/json"
	"testing"
)

func TestOnePasswordFieldsSkipsNotesEmptyAndNonEnvLabels(t *testing.T) {
	raw := []byte(`{"fields":[
		{"label":"notesPlain","purpose":"NOTES","value":"hello"},
		{"label":"OPENAI_API_KEY","value":"sk"},
		{"label":"EMPTY_TOKEN","value":""},
		{"label":"not an env key","value":"x"}]}`)
	fields, err := OnePasswordFields(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(fields) != 1 || fields["OPENAI_API_KEY"] != "sk" {
		t.Errorf("fields = %v, want only OPENAI_API_KEY", fields)
	}
}

func TestMergeOnePasswordItemKeepsTheRestOfTheItem(t *testing.T) {
	raw := []byte(`{"id":"abc","vault":{"id":"v"},"fields":[{"id":"f1","label":"A_TOKEN","value":"old"},{"id":"f2","label":"B_TOKEN","value":"b"}]}`)
	merged, err := MergeOnePasswordItem(raw, map[string]string{"A_TOKEN": "new", "C_TOKEN": "c"})
	if err != nil {
		t.Fatal(err)
	}
	var item map[string]any
	if err := json.Unmarshal(merged, &item); err != nil {
		t.Fatal(err)
	}
	if item["id"] != "abc" || item["vault"] == nil {
		t.Error("the merge dropped the item's identity")
	}
	fields, _ := OnePasswordFields(merged)
	if fields["A_TOKEN"] != "new" || fields["B_TOKEN"] != "b" || fields["C_TOKEN"] != "c" {
		t.Errorf("merged fields = %v", fields)
	}
}

func TestOnePasswordEnvInjectsOnlyWhatTheDeveloperLeftUnset(t *testing.T) {
	env := OnePasswordEnv(map[string]string{"B_TOKEN": "b", "A_TOKEN": "a"}, map[string]string{"B_TOKEN": "mine"})
	if len(env) != 1 || env[0] != "A_TOKEN=a" {
		t.Errorf("env = %v, want only A_TOKEN", env)
	}
}
