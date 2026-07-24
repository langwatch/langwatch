// Package health provides k8s-style liveness, readiness, and startup probe handlers.
package health

import (
	"encoding/json"
	"net/http"
	"sync/atomic"
	"time"
)

// Check is a probe function. Returns (ok, detail) where detail explains failure.
type Check func() (ok bool, detail string)

// Registry holds named checks and lifecycle state.
type Registry struct {
	version   string
	startedAt time.Time
	readiness []namedCheck
	liveness  []namedCheck
	startup   atomic.Bool
	draining  atomic.Bool
}

type namedCheck struct {
	name string
	fn   Check
}

// New creates a probe registry.
func New(version string) *Registry {
	return &Registry{version: version, startedAt: time.Now()}
}

// RegisterLiveness adds a liveness check. Should be cheap, never external.
func (r *Registry) RegisterLiveness(name string, fn Check) {
	r.liveness = append(r.liveness, namedCheck{name, fn})
}

// RegisterReadiness adds a readiness check. May depend on external systems.
func (r *Registry) RegisterReadiness(name string, fn Check) {
	r.readiness = append(r.readiness, namedCheck{name, fn})
}

// MarkStarted signals startup completion.
func (r *Registry) MarkStarted() { r.startup.Store(true) }

// Started reports whether startup is complete.
func (r *Registry) Started() bool { return r.startup.Load() }

// MarkDraining signals graceful shutdown has begun. /readyz returns 503.
func (r *Registry) MarkDraining() { r.draining.Store(true) }

// Draining reports whether drain has begun.
func (r *Registry) Draining() bool { return r.draining.Load() }

// Liveness serves /healthz.
func (r *Registry) Liveness(w http.ResponseWriter, _ *http.Request) {
	writeChecks(w, r.version, time.Since(r.startedAt), r.liveness, false)
}

// Readiness serves /readyz.
func (r *Registry) Readiness(w http.ResponseWriter, _ *http.Request) {
	if r.draining.Load() {
		writeJSON(w, http.StatusServiceUnavailable, probeResponse{
			Status:  "draining",
			Version: r.version,
			UptimeS: time.Since(r.startedAt).Seconds(),
		})
		return
	}
	writeChecks(w, r.version, time.Since(r.startedAt), r.readiness, true)
}

// Startup serves /startupz.
func (r *Registry) Startup(w http.ResponseWriter, _ *http.Request) {
	if !r.Started() {
		writeJSON(w, http.StatusServiceUnavailable, probeResponse{
			Status:  "starting",
			Version: r.version,
			UptimeS: time.Since(r.startedAt).Seconds(),
		})
		return
	}
	writeChecks(w, r.version, time.Since(r.startedAt), r.readiness, true)
}

type probeResponse struct {
	Status  string            `json:"status"`
	Version string            `json:"version"`
	UptimeS float64           `json:"uptime_s"`
	Checks  map[string]string `json:"checks,omitempty"`
}

func writeChecks(w http.ResponseWriter, version string, uptime time.Duration, checks []namedCheck, details bool) {
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
	status := http.StatusOK
	word := "ok"
	if !allOK {
		status = http.StatusServiceUnavailable
		word = "degraded"
	}
	resp := probeResponse{Status: word, Version: version, UptimeS: uptime.Seconds()}
	if details || !allOK {
		resp.Checks = results
	}
	writeJSON(w, status, resp)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
