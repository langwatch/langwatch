package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
)

// The relay names a read-only turn's calls with the Langy mirror header. The
// middleware lifts it into the request context for the emitter and deletes it,
// so it never travels to the provider.
// @scenario "A read-only run's model calls never reach the mirror"
func TestCustomerTraceMiddleware_LiftsTheWithheldMirror(t *testing.T) {
	cases := []struct {
		name     string
		value    string
		withheld bool
	}{
		{name: "skip withholds the mirror", value: "skip", withheld: true},
		{name: "no header leaves the mirror to the key's tier", value: "", withheld: false},
		{name: "an unknown value withholds nothing", value: "content", withheld: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var withheld bool
			var forwarded http.Header
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				withheld = customertracebridge.MirrorWithheld(r.Context())
				forwarded = r.Header.Clone()
			})
			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			if tc.value != "" {
				req.Header.Set(customertracebridge.HeaderLangyMirror, tc.value)
			}

			CustomerTraceMiddleware()(next).ServeHTTP(httptest.NewRecorder(), req)

			if withheld != tc.withheld {
				t.Fatalf("withheld = %v, want %v", withheld, tc.withheld)
			}
			if got := forwarded.Get(customertracebridge.HeaderLangyMirror); got != "" {
				t.Fatalf("the mirror header survived the middleware: %q", got)
			}
		})
	}
}
