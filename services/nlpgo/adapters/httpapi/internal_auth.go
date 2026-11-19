package httpapi

import (
	"crypto/subtle"
	"net/http"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/domain"
)

// InternalSecretHeader carries the shared secret the LangWatch app presents on
// every call it makes to this service.
//
// Deliberately not `Authorization: Bearer`. /go/proxy/v1/* is consumed as an
// OpenAI-compatible base URL, and an OpenAI client owns the Authorization
// header on that lane, so a secret placed there would be overwritten by the
// caller's own SDK.
const InternalSecretHeader = "X-LangWatch-NLP-Secret"

// RequireInternalSecret guards the /go/* surface behind the secret shared with
// the LangWatch app.
//
// The engine runs workflow nodes, including user-authored Python, for whichever
// project the request body names, and it never authenticates that project
// itself. So the only thing that may call it is the app. Until now that rested
// entirely on network placement; this is the application-level half.
//
// An empty secret returns the handler unchanged: an install whose configuration
// predates this variable keeps working rather than losing its NLP service to a
// value its operator was never asked for. Serve logs that state once at
// startup, and the Helm chart and docker compose provision the secret so new
// and upgraded installs are guarded without the operator doing anything.
func RequireInternalSecret(secret string) func(http.Handler) http.Handler {
	if secret == "" {
		return func(next http.Handler) http.Handler { return next }
	}
	expected := []byte(secret)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			presented := []byte(r.Header.Get(InternalSecretHeader))
			if subtle.ConstantTimeCompare(presented, expected) != 1 {
				// The telemetry middleware already stamps method and path
				// on every line, so this one only adds what it knows:
				// whether the caller sent the header at all. That is the
				// difference between a service that was never configured
				// and one configured with the wrong value.
				clog.Get(r.Context()).Warn("internal_auth_rejected",
					zap.Bool("header_present", len(presented) > 0),
				)
				// The caller is another of our own services, so there is
				// nothing to tell it beyond which header it got wrong: a
				// stranger learns no more than that the route is guarded.
				writeHandlerError(r.Context(), w, herr.New(r.Context(), domain.ErrUnauthorized, herr.M{
					"message": "requests to the NLP engine must present " + InternalSecretHeader,
				}))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
