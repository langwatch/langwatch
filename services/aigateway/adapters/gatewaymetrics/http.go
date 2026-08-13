package gatewaymetrics

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
)

// dispatchLabels carries the provider and model a request resolved to.
// The HTTP middleware needs both to label the request counter, but they
// are only known deep in the dispatch pipeline, after routing and model
// resolution. The middleware seeds an empty holder on the request context
// on the way in and reads it in its deferred record on the way out; the
// pipeline fills it via SetDispatchLabels.
type dispatchLabels struct {
	mu       sync.Mutex
	provider string
	model    string
}

func (d *dispatchLabels) set(provider, model string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.provider, d.model = provider, model
}

func (d *dispatchLabels) get() (string, string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.provider, d.model
}

type dispatchLabelsKey struct{}

// SetDispatchLabels records the provider and model this request resolved
// to, so the request counter can be labeled with them. Model must already
// be sanitized (see SanitizeModel). A no-op when the request did not come
// through Middleware, which keeps the pipeline usable from unit tests.
func SetDispatchLabels(ctx context.Context, provider, model string) {
	if d, ok := ctx.Value(dispatchLabelsKey{}).(*dispatchLabels); ok {
		d.set(provider, model)
	}
}

type recorderKey struct{}

// ContextWithRecorder seeds rec on a context. Middleware calls it for every
// request; nothing else should, outside tests standing in for it.
func ContextWithRecorder(ctx context.Context, rec *Recorder) context.Context {
	return context.WithValue(ctx, recorderKey{}, rec)
}

// RecorderFromContext returns the recorder Middleware seeded on this
// request's context, or nil when the request did not come through
// Middleware. Every Recorder method is nil-safe, so a caller can record
// unconditionally.
//
// It exists for the layers that must record but cannot reach the wiring: the
// gateway's error choke point (httpapi.writeError) is reached from two dozen
// call sites, most of them helpers that were never given the router's
// dependencies, and the request context is the one thing all of them do hold.
// Same reasoning as SetDispatchLabels above, in the opposite direction.
func RecorderFromContext(ctx context.Context) *Recorder {
	rec, _ := ctx.Value(recorderKey{}).(*Recorder)
	return rec
}

// statusRecorder captures the response status for the request counter.
// The gateway's other ResponseWriter wrappers keep their status private,
// so this one stays deliberately minimal: status only, with Flush and
// Unwrap forwarded so streaming and http.ResponseController keep working
// through the chain.
type statusRecorder struct {
	http.ResponseWriter
	status  int
	written bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.written {
		s.status = code
		s.written = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if !s.written {
		s.status = http.StatusOK
		s.written = true
	}
	return s.ResponseWriter.Write(b)
}

func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// operationalPaths are the endpoints the cluster itself calls: the
// kubelet's probes and Prometheus' own scrape. They are deliberately left
// out of the request metrics. A probe every few seconds and a scrape every
// fifteen would dominate the counter, and because they essentially always
// return 200 they would dilute the error-rate ratio the documented
// GatewayHighErrorRate alert divides on, masking a real outage. They are
// kept off the in-flight gauge for the same reason: an operator watching a
// pod drain must see customer work finishing, not the scrape that is
// asking the question.
var operationalPaths = map[string]bool{
	"/metrics":  true,
	"/healthz":  true,
	"/readyz":   true,
	"/startupz": true,
	// The public status-page monitor's poll target. Same reasoning as the
	// probes: it always answers and would dilute the error-rate ratio.
	"/health": true,
}

// Middleware counts and times every request, and tracks how many are in
// flight. It labels by chi route pattern rather than raw path: the Gemini
// passthrough surface embeds the model id in the URL, so raw paths would
// mint a series per model per caller.
func Middleware(rec *Recorder) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if rec == nil {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if operationalPaths[r.URL.Path] {
				next.ServeHTTP(w, r)
				return
			}

			labels := &dispatchLabels{}
			ctx := context.WithValue(r.Context(), dispatchLabelsKey{}, labels)
			ctx = ContextWithRecorder(ctx, rec)

			sr := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			start := time.Now()
			rec.inFlight.Inc()

			defer func() {
				rec.inFlight.Dec()
				provider, model := labels.get()
				rec.ObserveHTTPRequest(routePattern(r), sr.status, provider, model, time.Since(start).Seconds())
			}()

			next.ServeHTTP(sr, r.WithContext(ctx))
		})
	}
}

// routePattern returns the chi pattern the request matched. chi only
// populates it once routing has run, so this is read after the handler
// returns. An unmatched request (a 404) has no pattern and folds onto the
// placeholder rather than echoing the caller's path back as a label.
func routePattern(r *http.Request) string {
	if rc := chi.RouteContext(r.Context()); rc != nil {
		if p := rc.RoutePattern(); p != "" {
			return p
		}
	}
	return unknownLabel
}
