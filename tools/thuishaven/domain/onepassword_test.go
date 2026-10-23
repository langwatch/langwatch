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

func TestParseDotenvEntriesReadsMultiLineQuotedValues(t *testing.T) {
	text := "# c\nexport A_TOKEN='a b'\nB=plain # note\nPEM_PRIVATE_KEY=\"line1\nline2\"\nC=\"x\"\n"
	entries := ParseDotenvEntries(text)
	want := []DotenvEntry{
		{Key: "A_TOKEN", Value: "a b", First: 1, Last: 1},
		{Key: "B", Value: "plain", First: 2, Last: 2},
		{Key: "PEM_PRIVATE_KEY", Value: "line1\nline2", First: 3, Last: 4},
		{Key: "C", Value: "x", First: 5, Last: 5},
	}
	if len(entries) != len(want) {
		t.Fatalf("entries = %+v", entries)
	}
	for i := range want {
		if entries[i] != want[i] {
			t.Errorf("entry %d = %+v, want %+v", i, entries[i], want[i])
		}
	}
}

// @scenario "A connection string without a password is config"
func TestAConnectionStringWithoutAPasswordIsConfig(t *testing.T) {
	classes := map[string]SecretClass{"DATABASE_URL": ClassSecret}
	cases := []struct {
		key, value string
		want       bool
	}{
		{"DATABASE_URL", "postgresql://localhost:5432/langwatch", false},
		{"DATABASE_URL", "postgresql://app:hunter2@db:5432/langwatch", true},
		{"OPENAI_API_KEY", "sk-x", true},
		{"OPENAI_API_KEY", "", false},
		{"BASE_HOST", "http://localhost", false},
		{OnePasswordAccountKey, "acme", false},
	}
	for _, c := range cases {
		if got := CarriesCredential(classes, c.key, c.value); got != c.want {
			t.Errorf("CarriesCredential(%s) = %v, want %v", c.key, got, c.want)
		}
	}
}

func TestRewriteDotenvReplacesOrAppendsTheAccount(t *testing.T) {
	moved := map[string]bool{"A_TOKEN": true}
	got := RewriteDotenv("X=1\nA_TOKEN=\"a\nb\"\nLANGWATCH_OP_ACCOUNT=old\nY=2", moved, "acme")
	if want := "X=1\nLANGWATCH_OP_ACCOUNT=\"acme\"\nY=2"; got != want {
		t.Errorf("replace: got %q, want %q", got, want)
	}
	got = RewriteDotenv("X=1\nA_TOKEN=a", moved, "acme")
	if want := "X=1\nLANGWATCH_OP_ACCOUNT=\"acme\""; got != want {
		t.Errorf("append: got %q, want %q", got, want)
	}
}

func TestOnePasswordEnvInjectsOnlyWhatTheDeveloperLeftUnset(t *testing.T) {
	env := OnePasswordEnv(map[string]string{"B_TOKEN": "b", "A_TOKEN": "a"}, map[string]string{"B_TOKEN": "mine"})
	if len(env) != 1 || env[0] != "A_TOKEN=a" {
		t.Errorf("env = %v, want only A_TOKEN", env)
	}
}
