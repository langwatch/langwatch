package domain

import "testing"

func TestStackHomeServiceIsTheBareSlug(t *testing.T) {
	n := DefaultNaming("localhost")
	name, ok := n.StackHomeService("feat-x")
	if !ok || n.Hostname(name, "") != "feat-x.langwatch.localhost" {
		t.Fatalf("StackHomeService(feat-x) = %q, %v; want the host feat-x.langwatch.localhost", name, ok)
	}
	if n.RouteName(name, "") != "feat-x.langwatch" {
		t.Errorf("route name = %q, want feat-x.langwatch (the shape portless takes for hub.langwatch)", n.RouteName(name, ""))
	}
}

func TestStackHomeServiceRefusesMachineWideNames(t *testing.T) {
	n := DefaultNaming("localhost")
	for _, slug := range []string{"hub", "idp", "observability", "telemetry", "langwatch", "", "Not_A_Label"} {
		if name, ok := n.StackHomeService(slug); ok {
			t.Errorf("StackHomeService(%q) = %q, want no home: it would shadow a machine-wide surface or is not a label", slug, name)
		}
	}
}

func TestStackHomeSlugReadsTheHost(t *testing.T) {
	n := DefaultNaming("localhost")
	cases := map[string]string{
		"feat-x.langwatch.localhost":      "feat-x",
		"FEAT-X.langwatch.localhost:1355": "feat-x",
		"hub.langwatch.localhost":         "",
		"langwatch.localhost":             "",
		"app.feat-x.langwatch.localhost":  "",
		"127.0.0.1:4000":                  "",
		"feat-x.example.com":              "",
	}
	for host, want := range cases {
		got, ok := n.StackHomeSlug(host)
		if got != want || ok != (want != "") {
			t.Errorf("StackHomeSlug(%q) = %q, %v; want %q", host, got, ok, want)
		}
	}
}
