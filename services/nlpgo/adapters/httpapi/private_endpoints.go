package httpapi

import (
	"context"
	"crypto/ed25519"
	"errors"
	"net/http"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	gatewaydomain "github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/nlpgo/domain"
)

type privateEndpointsVerifyKeyCtx struct{}

// withPrivateEndpointsVerifyKey puts the public key that private endpoint
// envelopes are checked with on every request's context. A nil key means
// none is configured, and bindings are ignored.
func withPrivateEndpointsVerifyKey(key ed25519.PublicKey) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if key != nil {
				r = r.WithContext(context.WithValue(r.Context(), privateEndpointsVerifyKeyCtx{}, key))
			}
			next.ServeHTTP(w, r)
		})
	}
}

func privateEndpointsVerifyKeyFrom(ctx context.Context) ed25519.PublicKey {
	key, _ := ctx.Value(privateEndpointsVerifyKeyCtx{}).(ed25519.PublicKey)
	return key
}

// privateEndpointsNow is the clock envelopes are checked against; tests move it.
var privateEndpointsNow = time.Now

// privateEndpointsFromHeader reads the organization's private endpoint
// bindings (ADR-203) off X-LangWatch-Private-Endpoints. It is the only place
// nlpgo takes bindings from, on every route: the playground proxy and the
// workflow routes alike. The request body is never read for bindings.
//
// The header holds an envelope the app signed with a key no engine holds, so
// what authorizes bindings is a signature nlpgo can check, not a secret it
// shares: tenant code on a per-project NLP Lambda can read that Lambda's
// environment. The envelope is accepted only when its signature verifies, it
// has not expired, and it was signed for the project this request runs for:
// the app's X-LangWatch-Project-Id header and, on a workflow route, the
// project_id the body names (bodyProjectID; empty on the proxy).
//
// No verify key configured: the header is ignored and the call keeps
// today's endpoint rules. A value that is present but fails any check is a
// 400: dropping it would send a bound hostname through DNS.
func privateEndpointsFromHeader(r *http.Request, bodyProjectID string) ([]gatewaydomain.PrivateEndpoint, *herr.E) {
	value := r.Header.Get(gatewaydomain.PrivateEndpointsHeader)
	if value == "" {
		return nil, nil
	}
	ctx := r.Context()
	key := privateEndpointsVerifyKeyFrom(ctx)
	if key == nil {
		clog.Get(ctx).Warn("private_endpoints_ignored",
			zap.String("reason", "LANGWATCH_PRIVATE_ENDPOINTS_VERIFY_KEY is not set"))
		return nil, nil
	}
	env, err := gatewaydomain.VerifyPrivateEndpointsHeader(value, key, privateEndpointsNow())
	if err != nil {
		return nil, refusePrivateEndpoints(ctx, err)
	}
	claimed := strings.TrimSpace(r.Header.Get(gatewaydomain.PrivateEndpointsProjectHeader))
	if claimed == "" && bodyProjectID == "" {
		return nil, refusePrivateEndpoints(ctx, errors.New("the request names no project to check the bindings against"))
	}
	for _, project := range []string{claimed, bodyProjectID} {
		if project != "" && project != env.ProjectID {
			return nil, refusePrivateEndpoints(ctx, gatewaydomain.ErrPrivateEndpointsProject)
		}
	}
	return env.Bindings, nil
}

func refusePrivateEndpoints(ctx context.Context, err error) *herr.E {
	e := herr.New(ctx, domain.ErrBadRequest, herr.M{
		"reason":  "invalid_private_endpoints",
		"message": err.Error(),
	}, err)
	return &e
}
