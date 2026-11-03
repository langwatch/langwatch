package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/adapters/mediarelay"
)

// HopRouterDeps are what the relay hop listener needs.
type HopRouterDeps struct {
	Logger         *zap.Logger
	InternalSecret string
	MediaRelay     *mediarelay.Hub
}

// NewHopRouter serves the owner side of a cross-pod relay hop on its own
// listener. It mounts one route, signed with the internal secret, and nothing
// else, so the public router never carries a /relay-hop path.
func NewHopRouter(deps HopRouterDeps) http.Handler {
	router := chi.NewRouter()
	forErrors := RouterDeps{Logger: deps.Logger}
	router.Group(func(group chi.Router) {
		group.Use(refuseBody(forErrors), InternalAuthMiddleware(deps.InternalSecret))
		group.Get("/relay-hop/{id}", func(w http.ResponseWriter, r *http.Request) {
			if !isSocketUpgrade(r) {
				refuseNotAnUpgrade(forErrors, w, r)
				return
			}
			if err := deps.MediaRelay.Hop(w, r, chi.URLParam(r, "id")); err != nil {
				writeError(deps.Logger, w, r.Context(), err)
			}
		})
	})
	return router
}
