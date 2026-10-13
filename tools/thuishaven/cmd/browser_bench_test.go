package cmd

import (
	"os"
	"testing"
)

// The CLI half of every `haven browser` call: parse, build the request, print the reply.
func BenchmarkBrowserRequest(b *testing.B) {
	spec := browserSpec()
	b.ReportAllocs()
	for b.Loop() {
		inv, _ := parse(spec, []string{"click", "e12", "--lane", "qa-1", "--as", "admin"})
		if _, err := browserRequest("click", inv); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkObserveRequest(b *testing.B) {
	spec := browserSpec()
	b.ReportAllocs()
	for b.Loop() {
		inv, _ := parse(spec, []string{"network", "--lane", "qa-1", "--since-last", "--failed"})
		verb, inv, err := observeVerb(inv)
		if err != nil {
			b.Fatal(err)
		}
		if _, err := browserRequest(verb, inv); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkPrintAction(b *testing.B) {
	changes := make([]any, 40)
	for i := range changes {
		changes[i] = `~ button "Continue" [cursor=pointer] -> button "Continue" [active] [ref=e32] [cursor=pointer]`
	}
	reply := map[string]any{
		"url": "https://app.x.langwatch.localhost/settings", "title": "LangWatch",
		"changes":  changes,
		"requests": []any{"#425 POST /api/trpc/auth.route 200 24ms", "#426 GET /api/auth/session 200 9ms"},
		"errors":   []any{"[error] getScopeGraph 401"},
	}
	devnull, err := os.OpenFile(os.DevNull, os.O_WRONLY, 0)
	if err != nil {
		b.Fatal(err)
	}
	stdout := os.Stdout
	os.Stdout = devnull
	defer func() { os.Stdout = stdout; _ = devnull.Close() }()
	b.ReportAllocs()
	for b.Loop() {
		printAction(reply)
	}
}
