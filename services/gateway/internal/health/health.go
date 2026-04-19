// Package health provides liveness, readiness, and startup probes.
//
// /healthz: process alive. Never blocked on dependencies. k8s livenessProbe.
//
// /readyz:  dependencies OK — control plane reachable, key cache warmed OR
// redis reachable, bifrost dispatcher initialized, OTel pipeline up. k8s
// readinessProbe. Flips off transient dependency outages to shed traffic.
//
// /startupz: gate for startup completion — returns 200 once the cache has
// performed its first warmup pass. k8s startupProbe, fails-fast on deploy if
// the service can never serve traffic.
package health

import (
	"encoding/json"
	"net/http"
	"sync/atomic"
	"time"
)

type Check func() (ok bool, detail string)

type Registry struct {
	liveness  []namedCheck
	readiness []namedCheck
	startup   atomic.Bool
	// draining flips on SIGTERM. /readyz returns 503 ("draining") so the
	// load balancer removes the pod from endpoints before the HTTP
	// server stops accepting new connections. /healthz and /startupz are
	// unaffected — the pod is still alive and still started.
	draining  atomic.Bool
	version   string
	startedAt time.Time
}

type namedCheck struct {
	name string
	fn   Check
}

func New(version string) *Registry {
	return &Registry{version: version, startedAt: time.Now()}
}

// RegisterLiveness adds a liveness check. Liveness checks should be cheap and
// never depend on external systems; a liveness failure means the pod is
// broken and kubernetes will kill it.
func (r *Registry) RegisterLiveness(name string, fn Check) {
	r.liveness = append(r.liveness, namedCheck{name, fn})
}

// RegisterReadiness adds a readiness check. Readiness checks may depend on
// external systems; a failure means the pod should be removed from the load
// balancer until it recovers, but not killed.
func (r *Registry) RegisterReadiness(name string, fn Check) {
	r.readiness = append(r.readiness, namedCheck{name, fn})
}

// MarkStarted signals that startup is complete (e.g., key cache warmed).
// Until called, /startupz returns 503.
func (r *Registry) MarkStarted() { r.startup.Store(true) }

// Started returns whether startup has completed.
func (r *Registry) Started() bool { return r.startup.Load() }

// MarkDraining signals that SIGTERM has been received. Called once at
// shutdown; /readyz will return 503 on subsequent probes so the load
// balancer drains the pod before the HTTP server stops accepting
// connections.
func (r *Registry) MarkDraining() { r.draining.Store(true) }

// Draining reports whether drain has begun.
func (r *Registry) Draining() bool { return r.draining.Load() }

type response struct {
	Status     string            `json:"status"`
	Version    string            `json:"version"`
	UptimeS    float64           `json:"uptime_s"`
	Checks     map[string]string `json:"checks,omitempty"`
	FailedOnly bool              `json:"-"`
}

func (r *Registry) Liveness(w http.ResponseWriter, _ *http.Request) {
	writeChecks(w, r.version, time.Since(r.startedAt), r.liveness, false)
}

func (r *Registry) Readiness(w http.ResponseWriter, _ *http.Request) {
	if r.draining.Load() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(response{
			Status:  "draining",
			Version: r.version,
			UptimeS: time.Since(r.startedAt).Seconds(),
		})
		return
	}
	writeChecks(w, r.version, time.Since(r.startedAt), r.readiness, true)
}

func (r *Registry) Startup(w http.ResponseWriter, _ *http.Request) {
	if !r.Started() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(response{
			Status:  "starting",
			Version: r.version,
			UptimeS: time.Since(r.startedAt).Seconds(),
		})
		return
	}
	writeChecks(w, r.version, time.Since(r.startedAt), r.readiness, true)
}

func writeChecks(w http.ResponseWriter, version string, uptime time.Duration, checks []namedCheck, includeDetails bool) {
	results := make(map[string]string, len(checks))
	allOK := true
	for _, c := range checks {
		ok, detail := c.fn()
		if ok {
			results[c.name] = "ok"
		} else {
			results[c.name] = detail
			allOK = false
		}
	}
	w.Header().Set("Content-Type", "application/json")
	if !allOK {
		w.WriteHeader(http.StatusServiceUnavailable)
	} else {
		w.WriteHeader(http.StatusOK)
	}
	resp := response{
		Status:  statusWord(allOK),
		Version: version,
		UptimeS: uptime.Seconds(),
	}
	if includeDetails || !allOK {
		resp.Checks = results
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func statusWord(ok bool) string {
	if ok {
		return "ok"
	}
	return "degraded"
}
