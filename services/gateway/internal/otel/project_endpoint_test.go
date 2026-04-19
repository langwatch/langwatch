package otel

import "testing"

func TestProjectEndpointRegistry_SetLookup(t *testing.T) {
	r := NewProjectEndpointRegistry()
	r.Set("proj_01", "https://otlp-a.example/v1/traces", map[string]string{"x-lw-project": "proj_01"})
	ep, hdrs, ok := r.Lookup("proj_01")
	if !ok || ep != "https://otlp-a.example/v1/traces" {
		t.Fatalf("want proj_01 endpoint, got ep=%q ok=%v", ep, ok)
	}
	if hdrs["x-lw-project"] != "proj_01" {
		t.Errorf("header not stored: %+v", hdrs)
	}
	if _, _, ok := r.Lookup("proj_missing"); ok {
		t.Error("missing project should return ok=false")
	}
}

func TestProjectEndpointRegistry_EmptyEndpointClears(t *testing.T) {
	r := NewProjectEndpointRegistry()
	r.Set("proj_01", "https://otlp.example", nil)
	r.Set("proj_01", "", nil) // clear
	if _, _, ok := r.Lookup("proj_01"); ok {
		t.Error("empty endpoint should remove the entry (router falls back to default)")
	}
	if r.Len() != 0 {
		t.Errorf("want empty registry, got Len=%d", r.Len())
	}
}

func TestProjectEndpointRegistry_EmptyProjectIgnored(t *testing.T) {
	r := NewProjectEndpointRegistry()
	r.Set("", "https://ignored", nil)
	if r.Len() != 0 {
		t.Errorf("empty project_id should be a no-op, got Len=%d", r.Len())
	}
}
