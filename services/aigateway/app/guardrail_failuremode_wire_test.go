package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/controlplane"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The two halves of the fail-open contract used to be disconnected. The
// pipeline consults GuardrailsConfig.RequestFailOpen, and nothing on the wire
// ever assigned it, so an operator's FAIL_OPEN choice was decoded and then
// dropped in config_wire.go and every guardrail behaved as fail-closed while
// the UI said otherwise. See #6157.
//
// A unit test on either half alone cannot catch that, because each half is
// individually correct. These drive the real control-plane JSON through the
// real client and into the real interceptor, so the two are pinned together.

func bundleJSONWithGuardrail(direction, failureMode string) string {
	return fmt.Sprintf(`{
  "revision": "7",
  "vk_id": "vk_acme",
  "status": "active",
  "display_prefix": "vk-lw-01HZX9",
  "organization_id": "org_acme",
  "project_id": "proj_acme",
  "project_otlp_token": "tok",
  "team_id": "team_acme",
  "principal_id": null,
  "providers": [],
  "fallback": {"on": [], "chain": [], "timeout_ms": 30000, "max_attempts": 1},
  "model_aliases": {},
  "models_allowed": null,
  "cache": {"mode": "respect", "ttl_s": 3600},
  "guardrails": [
    {
      "id": "grd_pii",
      "name": "PII check",
      "evaluator_id": "eval_1",
      "evaluator_slug": "evaluators/pii-check-abc12",
      "direction": %q,
      "failure_mode": %q
    }
  ],
  "guardrail_attachments": [{"direction": %q, "guardrail_ids": ["grd_pii"]}],
  "policy_rules": {
    "tools": {"deny": [], "allow": null},
    "mcp": {"deny": [], "allow": null},
    "urls": {"deny": [], "allow": null},
    "models": {"deny": [], "allow": null}
  },
  "rate_limits": {"rpm": null, "tpm": null, "rpd": null},
  "budgets": [],
  "cache_rules": [],
  "langy_mirror_tier": "skip",
  "metadata": {}
}`, direction, failureMode, direction)
}

// bundleFromControlPlane serves the payload the control-plane materialiser
// emits and decodes it with the real client, so the test cannot drift from the
// wire shape by constructing a domain value by hand.
func bundleFromControlPlane(t *testing.T, payload string) *domain.Bundle {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(payload))
	}))
	t.Cleanup(srv.Close)

	client := controlplane.NewClient(controlplane.ClientOptions{
		BaseURL: srv.URL,
		Sign:    func(_ *http.Request, _ []byte) {},
		Logger:  zap.NewNop(),
	})
	res, err := client.FetchConfig(context.Background(), "vk_acme", "")
	require.NoError(t, err)

	bundle := testBundle()
	bundle.Config.Guardrails = res.Config.Guardrails
	return bundle
}

func TestGuardrailFailureModeSurvivesTheWire(t *testing.T) {
	unreachableEvaluator := &mockGuardrails{
		preFn: func(context.Context, *domain.Bundle, *domain.Request) (domain.GuardrailVerdict, error) {
			return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, errors.New("control plane unreachable")
		},
		postFn: func(context.Context, *domain.Bundle, *domain.Request, *domain.Response) (domain.GuardrailVerdict, error) {
			return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, errors.New("control plane unreachable")
		},
	}

	t.Run("given a guardrail the operator set to fail open", func(t *testing.T) {
		dispatched := false
		provider := &mockProvider{
			dispatchFn: func(context.Context, *domain.Request, domain.Credential) (*domain.Response, error) {
				dispatched = true
				return successResponse(), nil
			},
		}
		application := New(
			WithProviders(provider),
			WithGuardrails(unreachableEvaluator),
			WithLogger(zap.NewNop()),
		)
		bundle := bundleFromControlPlane(t, bundleJSONWithGuardrail("pre", "fail_open"))
		require.True(t, bundle.Config.Guardrails.RequestFailOpen,
			"fail_open must survive the wire, not be dropped in the decode")

		_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

		require.NoError(t, err, "an operator who chose fail-open must not be blocked by an evaluator outage")
		assert.True(t, dispatched)
	})

	t.Run("given a guardrail the operator set to fail closed", func(t *testing.T) {
		dispatched := false
		provider := &mockProvider{
			dispatchFn: func(context.Context, *domain.Request, domain.Credential) (*domain.Response, error) {
				dispatched = true
				return successResponse(), nil
			},
		}
		application := New(
			WithProviders(provider),
			WithGuardrails(unreachableEvaluator),
			WithLogger(zap.NewNop()),
		)
		bundle := bundleFromControlPlane(t, bundleJSONWithGuardrail("pre", "fail_closed"))
		require.False(t, bundle.Config.Guardrails.RequestFailOpen)

		_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

		require.Error(t, err)
		assert.True(t, herr.IsCode(err, domain.ErrGuardrailUpstreamUnavailable))
		assert.False(t, dispatched, "the provider must not be reached when the guardrail could not be evaluated")
	})

	t.Run("given a response-direction guardrail set to fail open", func(t *testing.T) {
		provider := &mockProvider{
			dispatchFn: func(context.Context, *domain.Request, domain.Credential) (*domain.Response, error) {
				return successResponse(), nil
			},
		}
		application := New(
			WithProviders(provider),
			WithGuardrails(unreachableEvaluator),
			WithLogger(zap.NewNop()),
		)
		bundle := bundleFromControlPlane(t, bundleJSONWithGuardrail("post", "fail_open"))
		require.True(t, bundle.Config.Guardrails.ResponseFailOpen)

		result, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

		require.NoError(t, err)
		assert.Equal(t, successResponse().Body, result.Response.Body)
	})
}
