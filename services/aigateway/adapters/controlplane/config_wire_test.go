package controlplane

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

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

// The control-plane writes aliases in "provider/model" form, which is a
// routing instruction rather than a model ID. Keeping the prefix on Model
// sends the provider a model name it has never heard of, and drops the
// provider the alias was pointing at.
//
// Spec: specs/ai-gateway/provider-routing.feature
func TestToDomain_ModelAliases(t *testing.T) {
	cfg := (&configWire{
		ModelAliases: map[string]string{
			"chat":     "openai/gpt-5-mini",
			"thinking": "anthropic/claude-haiku-4-5-20251001",
			"local":    "custom/qwen3-14b",
			"bare":     "gpt-5-mini",
		},
	}).toDomain()

	assert.Equal(t, domain.ModelAlias{ProviderID: domain.ProviderOpenAI, Model: "gpt-5-mini"}, cfg.ModelAliases["chat"])
	assert.Equal(t, domain.ModelAlias{ProviderID: domain.ProviderAnthropic, Model: "claude-haiku-4-5-20251001"}, cfg.ModelAliases["thinking"])
	assert.Equal(t, domain.ModelAlias{ProviderID: domain.ProviderCustom, Model: "qwen3-14b"}, cfg.ModelAliases["local"])
	assert.Equal(t, domain.ModelAlias{Model: "gpt-5-mini"}, cfg.ModelAliases["bare"],
		"an unqualified target carries no provider and resolves against the credential chain")
}

// The trace-export project id and its OTLP token are materialized together by
// the control plane and must survive decoding as a pair. Dropping project_id
// here is what forced the middleware to reach for the auth JWT's project id
// instead — a field on a different refresh clock, whose skew exported one
// project's prompts and completions under another project's ingest token.
func TestConfigWire_TraceProjectIDTravelsWithToken(t *testing.T) {
	var wire configWire
	require.NoError(t, json.Unmarshal(
		[]byte(`{"project_id":"proj-trace","project_otlp_token":"tok-trace"}`),
		&wire,
	))

	cfg := wire.toDomain()

	assert.Equal(t, "proj-trace", cfg.TraceProjectID)
	assert.Equal(t, "tok-trace", cfg.ProjectOTLPToken)
}

// A null project_id (org without an internal_governance project) must decode to
// empty rather than to some other project's id — the middleware fails closed on
// empty and exports nothing, which is the safe outcome.
func TestConfigWire_AbsentTraceProjectIDIsEmpty(t *testing.T) {
	var wire configWire
	require.NoError(t, json.Unmarshal(
		[]byte(`{"project_id":null,"project_otlp_token":"tok"}`),
		&wire,
	))
	cfg := wire.toDomain()

	assert.Empty(t, cfg.TraceProjectID)
}

// VK tags ride the bundle so the gateway can stamp them on customer spans
// (langwatch.labels) and match cache-rule vk_tags. Before this field existed
// BundleConfig.VKTags was permanently nil and both consumers were dead.
func TestConfigWire_VKTags(t *testing.T) {
	var w configWire
	require.NoError(t, json.Unmarshal([]byte(`{"vk_tags":["app=nexttrace","team=offsecops"]}`), &w))
	cfg := w.toDomain()
	assert.Equal(t, []string{"app=nexttrace", "team=offsecops"}, cfg.VKTags)
}

// failure_mode used to be decoded off the wire and then dropped when the
// domain config was built, so RequestFailOpen and ResponseFailOpen were never
// assigned and read false forever. That is invisible while nothing consults
// them, and becomes a lie the moment something does: a guardrail an operator
// set to FAIL_OPEN would block traffic on any evaluator error while the UI
// still described it as fail-open. See #6157.
func TestBuildGuardrails_FailureModeReachesTheDataPlane(t *testing.T) {
	t.Run("a fail-open guardrail opts its direction into failing open", func(t *testing.T) {
		got := buildGuardrails(
			[]guardrailWire{{ID: "gr", EvaluatorSlug: "pii", FailureMode: "fail_open"}},
			[]guardrailAttachmentWire{{Direction: "pre", GuardrailIDs: []string{"gr"}}},
		)
		assert.True(t, got.RequestFailOpen, "fail_open on the wire must reach the pipeline")
	})

	t.Run("a fail-closed guardrail keeps its direction failing closed", func(t *testing.T) {
		got := buildGuardrails(
			[]guardrailWire{{ID: "gr", EvaluatorSlug: "pii", FailureMode: "fail_closed"}},
			[]guardrailAttachmentWire{{Direction: "pre", GuardrailIDs: []string{"gr"}}},
		)
		assert.False(t, got.RequestFailOpen)
	})

	t.Run("an absent failure_mode fails closed", func(t *testing.T) {
		// FAIL_CLOSED is the Prisma default and the only opt-out is the
		// operator explicitly choosing FAIL_OPEN, so an older control plane
		// that omits the field must not be read as permission to proceed.
		got := buildGuardrails(
			[]guardrailWire{{ID: "gr", EvaluatorSlug: "pii"}},
			[]guardrailAttachmentWire{{Direction: "pre", GuardrailIDs: []string{"gr"}}},
		)
		assert.False(t, got.RequestFailOpen)
	})

	t.Run("one fail-closed guardrail makes the whole direction fail closed", func(t *testing.T) {
		// The flag is per direction because a direction is one call, and an
		// unreachable control plane returns no per-guardrail verdicts. The
		// strictest guardrail on the direction therefore decides.
		got := buildGuardrails(
			[]guardrailWire{
				{ID: "open", EvaluatorSlug: "a", FailureMode: "fail_open"},
				{ID: "closed", EvaluatorSlug: "b", FailureMode: "fail_closed"},
			},
			[]guardrailAttachmentWire{{Direction: "pre", GuardrailIDs: []string{"open", "closed"}}},
		)
		assert.False(t, got.RequestFailOpen)
	})

	t.Run("the directions are decided independently", func(t *testing.T) {
		got := buildGuardrails(
			[]guardrailWire{
				{ID: "pre-open", EvaluatorSlug: "a", FailureMode: "fail_open"},
				{ID: "post-closed", EvaluatorSlug: "b", FailureMode: "fail_closed"},
			},
			[]guardrailAttachmentWire{
				{Direction: "pre", GuardrailIDs: []string{"pre-open"}},
				{Direction: "post", GuardrailIDs: []string{"post-closed"}},
			},
		)
		assert.True(t, got.RequestFailOpen)
		assert.False(t, got.ResponseFailOpen)
	})

	t.Run("a direction with no guardrails is vacuously fail-open", func(t *testing.T) {
		// Nothing to bypass, so an error on an empty direction must not stop
		// a request that the other direction's guardrails still govern.
		got := buildGuardrails(
			[]guardrailWire{{ID: "post-closed", EvaluatorSlug: "b", FailureMode: "fail_closed"}},
			[]guardrailAttachmentWire{{Direction: "post", GuardrailIDs: []string{"post-closed"}}},
		)
		assert.True(t, got.RequestFailOpen)
		assert.False(t, got.ResponseFailOpen)
	})
}

// The materialiser (config.materialiser.ts, gemini branch) emits project_id
// and region on a Gemini credential exactly when it names the Agent
// Platform door, and the router's door detection reads exactly those two
// Extra fields (credentialIsAgentPlatform). This is the contract test for
// that pair surviving the wire decoder: dropping either field silently
// reroutes an Agent Platform key to generativelanguage.googleapis.com,
// where its own restrictions refuse it.
//
// Spec: specs/model-providers/google-agent-platform.feature
func TestProviderSlotToCredential_GeminiAgentPlatform(t *testing.T) {
	t.Run("gemini slot preserves the agent-platform pair", func(t *testing.T) {
		cred := providerSlotToCredential(providerSlotWire{
			ID:   "mp-gap",
			Type: "gemini",
			Credentials: map[string]interface{}{
				"api_key":    "AQ.agent-platform-key",
				"project_id": "acme-123",
				"region":     "us-central1",
			},
		})
		assert.Equal(t, domain.ProviderGemini, cred.ProviderID)
		assert.Equal(t, "AQ.agent-platform-key", cred.APIKey)
		assert.Equal(t, "acme-123", cred.Extra["project_id"])
		assert.Equal(t, "us-central1", cred.Extra["region"])
	})

	t.Run("bare gemini slot carries no pair", func(t *testing.T) {
		cred := providerSlotToCredential(providerSlotWire{
			ID:          "mp-gem",
			Type:        "gemini",
			Credentials: map[string]interface{}{"api_key": "AIza-studio"},
		})
		assert.Equal(t, domain.ProviderGemini, cred.ProviderID)
		assert.Equal(t, "AIza-studio", cred.APIKey)
		assert.Empty(t, cred.Extra["project_id"])
		assert.Empty(t, cred.Extra["region"])
	})

	t.Run("half a pair is dropped, not forwarded", func(t *testing.T) {
		cred := providerSlotToCredential(providerSlotWire{
			ID:   "mp-half",
			Type: "gemini",
			Credentials: map[string]interface{}{
				"api_key":    "k",
				"project_id": "acme-123",
			},
		})
		assert.Empty(t, cred.Extra["project_id"])
	})
}

// A rolling deploy runs both versions of the gateway against both versions of
// the control plane, in both directions, so neither side may refuse the
// other's payload. "on" and "timeout_ms" were never read; retiring them must
// stay a decode-time non-event rather than a coordinated release.
//
// @scenario "A bundle carrying unread fallback keys still decodes"
func TestConfigWire_RetiredFallbackKeysStillDecode(t *testing.T) {
	payload := []byte(`{
		"routing_mode": "fallback_all",
		"fallback": {
			"on": ["5xx", "timeout", "rate_limit_exceeded"],
			"chain": ["pc_openai", "pc_anthropic"],
			"timeout_ms": 30000,
			"max_attempts": 3
		}
	}`)

	var wire configWire
	require.NoError(t, json.Unmarshal(payload, &wire))

	cfg := wire.toDomain()
	assert.Equal(t, 3, cfg.Fallback.MaxAttempts)
	assert.Equal(t, []string{"pc_openai", "pc_anthropic"}, wire.Fallback.Chain)
}

// A control plane that has already dropped the keys is the other direction of
// the same deploy, and must decode identically.
func TestConfigWire_FallbackWithoutRetiredKeysDecodes(t *testing.T) {
	payload := []byte(`{"routing_mode":"fallback_all","fallback":{"chain":["pc_openai"],"max_attempts":2}}`)

	var wire configWire
	require.NoError(t, json.Unmarshal(payload, &wire))

	cfg := wire.toDomain()
	assert.Equal(t, 2, cfg.Fallback.MaxAttempts)
}
