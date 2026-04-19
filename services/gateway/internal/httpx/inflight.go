package httpx

import "net/http"

// Gauge is the minimal prometheus.Gauge surface InFlight needs. Keeping
// the httpx package free of a prometheus dep lets tests use a stub and
// keeps the import graph shallow.
type Gauge interface {
	Inc()
	Dec()
}

// InFlight wraps a handler so `gauge` tracks the count of requests
// currently being served. Inc on entry, Dec on exit (deferred so
// panics still decrement).
//
// The gauge is the primary drain-progress signal: operators watching a
// rollout expect in_flight to decrease to zero over the grace period.
// Paired with the `gateway_draining` gauge, stalling above zero during
// drain means handlers are stuck (upstream hang, breaker open w/o
// deadline) and the deploy will force-close them on grace expiry.
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
