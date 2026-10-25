package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/services/aigateway/dispatcher"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// repoCatalogue is the app's own model catalogue, the one the images ship.
const repoCatalogue = "../../../../../../modules/model-provider/contract/src/catalog"

func writeCatalogue(t *testing.T, base, overlay string) string {
	t.Helper()
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "model-catalog.json"), []byte(base), 0o600))
	if overlay != "" {
		require.NoError(t, os.WriteFile(filepath.Join(dir, "model-catalog.overlay.json"), []byte(overlay), 0o600))
	}
	return dir
}

type cataloguePrice struct {
	Input      float64  `json:"inputCostPerToken"`
	Output     float64  `json:"outputCostPerToken"`
	CacheRead  *float64 `json:"inputCacheReadPerToken"`
	CacheWrite *float64 `json:"inputCacheWritePerToken"`
}

func repoPrice(t *testing.T, id string) cataloguePrice {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repoCatalogue, "model-catalog.json"))
	require.NoError(t, err)
	var catalogue struct {
		Models map[string]struct {
			Pricing cataloguePrice `json:"pricing"`
		} `json:"models"`
	}
	require.NoError(t, json.Unmarshal(raw, &catalogue))
	model, ok := catalogue.Models[id]
	require.True(t, ok, "the catalogue has no %s", id)
	return model.Pricing
}

func loadRepoPricing(t *testing.T) *Pricing {
	t.Helper()
	pricing, err := LoadPricing(repoCatalogue, zap.NewNop())
	require.NoError(t, err)
	return pricing
}

func TestPricingLoadsTheCatalogueWithTheOverlayWinning(t *testing.T) {
	dir := writeCatalogue(t, `{"models":{
		"openai/judge":{"provider":"openai","mode":"chat","pricing":{"inputCostPerToken":0.001,"outputCostPerToken":0.002}},
		"openai/embedder":{"mode":"embedding","pricing":{"inputCostPerToken":0.0001}},
		"openai/speaker":{"mode":"audio","pricing":{"inputCostPerToken":0.5}},
		"~openai/latest":{"provider":"~openai","pricing":{"inputCostPerToken":0.5}},
		"openai/free-text":{"pricing":{"outputCostPerToken":0.5}},
		"openai/moved":{"mode":"chat","pricing":{"inputCostPerToken":0.5}}
	}}`, `{"models":{
		"openai/judge":{"mode":"chat","pricing":{"inputCostPerToken":0.003,"outputCostPerToken":0.004}},
		"openai/moved":{"mode":"audio","pricing":{"inputCostPerToken":0.5}}
	}}`)

	pricing, err := LoadPricing(dir, zap.NewNop())
	require.NoError(t, err)

	assert.Equal(t, 2, pricing.Len(), "only chat and embedding entries with an input price, never a ~ alias")
	cost := pricing.Cost([]string{"openai/judge"}, domain.Usage{PromptTokens: 10, CompletionTokens: 10})
	require.NotNil(t, cost)
	assert.InDelta(t, 10*0.003+10*0.004, *cost, 1e-15, "the overlay's price wins")
	assert.Nil(t, pricing.Cost([]string{"openai/moved"}, domain.Usage{PromptTokens: 10}), "the overlay's mode wins too")
}

func TestPricingWithoutAnOverlayReadsTheBaseCatalogue(t *testing.T) {
	dir := writeCatalogue(t, `{"models":{"openai/judge":{"pricing":{"inputCostPerToken":0.001}}}}`, "")

	pricing, err := LoadPricing(dir, zap.NewNop())

	require.NoError(t, err)
	assert.Equal(t, 1, pricing.Len())
}

func TestPricingRefusesAnUnreadableCatalogue(t *testing.T) {
	dir := writeCatalogue(t, `{"models":`, "")

	_, err := LoadPricing(dir, zap.NewNop())

	require.Error(t, err)
}

// @scenario "An LLM evaluator's cost is priced from the model catalogue"
func TestPricingPricesAKnownModelAtTheCataloguesPrices(t *testing.T) {
	pricing := loadRepoPricing(t)

	t.Run("input and output", func(t *testing.T) {
		price := repoPrice(t, "openai/gpt-5-mini")
		cost := pricing.Cost([]string{"openai/gpt-5-mini"}, domain.Usage{PromptTokens: 1000, CompletionTokens: 200})
		require.NotNil(t, cost)
		assert.InDelta(t, 1000*price.Input+200*price.Output, *cost, 1e-15)
	})
	t.Run("cached reads come out of the input, not on top of it", func(t *testing.T) {
		price := repoPrice(t, "openai/gpt-5-mini")
		require.NotNil(t, price.CacheRead)
		cost := pricing.Cost([]string{"openai/gpt-5-mini"}, domain.Usage{PromptTokens: 1000, CompletionTokens: 200, CacheReadTokens: 600})
		require.NotNil(t, cost)
		assert.InDelta(t, 400*price.Input+600**price.CacheRead+200*price.Output, *cost, 1e-15)
	})
	t.Run("cache reads and writes each at their own price", func(t *testing.T) {
		price := repoPrice(t, "anthropic/claude-sonnet-4-5")
		require.NotNil(t, price.CacheRead)
		require.NotNil(t, price.CacheWrite)
		usage := domain.Usage{PromptTokens: 1000, CompletionTokens: 200, CacheReadTokens: 600, CacheCreationTokens: 100}
		cost := pricing.Cost([]string{"anthropic/claude-sonnet-4-5"}, usage)
		require.NotNil(t, cost)
		assert.InDelta(t, 300*price.Input+600**price.CacheRead+100**price.CacheWrite+200*price.Output, *cost, 1e-15)
	})
	t.Run("a missing cache price falls back to the input price, as LiteLLM does", func(t *testing.T) {
		price := repoPrice(t, "openai/gpt-5-mini")
		require.Nil(t, price.CacheWrite)
		cost := pricing.Cost([]string{"openai/gpt-5-mini"}, domain.Usage{PromptTokens: 1000, CacheCreationTokens: 100})
		require.NotNil(t, cost)
		assert.InDelta(t, 1000*price.Input, *cost, 1e-15)
	})
}

// @scenario "An LLM evaluator's cost is priced from the model catalogue"
func TestPricingReportsNoCostForAModelWithoutAPrice(t *testing.T) {
	core, logs := observer.New(zapcore.WarnLevel)
	pricing, err := LoadPricing(repoCatalogue, zap.New(core))
	require.NoError(t, err)

	for range 3 {
		assert.Nil(t, pricing.Cost([]string{"openai/not-a-model"}, domain.Usage{PromptTokens: 1000}))
	}
	assert.Equal(t, 1, logs.FilterMessage("evaluator_model_unpriced").Len(), "warned once per model")

	var none *Pricing
	assert.Nil(t, none.Cost([]string{"openai/gpt-5-mini"}, domain.Usage{PromptTokens: 1000}), "no catalogue prices nothing")
}

func TestPricingKeysFollowTheModelActuallyCalled(t *testing.T) {
	cases := []struct {
		name  string
		model string
		env   map[string]string
		want  []string
	}{
		{"the provider's catalogue id", "openai/gpt-5-mini", nil, []string{"openai/gpt-5-mini"}},
		{"a bare model is openai's", "gpt-5-mini", nil, []string{"openai/gpt-5-mini"}},
		{"the tenant's model override wins", "openai/gpt-5-mini", map[string]string{"X_LITELLM_model": "anthropic/claude-sonnet-4.5"}, []string{"anthropic/claude-sonnet-4-5", "anthropic/claude-sonnet-4.5"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := map[string]string{"X_LITELLM_api_key": "sk-tenant"}
			for key, value := range tc.env {
				env[key] = value
			}
			_, target, err := completionCall(chat(env, tc.model))
			require.NoError(t, err)
			assert.Equal(t, tc.want, target.pricingKeys())
		})
	}
}

// @scenario "An LLM evaluator's cost is priced from the model catalogue"
func TestAJudgeCallThroughTheGatewayReportsTheCataloguePrice(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl-1","object":"chat.completion","created":1,"model":"gpt-5-mini",
			"choices":[{"index":0,"message":{"role":"assistant","content":"yes"},"finish_reason":"stop"}],
			"usage":{"prompt_tokens":1000,"completion_tokens":200,"total_tokens":1200,"prompt_tokens_details":{"cached_tokens":600}}}`))
	}))
	t.Cleanup(upstream.Close)
	disp, err := dispatcher.New(t.Context(), dispatcher.Options{})
	require.NoError(t, err)
	t.Cleanup(disp.Close)

	channel := New(Options{Dispatcher: disp, Pricing: loadRepoPricing(t)})
	out, err := channel.Complete(t.Context(), chat(map[string]string{
		"X_LITELLM_api_key":  "sk-acme",
		"X_LITELLM_api_base": upstream.URL + "/v1",
	}, "openai/gpt-5-mini"))

	require.NoError(t, err)
	price := repoPrice(t, "openai/gpt-5-mini")
	require.NotNil(t, out.CostUSD, "a judge model with a catalogue price reports its cost")
	assert.InDelta(t, 400*price.Input+600**price.CacheRead+200*price.Output, *out.CostUSD, 1e-15)
}
