package httpmiddleware

import "net/http"

// Version sets a version header on every response.
func Version(header, version string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if version == "" {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set(header, version)
			next.ServeHTTP(w, r)
		})
	}
}
