package httpmiddleware

import "net/http"

// Gauge is the minimal interface for an in-flight counter (e.g. prometheus.Gauge).
type Gauge interface {
	Inc()
	Dec()
}

// InFlight tracks concurrent request count via the given gauge.
func InFlight(gauge Gauge) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if gauge == nil {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gauge.Inc()
			defer gauge.Dec()
			next.ServeHTTP(w, r)
		})
	}
}
