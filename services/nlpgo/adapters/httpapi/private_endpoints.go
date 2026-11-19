package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	gatewaydomain "github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/nlpgo/domain"
)

// privateEndpointsFromHeader reads the organization's private endpoint
// bindings (ADR-203) off X-LangWatch-Private-Endpoints. Only a request that
// presented the internal secret may carry them; on an install with no secret
// the header is ignored, so the call keeps today's endpoint rules. A malformed
// value refuses the request: dropping it would send a bound hostname through
// DNS.
func privateEndpointsFromHeader(r *http.Request) ([]gatewaydomain.PrivateEndpoint, *herr.E) {
	value := r.Header.Get(gatewaydomain.PrivateEndpointsHeader)
	if value == "" {
		return nil, nil
	}
	return acceptPrivateEndpoints(r.Context(), func() ([]gatewaydomain.PrivateEndpoint, error) {
		return gatewaydomain.DecodePrivateEndpointsHeader(value)
	})
}

// decodeWorkflowPrivateEndpoints reads private_endpoints from a workflow
// payload: beside project_id (inside "payload" for the discriminated
// envelope, at the top level for the flat one), or at the envelope's top
// level. The bindings ride on the request context down to the in-process
// dispatcher, which stamps them on every credential the workflow's LLM and
// evaluator blocks dispatch with.
func decodeWorkflowPrivateEndpoints(r *http.Request, body []byte) ([]gatewaydomain.PrivateEndpoint, *herr.E) {
	var envelope struct {
		Payload          json.RawMessage `json:"payload"`
		PrivateEndpoints json.RawMessage `json:"private_endpoints"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		// decodeStudioClientEvent already refused a body that does not parse.
		return nil, nil
	}
	raw := envelope.PrivateEndpoints
	if len(envelope.Payload) > 0 {
		var inner struct {
			PrivateEndpoints json.RawMessage `json:"private_endpoints"`
		}
		if err := json.Unmarshal(envelope.Payload, &inner); err == nil && len(inner.PrivateEndpoints) > 0 {
			raw = inner.PrivateEndpoints
		}
	}
	return privateEndpointsFromPayload(r.Context(), raw)
}

// privateEndpointsFromPayload is privateEndpointsFromHeader for the
// workflow payload's private_endpoints field.
func privateEndpointsFromPayload(ctx context.Context, raw json.RawMessage) ([]gatewaydomain.PrivateEndpoint, *herr.E) {
	if len(raw) == 0 {
		return nil, nil
	}
	return acceptPrivateEndpoints(ctx, func() ([]gatewaydomain.PrivateEndpoint, error) {
		return gatewaydomain.ParsePrivateEndpoints(raw)
	})
}

func acceptPrivateEndpoints(ctx context.Context, parse func() ([]gatewaydomain.PrivateEndpoint, error)) ([]gatewaydomain.PrivateEndpoint, *herr.E) {
	if !internallyAuthenticated(ctx) {
		clog.Get(ctx).Warn("private_endpoints_ignored",
			zap.String("reason", "request did not present the internal secret"))
		return nil, nil
	}
	eps, err := parse()
	if err != nil {
		e := herr.New(ctx, domain.ErrBadRequest, herr.M{
			"reason":  "invalid_private_endpoints",
			"message": err.Error(),
		}, err)
		return nil, &e
	}
	return eps, nil
}
