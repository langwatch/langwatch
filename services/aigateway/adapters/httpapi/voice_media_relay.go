package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/httpmiddleware"
	"github.com/langwatch/langwatch/services/aigateway/adapters/mediarelay"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The Twilio media relay (langwatch#8397). A worker dials out to
// /v1/voice/relay, is told a relay id, and places its Twilio call with
// <Stream url=".../v1/voice/twilio/{id}">. Twilio then dials the gateway, and
// the gateway joins the two sockets. The worker is authenticated by a license
// token or a signed request; Twilio by the unguessable id alone.

// mountMediaRelayRoutes registers the three relay routes under /v1.
func mountMediaRelayRoutes(v1 chi.Router, deps RouterDeps) {
	hub := deps.MediaRelay
	// No auth header can reach this route: Twilio sends none.
	v1.Get("/voice/twilio/{id}", twilioSocketHandler(deps))
	v1.Group(func(group chi.Router) {
		group.Use(countAuthRefusals(hub, AuthMiddleware(deps.App.Auth())))
		group.Get("/voice/relay", licensedRelayHandler(deps))
	})
	v1.Group(func(group chi.Router) {
		group.Use(countAuthRefusals(hub, InternalAuthMiddleware(deps.InternalSecret)))
		group.Get("/voice/relay/{orgId}", signedRelayHandler(deps))
	})
}

// countAuthRefusals counts every request auth turns away, so the credential
// check does not need to know about the relay's metric.
func countAuthRefusals(hub *mediarelay.Hub, auth func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			passed := false
			auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				passed = true
				next.ServeHTTP(w, r)
			})).ServeHTTP(w, r)
			if !passed {
				hub.RecordRefusedAuth()
			}
		})
	}
}

// licensedRelayHandler opens a relay for a self-hosted install: its lwl_
// token and instance id. A virtual key is refused.
func licensedRelayHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}
		if !bundle.LicenseCredential() {
			deps.MediaRelay.RecordRefusedAuth()
			writeError(deps.Logger, w, r.Context(), herr.New(r.Context(), domain.ErrVoiceRelayLicenseRequired, herr.M{
				"message": "a media relay is opened with a license token, not a virtual key",
				"fault":   "customer",
			}))
			return
		}
		openRelay(deps, "instance:"+strings.TrimSpace(r.Header.Get(headerInstanceID)))(w, r)
	}
}

// signedRelayHandler opens a relay for a cloud worker. The organization is
// in the signed path, so one signature is good for one organization.
func signedRelayHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		openRelay(deps, "org:"+chi.URLParam(r, "orgId"))(w, r)
	}
}

func openRelay(deps RouterDeps, scope string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !isSocketUpgrade(r) {
			refuseNotAnUpgrade(deps, w, r)
			return
		}
		stampRequestID(w, r)
		if err := deps.MediaRelay.Open(w, r, scope); err != nil {
			if herr.IsCode(err, domain.ErrVoiceRelayUnavailable) {
				w.Header().Set("Retry-After", strconv.Itoa(voiceBrokerRetryAfter))
			}
			writeError(deps.Logger, w, r.Context(), err)
		}
	}
}

// twilioSocketHandler joins Twilio's socket to the relay its id names.
func twilioSocketHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Checked before the id is read, so a plain GET never spends an id.
		if !isSocketUpgrade(r) {
			refuseNotAnUpgrade(deps, w, r)
			return
		}
		stampRequestID(w, r)
		if err := deps.MediaRelay.Join(w, r, chi.URLParam(r, "id")); err != nil {
			writeError(deps.Logger, w, r.Context(), err)
		}
	}
}

// stampRequestID names the request on the upgrade response, as every other
// gateway route does, so a socket that opened can be traced from its client.
func stampRequestID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-LangWatch-Gateway-Request-Id", httpmiddleware.GetRequestID(r.Context()))
}

func refuseNotAnUpgrade(deps RouterDeps, w http.ResponseWriter, r *http.Request) {
	writeError(deps.Logger, w, r.Context(), herr.New(r.Context(), domain.ErrBadRequest, herr.M{
		"message": "this route is a WebSocket: send an upgrade request",
		"fault":   "customer",
	}))
}
