package httpapi

import (
	"encoding/json"
	"net/http"
)

// StatusReporter answers the dependency section of the public GET /health
// status-page endpoint. Implemented by statusprobe.Monitor; nil leaves the
// response with the process-level component only.
type StatusReporter interface {
	// ControlPlane reports the cached control-plane verdict. The detail is
	// written verbatim into the public response body, so implementations
	// must keep it free of hostnames, URLs, and error internals.
	ControlPlane() (ok bool, detail string)
}

// statusResponse is the public /health body. Deliberately minimal: overall
// status plus a component map, mirroring pkg/health's probe vocabulary
// ("ok" / "degraded", per-check "ok" or a short detail) without the
// version and uptime fields: this endpoint is polled by the public
// internet, and restart cadence and build identity are nobody's business.
type statusResponse struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks"`
}

// statusHandler serves GET/HEAD /health for the public status page.
//
// Semantics the status page consumes: HTTP 200 healthy, 503 unhealthy.
// The verdict covers the gateway process and the dependencies LangWatch
// owns (the control plane, via the background statusprobe monitor). It is
// structurally independent of model providers: no dispatch state feeds it
// and no upstream call is made per poll, so an OpenAI or Anthropic outage
// can never turn it red. That is their status page's job.
//
// Pod-lifecycle state (draining) is deliberately ignored: /readyz already
// pulls a draining pod out of the load balancer, so by the time a public
// poll could observe it the pod is gone from rotation; reporting it here
// would flap the status page on every routine rollout.
func statusHandler(status StatusReporter) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		checks := map[string]string{"gateway": "ok"}
		healthy := true
		if status != nil {
			ok, detail := status.ControlPlane()
			if !ok {
				healthy = false
			}
			checks["control_plane"] = detail
		}

		code := http.StatusOK
		word := "ok"
		if !healthy {
			code = http.StatusServiceUnavailable
			word = "degraded"
		}
		w.Header().Set("Content-Type", "application/json")
		// Every poll must observe the current verdict, not an edge cache's.
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(statusResponse{Status: word, Checks: checks})
	}
}
