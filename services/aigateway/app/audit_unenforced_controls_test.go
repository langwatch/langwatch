package app

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/cacherules"
	"github.com/langwatch/langwatch/services/aigateway/adapters/controlplane"
	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/adapters/policy"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// bundleJSONFailClosedGuardrail is byte-for-byte the shape
// langwatch/src/server/gateway/config.materialiser.ts emits for a project
// with one PRE guardrail whose failureMode is FAIL_CLOSED (the Prisma
// default, schema.prisma:2510, and the UI default in
// src/pages/settings/gateway/guardrails.tsx:368).
const bundleJSONFailClosedGuardrail = `{
  "revision": "7",
  "vk_id": "vk_audit",
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
      "direction": "pre",
      "failure_mode": "fail_closed"
    }
  ],
  "guardrail_attachments": [{"direction": "pre", "guardrail_ids": ["grd_pii"]}],
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
}`

// bundleJSONFailClosedPostGuardrail is the same bundle with the attachment on
// the RESPONSE direction. Built at the wire level on purpose: the direction a
// guardrail is attached to is what the control plane sends, so a probe that
// mutates the decoded struct instead would not exercise the real decode.
var bundleJSONFailClosedPostGuardrail = strings.Replace(
	bundleJSONFailClosedGuardrail,
	`"guardrail_attachments": [{"direction": "pre", "guardrail_ids": ["grd_pii"]}]`,
	`"guardrail_attachments": [{"direction": "post", "guardrail_ids": ["grd_pii"]}]`,
	1,
)

func fetchBundleConfig(t *testing.T, payload string) domain.BundleConfig {
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
	cfg, err := client.FetchConfig(context.Background(), "vk_audit")
	require.NoError(t, err)
	return cfg
}

// FINDING A — a guardrail an operator configured as FAIL_CLOSED passes
// traffic through when the guardrail evaluator errors.
//
// Seam: langwatch/src/server/gateway/config.materialiser.ts:271 emits
// `failure_mode: "fail_closed"`; services/aigateway/adapters/controlplane/
// config_wire.go:72 decodes it into guardrailWire.FailureMode and then
// config_wire.go:210 drops it when building domain.GuardrailEntry.
// domain.GuardrailsConfig.RequestFailOpen / ResponseFailOpen (bundle.go:105-106)
// are never assigned and never read. app/pipeline/guardrail.go:35-40 and 47-52
// log a warning on evaluator error and dispatch anyway — unconditional fail-open.
func TestAudit_FailClosedGuardrail_FailsOpenOnEvaluatorError(t *testing.T) {
	cfg := fetchBundleConfig(t, bundleJSONFailClosedGuardrail)

	// The attachment survives the wire: the gateway knows it must run a guardrail.
	require.Len(t, cfg.Guardrails.Pre, 1)
	assert.Equal(t, "grd_pii", cfg.Guardrails.Pre[0].ID)

	// But the fail-closed instruction did not survive: there is nowhere on the
	// domain type that records it, so both fail-open flags read false-by-default
	// and are consulted by nobody.
	assert.False(t, cfg.Guardrails.RequestFailOpen,
		"zero value, not a decoded value — nothing on the wire populates this")

	dispatched := false
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			dispatched = true
			return successResponse(), nil
		},
	}
	// The guardrail evaluator is down: every check errors, exactly what
	// adapters/controlplane/guardrails.go returns on transport failure,
	// non-200, or an unparseable body.
	guards := &mockGuardrails{
		preFn: func(_ context.Context, _ *domain.Bundle, _ *domain.Request) (domain.GuardrailVerdict, error) {
			return domain.GuardrailVerdict{Action: domain.GuardrailAllow},
				fmt.Errorf("guardrail check: dial tcp 127.0.0.1:5560: connect: connection refused")
		},
	}

	application := New(
		WithProviders(provider),
		WithGuardrails(guards),
		WithLogger(zap.NewNop()),
	)

	bundle := testBundle()
	bundle.Config = cfg
	bundle.Config.Fallback = domain.FallbackConfig{MaxAttempts: 1}

	result, err := application.HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4",
	)

	// Contract §5: guardrail evaluator unreachable on a fail-closed guardrail
	// must be `503 guardrail_upstream_unavailable`. Instead the request is
	// dispatched to the provider and a 200 comes back.
	require.NoError(t, err, "AUDIT: fail-closed guardrail did not fail closed")
	require.NotNil(t, result)
	assert.True(t, dispatched,
		"AUDIT: request reached the provider despite a fail-closed guardrail erroring")
}

// Same seam, response direction: a FAIL_CLOSED post guardrail that errors
// lets the model output back to the client unchecked.
func TestAudit_FailClosedGuardrail_PostDirectionFailsOpen(t *testing.T) {
	cfg := fetchBundleConfig(t, bundleJSONFailClosedPostGuardrail)
	require.Len(t, cfg.Guardrails.Post, 1, "attachment must arrive on the response direction via the wire")
	require.Empty(t, cfg.Guardrails.Pre)

	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	guards := &mockGuardrails{
		postFn: func(_ context.Context, _ *domain.Bundle, _ *domain.Request, _ *domain.Response) (domain.GuardrailVerdict, error) {
			return domain.GuardrailVerdict{Action: domain.GuardrailAllow},
				fmt.Errorf("guardrail check returned 502")
		},
	}

	application := New(
		WithProviders(provider),
		WithGuardrails(guards),
		WithLogger(zap.NewNop()),
	)

	bundle := testBundle()
	bundle.Config = cfg
	bundle.Config.Fallback = domain.FallbackConfig{MaxAttempts: 1}

	result, err := application.HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4",
	)
	require.NoError(t, err, "AUDIT: fail-closed post guardrail did not fail closed")
	assert.Equal(t, successResponse().Body, result.Response.Body,
		"AUDIT: unchecked model output returned to the client")
}

// FINDING B — policy_rules.tools / policy_rules.models are silently not
// enforced on the Gemini-native /v1beta passthrough surface, because the
// extractors in adapters/policy/matcher.go only understand the OpenAI
// (`tools[].function.name`, top-level `model`) and Anthropic (`tools[].name`)
// body shapes. Gemini declares tools at `tools[].functionDeclarations[].name`
// and carries the model in the URL path, not the body.
func TestAudit_PolicyRules_NotEnforcedOnGeminiBodyShape(t *testing.T) {
	m := policy.NewMatcher()

	denyShellTools := []domain.PolicyRule{
		{Pattern: "^shell\\.", Type: domain.PolicyDeny, Target: domain.PolicyTargetTool},
	}

	// Control: the same policy blocks the OpenAI shape.
	openAIBody := []byte(`{"model":"gpt-4o","tools":[{"function":{"name":"shell.exec"}}]}`)
	require.Error(t, m.Check(context.Background(), denyShellTools, openAIBody))

	// Gemini-native shape (what gemini-cli and @google/genai POST to
	// /v1beta/models/gemini-2.5-pro:generateContent) declaring the same tool.
	geminiBody := []byte(`{"contents":[{"role":"user","parts":[{"text":"hi"}]}],` +
		`"tools":[{"functionDeclarations":[{"name":"shell.exec","description":"run a shell command"}]}]}`)
	err := m.Check(context.Background(), denyShellTools, geminiBody)
	assert.NoError(t, err,
		"AUDIT: the same tools.deny policy does not fire on the Gemini body shape")

	// Model deny is equally blind: Gemini requests carry no top-level `model`.
	denyProModels := []domain.PolicyRule{
		{Pattern: "^gemini-2\\.5-pro$", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel},
	}
	err = m.Check(context.Background(), denyProModels, geminiBody)
	assert.NoError(t, err,
		"AUDIT: models.deny does not fire for /v1beta requests — model lives in the URL path")
}

// FINDING D — `policy_rules.models` deny is evaluated on the RAW requested
// model string, before alias/prefix resolution, so two first-class request
// forms documented in contract §3 walk straight past it.
//
// Seam: app/app.go:64-93 registers Policy BEFORE ModelResolve;
// adapters/policy/matcher.go:134 reads the top-level `model` field verbatim;
// adapters/modelresolver/resolver.go:38-52 then strips the `provider/` prefix
// (and :27-35 substitutes the alias) and dispatches the real model.
// Contract §5 says a `policy_rules.models` deny match must be 403
// model_not_allowed. `models_allowed` (the glob allowlist) is unaffected by
// the prefix form — it is checked on the stripped id — which is what makes
// the policy-rule gap easy to miss.
func TestAudit_ModelDenyPolicy_BypassedByProviderPrefixAndAlias(t *testing.T) {
	denyGPT4 := []domain.PolicyRule{
		// The exact shape contract §4.2 documents for policy_rules.models.
		{Pattern: "^gpt-4(-turbo)?$", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel},
	}

	newApp := func(dispatched *bool) *App {
		return New(
			WithProviders(&mockProvider{
				dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
					*dispatched = true
					return successResponse(), nil
				},
			}),
			WithPolicy(policy.NewMatcher()),
			WithModels(modelresolver.New()),
			WithLogger(zap.NewNop()),
		)
	}

	// Control: the bare form is blocked, as the operator expects.
	blocked := false
	bundle := testBundle()
	bundle.Config.PolicyRules = denyGPT4
	_, err := newApp(&blocked).HandleChat(
		context.Background(), bundle,
		bytes.NewReader([]byte(`{"model":"gpt-4","messages":[]}`)), "gpt-4",
	)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
	assert.False(t, blocked)

	// Bypass 1: the explicit `<provider>/<model>` form (contract §3).
	dispatched := false
	bundle2 := testBundle()
	bundle2.Config.PolicyRules = denyGPT4
	res, err := newApp(&dispatched).HandleChat(
		context.Background(), bundle2,
		bytes.NewReader([]byte(`{"model":"openai/gpt-4","messages":[]}`)), "openai/gpt-4",
	)
	require.NoError(t, err, "AUDIT: models.deny bypassed by the provider-prefixed form")
	require.NotNil(t, res)
	assert.True(t, dispatched, "AUDIT: the denied model was dispatched as openai/gpt-4")

	// Bypass 2: a VK model alias pointing at the denied model.
	dispatched = false
	bundle3 := testBundle()
	bundle3.Config.PolicyRules = denyGPT4
	bundle3.Config.ModelAliases = map[string]domain.ModelAlias{
		"cheap": {ProviderID: domain.ProviderOpenAI, Model: "gpt-4"},
	}
	_, err = newApp(&dispatched).HandleChat(
		context.Background(), bundle3,
		bytes.NewReader([]byte(`{"model":"cheap","messages":[]}`)), "cheap",
	)
	require.NoError(t, err, "AUDIT: models.deny bypassed by a model alias")
	assert.True(t, dispatched, "AUDIT: the denied model was dispatched via the alias")
}

// FINDING D, second half — an alias skips the `models_allowed` glob allowlist
// entirely: adapters/modelresolver/resolver.go:27-35 returns before
// modelAllowed() is reached, while the explicit and implicit branches both
// check it.
func TestAudit_ModelsAllowed_SkippedByAlias(t *testing.T) {
	r := modelresolver.New()
	cfg := domain.BundleConfig{
		AllowedModels: []string{"claude-*"},
		ModelAliases: map[string]domain.ModelAlias{
			"fast": {ProviderID: domain.ProviderOpenAI, Model: "gpt-4"},
		},
	}

	// Control: asking for gpt-4 directly is refused by the allowlist.
	_, err := r.Resolve(context.Background(), "gpt-4", cfg)
	require.Error(t, err)

	// Via the alias the same model resolves without an allowlist check.
	got, err := r.Resolve(context.Background(), "fast", cfg)
	require.NoError(t, err, "AUDIT: alias skipped the models_allowed allowlist")
	assert.Equal(t, "gpt-4", got.ModelID)
}

// FINDING C — a cache rule matched on `principal_id` never fires, because
// nothing ever populates domain.CacheEvalContext.PrincipalID.
//
// Seam: the cache-rule form offers a principal matcher
// (src/components/gateway/cacheRule.form.tsx:100), the materialiser ships it
// (config.materialiser.ts:cacheRuleToWire), config_wire.go:262 decodes it into
// CacheRuleMatch.Principals, and adapters/cacherules/evaluator.go:60 compares it
// against eval.PrincipalID — which app/pipeline/cache.go:20-25 never sets, and
// which domain.Bundle carries no source for. Fail-safe direction in the
// evaluator, so the rule silently drops instead of over-applying: a
// "disable caching for this principal" rule is configured, enabled, and inert.
func TestAudit_CacheRule_PrincipalMatcherNeverFires(t *testing.T) {
	applied := ""
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}

	application := New(
		WithProviders(provider),
		WithCache(cacherules.NewEvaluator()),
		WithModels(modelresolver.New()),
		WithLogger(zap.NewNop()),
	)

	bundle := testBundle()
	bundle.Config.CacheRules = []domain.CacheRule{{
		ID:       "rule_no_cache_for_alice",
		Priority: 1,
		Match:    domain.CacheRuleMatch{Principals: []string{"user_alice"}},
		Action:   domain.CacheActionDisable,
	}}

	result, err := application.HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4",
	)
	require.NoError(t, err)
	applied = result.Meta.CacheMode
	assert.NotEqual(t, "disable", applied,
		"AUDIT: principal-matched cache rule did not apply — PrincipalID is never populated")

	// Control: the same rule keyed on the VK id (which IS populated) fires.
	bundle2 := testBundle()
	bundle2.Config.CacheRules = []domain.CacheRule{{
		ID:       "rule_no_cache_for_vk",
		Priority: 1,
		Match:    domain.CacheRuleMatch{VKIDs: []string{bundle2.VirtualKeyID}},
		Action:   domain.CacheActionDisable,
	}}
	result2, err := application.HandleChat(
		context.Background(), bundle2, bytes.NewReader(testBody()), "gpt-4",
	)
	require.NoError(t, err)
	assert.Equal(t, "disable", result2.Meta.CacheMode,
		"control: a matcher the pipeline does populate does fire")
}

// FINDING B, end-to-end through the real interceptor chain with the real
// policy matcher: a passthrough request carrying a denied tool is dispatched.
func TestAudit_PolicyInterceptor_PassesGeminiToolThrough(t *testing.T) {
	dispatched := false
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			dispatched = true
			return successResponse(), nil
		},
	}

	application := New(
		WithProviders(provider),
		WithPolicy(policy.NewMatcher()),
		WithLogger(zap.NewNop()),
	)

	bundle := testBundle()
	bundle.Config.PolicyRules = []domain.PolicyRule{
		{Pattern: "^shell\\.", Type: domain.PolicyDeny, Target: domain.PolicyTargetTool},
	}

	geminiBody := []byte(`{"contents":[{"role":"user","parts":[{"text":"hi"}]}],` +
		`"tools":[{"functionDeclarations":[{"name":"shell.exec"}]}]}`)

	_, err := application.HandlePassthrough(
		context.Background(), bundle, bytes.NewReader(geminiBody), "gemini-2.5-pro",
		domain.PassthroughRequest{Method: "POST", Path: "/models/gemini-2.5-pro:generateContent"},
	)
	require.NoError(t, err)
	assert.True(t, dispatched,
		"AUDIT: denied tool reached the provider through the /v1beta surface")

	// Control: the same rule blocks the same logical request on /v1/chat/completions.
	dispatched = false
	openAIBody := []byte(`{"model":"gpt-4o","tools":[{"function":{"name":"shell.exec"}}]}`)
	_, err = application.HandleChat(context.Background(), bundle, bytes.NewReader(openAIBody), "gpt-4o")
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
	assert.False(t, dispatched)
}
