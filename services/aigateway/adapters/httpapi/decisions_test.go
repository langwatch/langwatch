package httpapi

// Binds specs/ai-gateway/decisions-endpoint.feature: POST /v1/decisions
// through the real Bifrost dispatch, against a local server standing in for
// OpenAI, so the path, the key swap, the base URL and the metering are the
// ones production runs.

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/adapters/providers"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const decisionsRequest = `{"model":"openai/gpt-6-luna","input":"Release the key to the deploy agent?",` +
	`"questions":[{"type":"choice","name":"release","instructions":"Decide.","choices":[` +
	`{"value":"allow","description":"release it"},{"value":"deny","description":"keep it"}]},` +
	`{"type":"predicate","name":"requester_backs_it","instructions":"Does the requester back it?"}]}`

const decisionsAnswer = `{"answers":[{"type":"choice","name":"release","choice":"allow",` +
	`"probabilities":[{"value":"allow","probability":0.9},{"value":"deny","probability":0.1}],"confidence":0.9},` +
	`{"type":"predicate","name":"requester_backs_it","probability":0.8}],` +
	`"usage":{"input_tokens":1234,"input_tokens_details":{"cached_tokens":1000},"output_tokens":7}}`

// decisionsVendor stands in for OpenAI and records what reached it.
type decisionsVendor struct {
	mu     sync.Mutex
	path   string
	auth   string
	body   string
	hits   int
	server *httptest.Server
}

func newDecisionsVendor(t *testing.T, status int, answer string) *decisionsVendor {
	t.Helper()
	v := &decisionsVendor{}
	v.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		v.mu.Lock()
		v.path, v.auth, v.body = r.URL.Path, r.Header.Get("Authorization"), string(body)
		v.hits++
		v.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(answer))
	}))
	t.Cleanup(v.server.Close)
	return v
}

func (v *decisionsVendor) snapshot() (path, auth, body string, hits int) {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.path, v.auth, v.body, v.hits
}

type decisionsGateway struct {
	router http.Handler
	spend  *spendLedger
	spans  *spanLog
}

type decisionsSetup struct {
	vendor *decisionsVendor
	creds  []domain.Credential
	budget app.Option
	allow  []string
}

// newDecisionsGateway wires the router over the real Bifrost dispatch. The
// stock OpenAI provider is pointed at the vendor too, so a credential with no
// base URL is served there.
func newDecisionsGateway(t *testing.T, setup decisionsSetup) *decisionsGateway {
	t.Helper()
	bf, err := providers.NewBifrostRouter(context.Background(), providers.BifrostOptions{
		Logger:           zap.NewNop(),
		OpenAIBackendURL: setup.vendor.server.URL,
	})
	require.NoError(t, err)
	t.Cleanup(bf.Close)

	gw := &decisionsGateway{spend: &spendLedger{}, spans: &spanLog{}}
	opts := []app.Option{
		app.WithAuth(&mockAuth{resolveFn: func(context.Context, string) (*domain.Bundle, error) {
			b := testBundle()
			b.Credentials = setup.creds
			b.Config.AllowedModels = setup.allow
			return b, nil
		}}),
		app.WithProviders(bf),
		app.WithModels(modelresolver.New()),
		app.WithSpend(gw.spend),
		app.WithTraces(gw.spans),
		app.WithLogger(zap.NewNop()),
	}
	if setup.budget != nil {
		opts = append(opts, setup.budget)
	}
	gw.router = buildRouter(opts...)
	return gw
}

func (g *decisionsGateway) post(t *testing.T, body string, headers ...string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/decisions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	g.router.ServeHTTP(rec, req)
	return rec
}

func openAICred(extra map[string]string) domain.Credential {
	return domain.Credential{ID: "cred-openai", ProviderID: domain.ProviderOpenAI, APIKey: "sk-real-provider-key", Extra: extra}
}

// @scenario "A decisions call is relayed and metered"
func TestDecisions_RelayedAndMetered(t *testing.T) {
	vendor := newDecisionsVendor(t, http.StatusOK, decisionsAnswer)
	gw := newDecisionsGateway(t, decisionsSetup{vendor: vendor, creds: []domain.Credential{openAICred(nil)}})

	rec := gw.post(t, decisionsRequest)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.JSONEq(t, decisionsAnswer, rec.Body.String(), "the answer reaches the caller as the provider wrote it")

	path, auth, body, hits := vendor.snapshot()
	assert.Equal(t, 1, hits)
	assert.Equal(t, "/v1/decisions", path)
	assert.Equal(t, "Bearer sk-real-provider-key", auth, "the provider key replaces the virtual key")
	assert.Equal(t, "gpt-6-luna", gjson.Get(body, "model").String(), "the resolved model goes upstream")
	assert.Equal(t, 2, int(gjson.Get(body, "questions.#").Int()), "the questions go upstream unchanged")

	confirms, fails := gw.spend.settled(t)
	require.Len(t, confirms, 1, "fails: %+v", fails)
	assert.Equal(t, 1234, confirms[0].Usage.PromptTokens)
	assert.Equal(t, 7, confirms[0].Usage.CompletionTokens)
	assert.Equal(t, 1000, confirms[0].Usage.CacheReadTokens)
	assert.Equal(t, "gpt-6-luna", confirms[0].Model)
}

// @scenario "A decisions call attributes spend to its safety_identifier"
func TestDecisions_SafetyIdentifierAttributesSpend(t *testing.T) {
	withID := strings.Replace(decisionsRequest, `"input":`, `"safety_identifier":"member-42","input":`, 1)
	cases := map[string]struct {
		headers []string
		want    string
	}{
		"body field alone": {want: "member-42"},
		"header wins":      {headers: []string{"X-LangWatch-End-User-Id", "member-from-header"}, want: "member-from-header"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			vendor := newDecisionsVendor(t, http.StatusOK, decisionsAnswer)
			gw := newDecisionsGateway(t, decisionsSetup{vendor: vendor, creds: []domain.Credential{openAICred(nil)}})

			rec := gw.post(t, withID, tc.headers...)
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

			confirms, _ := gw.spend.settled(t)
			require.Len(t, confirms, 1)
			assert.Equal(t, tc.want, confirms[0].Attribution.EndUserID)
		})
	}
}

// @scenario "The provider's base URL decides where a decisions call goes"
func TestDecisions_ProviderBaseURLDecidesTheEndpoint(t *testing.T) {
	for name, suffix := range map[string]string{"bare host": "", "with /v1": "/v1", "with /v1/": "/v1/"} {
		t.Run(name, func(t *testing.T) {
			regional := newDecisionsVendor(t, http.StatusOK, decisionsAnswer)
			stock := newDecisionsVendor(t, http.StatusOK, decisionsAnswer)
			gw := newDecisionsGateway(t, decisionsSetup{
				vendor: stock,
				creds:  []domain.Credential{openAICred(map[string]string{"base_url": regional.server.URL + suffix})},
			})

			rec := gw.post(t, decisionsRequest)
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

			path, auth, _, hits := regional.snapshot()
			assert.Equal(t, 1, hits, "the provider's base URL receives the call")
			assert.Equal(t, "/v1/decisions", path)
			assert.Equal(t, "Bearer sk-real-provider-key", auth)
			_, _, _, stockHits := stock.snapshot()
			assert.Equal(t, 0, stockHits, "the stock endpoint is not called when a base URL is set")
		})
	}
}

// @scenario "An exhausted budget blocks a decisions call before the provider"
func TestDecisions_BudgetBlockStopsBeforeTheProvider(t *testing.T) {
	vendor := newDecisionsVendor(t, http.StatusOK, decisionsAnswer)
	block := &mockBudget{precheckFn: func(context.Context, *domain.Bundle) (domain.BudgetDecision, error) {
		return domain.BudgetDecision{Verdict: domain.BudgetBlock}, nil
	}}
	gw := newDecisionsGateway(t, decisionsSetup{
		vendor: vendor, creds: []domain.Credential{openAICred(nil)}, budget: app.WithBudget(block),
	})

	rec := gw.post(t, decisionsRequest)

	assert.Equal(t, http.StatusPaymentRequired, rec.Code)
	assert.Equal(t, "budget_exceeded", gjson.Get(rec.Body.String(), "error.type").String(), rec.Body.String())
	_, _, _, hits := vendor.snapshot()
	assert.Equal(t, 0, hits, "a blocked call must not reach the provider")
}

// @scenario "A provider error on a decisions call keeps its status"
func TestDecisions_ProviderErrorKeepsItsStatus(t *testing.T) {
	const providerError = `{"error":{"message":"Unknown question type: ranking","type":"invalid_request_error","code":null}}`
	vendor := newDecisionsVendor(t, http.StatusBadRequest, providerError)
	gw := newDecisionsGateway(t, decisionsSetup{vendor: vendor, creds: []domain.Credential{openAICred(nil)}})

	rec := gw.post(t, decisionsRequest)

	assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "Unknown question type: ranking")
}

// @scenario "A decisions call on a key without an OpenAI provider is refused"
func TestDecisions_NonOpenAIKeyIsRefused(t *testing.T) {
	vendor := newDecisionsVendor(t, http.StatusOK, decisionsAnswer)
	gw := newDecisionsGateway(t, decisionsSetup{
		vendor: vendor,
		creds: []domain.Credential{{
			ID: "cred-anthropic", ProviderID: domain.ProviderAnthropic, APIKey: "sk-ant",
			Extra: map[string]string{"base_url": vendor.server.URL},
		}},
	})

	rec := gw.post(t, strings.Replace(decisionsRequest, "openai/gpt-6-luna", "gpt-6-luna", 1))

	assert.GreaterOrEqual(t, rec.Code, 400, rec.Body.String())
	assert.Less(t, rec.Code, 500, rec.Body.String())
	assert.Equal(t, string(domain.ErrProviderNotBound), gjson.Get(rec.Body.String(), "error.type").String(), rec.Body.String())
	assert.Contains(t, gjson.Get(rec.Body.String(), "error.message").String(), `"openai"`)
	_, _, _, hits := vendor.snapshot()
	assert.Equal(t, 0, hits)
}

// @scenario "A decisions call naming a model the key does not allow is refused"
func TestDecisions_ModelOutsideTheAllowlistIsRefused(t *testing.T) {
	vendor := newDecisionsVendor(t, http.StatusOK, decisionsAnswer)
	gw := newDecisionsGateway(t, decisionsSetup{
		vendor: vendor, creds: []domain.Credential{openAICred(nil)}, allow: []string{"openai/gpt-5-mini"},
	})

	rec := gw.post(t, decisionsRequest)

	assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	assert.Equal(t, string(domain.ErrModelNotAllowed), gjson.Get(rec.Body.String(), "error.type").String())
	_, _, _, hits := vendor.snapshot()
	assert.Equal(t, 0, hits)
}

// @scenario "A decisions call with no model is refused"
func TestDecisions_MissingModelIsRefused(t *testing.T) {
	vendor := newDecisionsVendor(t, http.StatusOK, decisionsAnswer)
	gw := newDecisionsGateway(t, decisionsSetup{vendor: vendor, creds: []domain.Credential{openAICred(nil)}})

	rec := gw.post(t, `{"input":"x","questions":[]}`)

	assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	assert.Equal(t, string(domain.ErrMissingModel), gjson.Get(rec.Body.String(), "error.type").String())
	assert.Contains(t, rec.Body.String(), "POST /v1/decisions")
	_, _, _, hits := vendor.snapshot()
	assert.Equal(t, 0, hits)
}
