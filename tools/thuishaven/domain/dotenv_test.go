package domain

import (
	"strings"
	"testing"
)

// nodeParseEnvCases are what Node 24's util.parseEnv (node --env-file) answers
// for each text, checked by running it; the move must read every value the same.
var nodeParseEnvCases = []struct {
	name, text string
	want       map[string]string
}{
	{"double quotes expand \\n", `A="x\ny"`, map[string]string{"A": "x\ny"}},
	{"double quotes have no other escape", `A="a\tb"`, map[string]string{"A": `a\tb`}},
	{"a backslash before \\n stays", `A="a\\nb"`, map[string]string{"A": "a\\\nb"}},
	{"an escaped quote ends the value", `A="say \"hi\" there"`, map[string]string{"A": `say \`}},
	{"single quotes are literal", `A='x\ny'`, map[string]string{"A": `x\ny`}},
	{"backticks are literal", "A=`x 'y' \"z\"`", map[string]string{"A": `x 'y' "z"`}},
	{"double quotes span lines", "A=\"line1\nline2\"\nB=2", map[string]string{"A": "line1\nline2", "B": "2"}},
	{"single quotes span lines", "A='line1\nline2'\nB=2", map[string]string{"A": "line1\nline2", "B": "2"}},
	{"the last assignment wins", "A=1\nA=2", map[string]string{"A": "2"}},
	{"export is dropped", "export A=1", map[string]string{"A": "1"}},
	{"an unquoted value ends at #", "A=abc # note", map[string]string{"A": "abc"}},
	{"even with no space before #", "A=abc#note", map[string]string{"A": "abc"}},
	{"text after a closing quote is ignored", `A="abc" # note`, map[string]string{"A": "abc"}},
	{"# inside quotes is kept", `A="a # b"`, map[string]string{"A": "a # b"}},
	{"spaces around key and value go", "  A  =  abc  ", map[string]string{"A": "abc"}},
	{"an equals sign in the value stays", "A=b=c", map[string]string{"A": "b=c"}},
	{"CRLF line ends", "A=1\r\nB=2\r\n", map[string]string{"A": "1", "B": "2"}},
	{"an empty value", "A=", map[string]string{"A": ""}},
}

func TestParseDotenvEntriesReadsAsNodeDoes(t *testing.T) {
	for _, c := range nodeParseEnvCases {
		entries, err := ParseDotenvEntries(c.text)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		got := map[string]string{}
		for _, entry := range entries {
			got[entry.Key] = entry.Value // file order, so the last one wins as in Node
		}
		if len(got) != len(c.want) {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
		for key, want := range c.want {
			if value, ok := got[key]; !ok || value != want {
				t.Errorf("%s: %s = %q, want %q", c.name, key, value, want)
			}
		}
	}
}

func TestAnUnterminatedQuoteIsAnErrorNamingTheKeyNotTheValue(t *testing.T) {
	for _, text := range []string{"A_TOKEN=\"abc\nB=2", "A_TOKEN='abc\nB=2", "A_TOKEN=`abc"} {
		_, err := ParseDotenvEntries(text)
		if err == nil || !strings.Contains(err.Error(), "A_TOKEN") || strings.Contains(err.Error(), "abc") {
			t.Errorf("%q answered %v", text, err)
		}
	}
	if _, err := RewriteDotenv("A_TOKEN=\"abc", map[string]bool{"A_TOKEN": true}, "acme"); err == nil {
		t.Error("a rewrite went ahead over an unterminated quote")
	}
}

func TestParseDotenvEntriesSpansMultiLineValues(t *testing.T) {
	entries, err := ParseDotenvEntries("# c\nPEM_PRIVATE_KEY=\"line1\nline2\"\nC=x\n")
	if err != nil {
		t.Fatal(err)
	}
	want := []DotenvEntry{
		{Key: "PEM_PRIVATE_KEY", Value: "line1\nline2", First: 1, Last: 2},
		{Key: "C", Value: "x", First: 3, Last: 3},
	}
	if len(entries) != len(want) || entries[0] != want[0] || entries[1] != want[1] {
		t.Errorf("entries = %+v, want %+v", entries, want)
	}
}

func TestDotenvCredentialsTakeTheLastAssignment(t *testing.T) {
	entries, _ := ParseDotenvEntries("OPENAI_API_KEY=old\nOPENAI_API_KEY=new\n")
	found := DotenvCredentials(nil, entries)
	if len(found) != 1 || found[0].Value != "new" {
		t.Errorf("found = %+v, want the last assignment only", found)
	}
	got, err := RewriteDotenv("OPENAI_API_KEY=old\nX=1\nOPENAI_API_KEY=new\n", map[string]bool{"OPENAI_API_KEY": true}, "acme")
	if err != nil || got != "X=1\nLANGWATCH_OP_ACCOUNT=\"acme\"\n" {
		t.Errorf("rewrite = %q, %v; want every assignment of the moved key gone", got, err)
	}
}

// @scenario "A connection string without a password is config"
func TestAConnectionStringWithoutAPasswordIsConfig(t *testing.T) {
	classes := map[string]SecretClass{"DATABASE_URL": ClassSecret, "SLACK_CHANNEL_SIGNUPS": ClassSecret}
	cases := []struct {
		key, value string
		want       bool
	}{
		{"DATABASE_URL", "postgresql://localhost:5432/langwatch", false},
		{"DATABASE_URL", "postgresql://app:hunter2@db:5432/langwatch", true},
		{"SLACK_CHANNEL_SIGNUPS", "https://hooks.slack.com/services/T/B/x", true},
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
	got, _ := RewriteDotenv("X=1\nA_TOKEN=\"a\nb\"\nLANGWATCH_OP_ACCOUNT=old\nY=2\nLANGWATCH_OP_ACCOUNT=older", moved, "acme")
	if want := "X=1\nY=2\nLANGWATCH_OP_ACCOUNT=\"acme\""; got != want {
		t.Errorf("replace: got %q, want %q", got, want)
	}
	got, _ = RewriteDotenv("X=1\nA_TOKEN=a", moved, "acme")
	if want := "X=1\nLANGWATCH_OP_ACCOUNT=\"acme\""; got != want {
		t.Errorf("append: got %q, want %q", got, want)
	}
}
