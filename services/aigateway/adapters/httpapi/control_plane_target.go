package httpapi

import (
	"encoding/json"
	"net/http"
)

// controlPlaneTargetResponse is the body of GET /internal/control-plane.
type controlPlaneTargetResponse struct {
	ControlPlaneBaseURL string `json:"control_plane_base_url"`
}

// controlPlaneTargetHandler serves GET /internal/control-plane: the resolved
// control-plane base URL this gateway ships spend, budget and auth traffic
// to, so the app's checkup can tell a gateway pointed at another install
// apart from its own. Mounted under /internal, behind the HMAC check: the
// URL is usually an in-cluster hostname, which an unsigned caller must not learn.
func controlPlaneTargetHandler(controlPlaneBaseURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(controlPlaneTargetResponse{ControlPlaneBaseURL: controlPlaneBaseURL})
	}
}
