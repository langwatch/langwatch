package httpx

import "net/http"

// Version sets X-LangWatch-Gateway-Version on every response. Gives
// operators and client SDKs a cheap breadcrumb to answer "which
// deployment served this request" without needing access-log
// correlation, and lets customer SDKs version-gate on header presence.
//
// Empty version string = passthrough (tests / local dev usually run
// with Version="dev"; callers choose whether "dev" is a signal worth
// emitting).
func Version(version string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if version == "" {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-LangWatch-Gateway-Version", version)
			next.ServeHTTP(w, r)
		})
	}
}
