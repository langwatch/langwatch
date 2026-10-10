package diffkit

import (
	"strings"
	"testing"
)

func TestSuiteEnvRoundTrips(t *testing.T) {
	want := SharedStack{Slug: "s", AppURL: "https://app.s", MailURL: "https://mail.s", APIOrigin: "http://127.0.0.1:1"}
	for _, entry := range SuiteEnv(SuiteMain, want) {
		name, value, _ := strings.Cut(entry, "=")
		t.Setenv(name, value)
	}
	if got, ok := SuiteStack(SuiteMain); !ok || got != want {
		t.Fatalf("got %+v %v", got, ok)
	}
	if _, ok := SuiteStack(SuiteBranch); ok {
		t.Fatal("no branch was handed over")
	}
}
