package controlplane

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// buildGuardrails reconstructs the per-direction domain.GuardrailsConfig
// from the flat project catalog (bundle.guardrails[]) and the VK's
// attachment tuples (bundle.guardrail_attachments[]). These cases pin the
// join the gateway dispatcher depends on — a silently dropped guardrail is
// a fail-open security regression, so the bucketing, evaluator resolution,
// and dangling-id handling all need explicit coverage.
//
// Spec: specs/ai-gateway/governance/guardrails-project-scope.feature
//
//	(@bundle — "Bundle materialiser ships project guardrails flat with
//	 VK attachments referencing them").
func TestBuildGuardrails(t *testing.T) {
	t.Run("no catalog and no attachments yields an empty config", func(t *testing.T) {
		got := buildGuardrails(nil, nil)
		assert.Empty(t, got.Pre)
		assert.Empty(t, got.Post)
		assert.Empty(t, got.StreamChunk)
	})

	t.Run("attachment direction buckets the guardrail, not the catalog direction", func(t *testing.T) {
		// Catalog declares the guardrail as PRE, but the VK attaches it on
		// post. The attachment direction is authoritative per the spec
		// ("the dispatcher reads guardrail_attachments to know which
		// guardrails to invoke per direction").
		catalog := []guardrailWire{
			{ID: "gr-pii", EvaluatorSlug: "pii-v2", EvaluatorID: "ev-1", Direction: "pre"},
		}
		attachments := []guardrailAttachmentWire{
			{Direction: "post", GuardrailIDs: []string{"gr-pii"}},
		}
		got := buildGuardrails(catalog, attachments)
		assert.Empty(t, got.Pre)
		assert.Equal(t, []domain.GuardrailEntry{{ID: "gr-pii", Evaluator: "pii-v2"}}, got.Post)
		assert.Empty(t, got.StreamChunk)
	})

	t.Run("evaluator_slug is preferred and evaluator_id is the fallback", func(t *testing.T) {
		catalog := []guardrailWire{
			{ID: "gr-slug", EvaluatorSlug: "tox-v3", EvaluatorID: "ev-slug"},
			{ID: "gr-noslug", EvaluatorSlug: "", EvaluatorID: "ev-fallback"},
		}
		attachments := []guardrailAttachmentWire{
			{Direction: "pre", GuardrailIDs: []string{"gr-slug", "gr-noslug"}},
		}
		got := buildGuardrails(catalog, attachments)
		assert.Equal(t, []domain.GuardrailEntry{
			{ID: "gr-slug", Evaluator: "tox-v3"},
			{ID: "gr-noslug", Evaluator: "ev-fallback"},
		}, got.Pre)
	})

	t.Run("a dangling attachment id not in the catalog is skipped", func(t *testing.T) {
		catalog := []guardrailWire{
			{ID: "gr-real", EvaluatorSlug: "real", EvaluatorID: "ev-real"},
		}
		attachments := []guardrailAttachmentWire{
			{Direction: "pre", GuardrailIDs: []string{"gr-real", "gr-ghost"}},
		}
		got := buildGuardrails(catalog, attachments)
		assert.Equal(t, []domain.GuardrailEntry{{ID: "gr-real", Evaluator: "real"}}, got.Pre)
	})

	t.Run("request and response are accepted as aliases for pre and post", func(t *testing.T) {
		catalog := []guardrailWire{
			{ID: "gr-a", EvaluatorSlug: "a", EvaluatorID: "ev-a"},
			{ID: "gr-b", EvaluatorSlug: "b", EvaluatorID: "ev-b"},
		}
		attachments := []guardrailAttachmentWire{
			{Direction: "request", GuardrailIDs: []string{"gr-a"}},
			{Direction: "response", GuardrailIDs: []string{"gr-b"}},
		}
		got := buildGuardrails(catalog, attachments)
		assert.Equal(t, []domain.GuardrailEntry{{ID: "gr-a", Evaluator: "a"}}, got.Pre)
		assert.Equal(t, []domain.GuardrailEntry{{ID: "gr-b", Evaluator: "b"}}, got.Post)
	})

	t.Run("stream_chunk attachments bucket into StreamChunk", func(t *testing.T) {
		catalog := []guardrailWire{
			{ID: "gr-stream", EvaluatorSlug: "stream", EvaluatorID: "ev-stream"},
		}
		attachments := []guardrailAttachmentWire{
			{Direction: "stream_chunk", GuardrailIDs: []string{"gr-stream"}},
		}
		got := buildGuardrails(catalog, attachments)
		assert.Equal(t, []domain.GuardrailEntry{{ID: "gr-stream", Evaluator: "stream"}}, got.StreamChunk)
	})

	t.Run("an unknown direction drops the entry rather than guessing", func(t *testing.T) {
		catalog := []guardrailWire{
			{ID: "gr-x", EvaluatorSlug: "x", EvaluatorID: "ev-x"},
		}
		attachments := []guardrailAttachmentWire{
			{Direction: "sideways", GuardrailIDs: []string{"gr-x"}},
		}
		got := buildGuardrails(catalog, attachments)
		assert.Empty(t, got.Pre)
		assert.Empty(t, got.Post)
		assert.Empty(t, got.StreamChunk)
	})
}

// buildPolicyRules must convert the model dimension of policy_rules, not just
// tools/mcp/urls — otherwise control-plane model allow/deny is a silent no-op
// at the gateway.
func TestBuildPolicyRules_Models(t *testing.T) {
	pr := policyRulesWire{
		Models: policyRuleSetWire{
			Deny:  []string{"^gpt-4.*"},
			Allow: []string{"^claude-.*"},
		},
	}
	rules := buildPolicyRules(pr)

	var modelRules []domain.PolicyRule
	for _, r := range rules {
		if r.Target == domain.PolicyTargetModel {
			modelRules = append(modelRules, r)
		}
	}
	assert.Contains(t, modelRules, domain.PolicyRule{Pattern: "^gpt-4.*", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel})
	assert.Contains(t, modelRules, domain.PolicyRule{Pattern: "^claude-.*", Type: domain.PolicyAllow, Target: domain.PolicyTargetModel})
}

// providerSlotToCredential must carry the top-level base_url from the wire
// into cred.Extra — the bifrost adapter routes OpenAI-compatible custom
// providers (self-hosted vLLM, LiteLLM proxies) by it. Dropping it sends
// customer traffic to api.openai.com instead of their endpoint.
//
// Spec: specs/ai-gateway/custom-provider-base-url.feature
func TestProviderSlotToCredential_BaseURL(t *testing.T) {
	t.Run("custom slot forwards base_url into Extra", func(t *testing.T) {
		cred := providerSlotToCredential(providerSlotWire{
			ID:          "mp-1",
			Type:        "custom",
			Credentials: map[string]interface{}{"api_key": ""},
			BaseURL:     "http://llm-server:8000/v1",
		})
		assert.Equal(t, domain.ProviderID("custom"), cred.ProviderID)
		assert.Equal(t, "http://llm-server:8000/v1", cred.Extra["base_url"])
		assert.Empty(t, cred.APIKey)
	})

	t.Run("openai slot with base_url override forwards it", func(t *testing.T) {
		cred := providerSlotToCredential(providerSlotWire{
			ID:          "mp-2",
			Type:        "openai",
			Credentials: map[string]interface{}{"api_key": "sk-test"},
			BaseURL:     "https://proxy.example.com/v1",
		})
		assert.Equal(t, domain.ProviderOpenAI, cred.ProviderID)
		assert.Equal(t, "https://proxy.example.com/v1", cred.Extra["base_url"])
		assert.Equal(t, "sk-test", cred.APIKey)
	})

	t.Run("slot without base_url leaves Extra unset", func(t *testing.T) {
		cred := providerSlotToCredential(providerSlotWire{
			ID:          "mp-3",
			Type:        "openai",
			Credentials: map[string]interface{}{"api_key": "sk-test"},
		})
		assert.Empty(t, cred.Extra["base_url"])
	})
}
