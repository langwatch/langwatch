package httpapi

import (
	"encoding/json"
	"net/http"
)

// debugControlPlaneResponse is the body of GET /debug/control-plane.
type debugControlPlaneResponse struct {
	ControlPlaneBaseURL string `json:"control_plane_base_url"`
}

// debugControlPlaneHandler serves GET /debug/control-plane: the resolved
// control-plane base URL this gateway process ships spend, budget and auth
// traffic to. Unauthenticated and kept off the public ingress the same way
// as /healthz, /readyz and /metrics: charts/gateway/templates/ingress.yaml
// allowlists only /v1 and the exact /health path, so this route is never
// reachable from outside the cluster regardless of auth.
//
// Exists for dev tooling, not operators: a worktree's `pnpm dev` calls this
// before trusting an already-running gateway process on a shared port, so
// a stale or foreign gateway can be told apart from this worktree's own
// instead of silently reused.
func debugControlPlaneHandler(controlPlaneBaseURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(debugControlPlaneResponse{ControlPlaneBaseURL: controlPlaneBaseURL})
	}
}
