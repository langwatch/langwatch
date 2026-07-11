package httpapi

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// probeRequest asks whether a worker with these capabilities is already running.
//
// Note what is NOT here: a LangWatch session key. That is the entire point. The
// worker signature is derived from capabilities alone — model, whether a GitHub
// token is present, and the egress allow-list — so the control plane can ask this
// question BEFORE it decides whether to mint anything.
//
// The capability fields are sent raw rather than as a pre-computed signature so
// the canonicalisation (egress allow-list sorting/normalising) stays in ONE place
// — domain.SignatureOf, here — instead of being reimplemented in TypeScript where
// it could silently drift and cause every probe to miss.
type probeRequest struct {
	ConversationID string `json:"conversationId" validate:"required"`
	Model          string `json:"model,omitempty"`
	// HasGithubAuth, not the token: the probe never needs the secret, only whether
	// the worker would have had one. Sending the token here would put a credential
	// on the wire for a question that does not need it.
	HasGithubAuth   bool     `json:"hasGithubAuth,omitempty"`
	EgressAllowlist []string `json:"egressAllowlist,omitempty"`
}

type probeResponse struct {
	// Alive: a worker is running for this conversation whose capabilities match.
	// The control plane reads this as "you do not need to mint a session key".
	Alive bool `json:"alive"`
}

// probeHandler answers the control plane's pre-flight so it can skip minting a
// session key when a live worker would just discard it.
//
// This is a READ. It spawns nothing, claims nothing, and mutates nothing — a
// probe must never be able to start a turn or boot a worker, or a stray call
// would cost exactly what we are trying to save.
//
// The answer is advisory and may be stale by the time the turn lands; Acquire is
// the authority and refuses a keyless spawn with ErrCredentialsRequired. That is
// deliberate: making this endpoint authoritative would mean holding the pool lock
// across the control plane's round trip.
func probeHandler(application *app.App, maxBodyBytes int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
		if err != nil {
			herr.WriteHTTP(w, herr.New(ctx, domain.ErrPayloadTooLarge, herr.M{"message": "probe body too large"}))
			return
		}
		var req probeRequest
		if err := json.Unmarshal(body, &req); err != nil {
			herr.WriteHTTP(w, herr.New(ctx, domain.ErrBadRequest, herr.M{"message": "invalid probe body"}))
			return
		}
		if !domain.IsValidConversationID(req.ConversationID) {
			herr.WriteHTTP(w, herr.New(ctx, domain.ErrInvalidConversationID, herr.M{"message": "invalid conversationId"}))
			return
		}

		// Build the signature through the SAME function Acquire uses, so the probe
		// can never answer a question subtly different from the one that matters.
		sig := domain.SignatureOf(domain.Credentials{
			Model:           req.Model,
			GithubToken:     githubTokenSentinel(req.HasGithubAuth),
			EgressAllowlist: req.EgressAllowlist,
		})

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(probeResponse{
			Alive: application.HasLiveWorker(req.ConversationID, sig),
		})
	}
}

// githubTokenSentinel turns the boolean the probe carries back into the shape
// SignatureOf reads (`GithubToken != ""`). The value is never used as a
// credential — it exists only so the signature is computed by the one function
// that owns that logic, rather than by a second copy of the rule that could drift
// from it.
func githubTokenSentinel(hasGithubAuth bool) string {
	if hasGithubAuth {
		return "present"
	}
	return ""
}
