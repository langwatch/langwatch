package disposabledomains_test

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/disposabledomains"
)

func TestParseListNormalisesDeduplicatesAndSorts(t *testing.T) {
	domains, err := disposabledomains.ParseList("# comment\nZeta.example\n\n alpha.example \nzeta.example\n", 1)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(domains, ","); got != "alpha.example,zeta.example" {
		t.Fatalf("got %s", got)
	}
}

func TestParseListRefusesAMalformedDomain(t *testing.T) {
	if _, err := disposabledomains.ParseList("ok.example\nnot a domain\n", 1); err == nil {
		t.Fatal("expected a malformed domain to be refused")
	}
}

func TestParseListRefusesAListThatShrankTooFar(t *testing.T) {
	if _, err := disposabledomains.ParseList("one.example\n", 2); err == nil {
		t.Fatal("expected a short list to be refused")
	}
}

func TestRenderJSONMatchesTheCheckedInShape(t *testing.T) {
	rendered, err := disposabledomains.RenderJSON([]string{"a.example", "b.example"})
	if err != nil {
		t.Fatal(err)
	}
	if want := "[\n  \"a.example\",\n  \"b.example\"\n]\n"; string(rendered) != want {
		t.Fatalf("got %q", rendered)
	}
}
