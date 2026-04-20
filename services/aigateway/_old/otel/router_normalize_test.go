package otel

import "testing"

func TestNormalizeTraceEndpoint(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"empty stays empty", "", ""},
		{"base gets path appended", "http://localhost:5560/api/otel", "http://localhost:5560/api/otel/v1/traces"},
		{"base with trailing slash", "http://localhost:5560/api/otel/", "http://localhost:5560/api/otel/v1/traces"},
		{"already points at /v1/traces", "http://localhost:5560/api/otel/v1/traces", "http://localhost:5560/api/otel/v1/traces"},
		{"trailing slash on full path", "http://localhost:5560/api/otel/v1/traces/", "http://localhost:5560/api/otel/v1/traces"},
		{"host only", "https://otlp.example.com", "https://otlp.example.com/v1/traces"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := normalizeTraceEndpoint(tc.in); got != tc.want {
				t.Errorf("normalizeTraceEndpoint(%q) = %q; want %q", tc.in, got, tc.want)
			}
		})
	}
}
