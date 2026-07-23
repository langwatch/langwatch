package pipeline

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func runCacheInterceptor(t *testing.T, call *Call, evaluate EvaluateCacheFunc) {
	t.Helper()
	next := func(context.Context, *Call) (*domain.Response, error) {
		return &domain.Response{}, nil
	}
	_, err := Cache(evaluate).Sync(next)(context.Background(), call)
	require.NoError(t, err)
}

func neverEvaluate(t *testing.T) EvaluateCacheFunc {
	t.Helper()
	return func(context.Context, []domain.CacheRule, domain.CacheEvalContext) *domain.CacheDecision {
		t.Fatal("evaluate must not be called without configured rules")
		return nil
	}
}

// @scenario "Anthropic-bound requests get a prompt-cache breakpoint by default"
// @scenario "Providers that cache automatically are left alone"
func TestCacheInterceptor(t *testing.T) {
	t.Run("when no rules are configured", func(t *testing.T) {
		t.Run("anthropic chat requests get the provider-default breakpoint", func(t *testing.T) {
			call := &Call{
				Bundle: &domain.Bundle{},
				Request: &domain.Request{
					Type:     domain.RequestTypeChat,
					Body:     largeChatBody(t),
					Resolved: &domain.ResolvedModel{ProviderID: domain.ProviderAnthropic},
				},
				Meta: &Meta{},
			}

			runCacheInterceptor(t, call, neverEvaluate(t))

			assert.Contains(t, string(call.Request.Body), `"cache_control"`)
			assert.Equal(t, "auto", call.Meta.CacheMode)
		})

		t.Run("openai chat requests are left untouched", func(t *testing.T) {
			body := largeChatBody(t)
			call := &Call{
				Bundle: &domain.Bundle{},
				Request: &domain.Request{
					Type:     domain.RequestTypeChat,
					Body:     append([]byte(nil), body...),
					Resolved: &domain.ResolvedModel{ProviderID: domain.ProviderOpenAI},
				},
				Meta: &Meta{},
			}

			runCacheInterceptor(t, call, neverEvaluate(t))

			assert.Equal(t, body, call.Request.Body)
			assert.Empty(t, call.Meta.CacheMode)
		})
	})

	t.Run("when a disable rule matches an anthropic request", func(t *testing.T) {
		t.Run("the rule wins over the provider default", func(t *testing.T) {
			call := &Call{
				Bundle: &domain.Bundle{Config: domain.BundleConfig{
					CacheRules: []domain.CacheRule{{ID: "r1", Action: domain.CacheActionDisable}},
				}},
				Request: &domain.Request{
					Type:     domain.RequestTypeChat,
					Body:     largeChatBody(t),
					Resolved: &domain.ResolvedModel{ProviderID: domain.ProviderAnthropic},
				},
				Meta: &Meta{},
			}
			evaluate := func(_ context.Context, rules []domain.CacheRule, _ domain.CacheEvalContext) *domain.CacheDecision {
				return &domain.CacheDecision{Action: rules[0].Action, RuleID: rules[0].ID}
			}

			runCacheInterceptor(t, call, evaluate)

			assert.NotContains(t, string(call.Request.Body), `"cache_control"`)
			assert.Equal(t, string(domain.CacheActionDisable), call.Meta.CacheMode)
		})
	})

	t.Run("when rules are configured but none match", func(t *testing.T) {
		t.Run("the provider default still applies", func(t *testing.T) {
			call := &Call{
				Bundle: &domain.Bundle{Config: domain.BundleConfig{
					CacheRules: []domain.CacheRule{{ID: "r1", Action: domain.CacheActionDisable}},
				}},
				Request: &domain.Request{
					Type:     domain.RequestTypeChat,
					Body:     largeChatBody(t),
					Resolved: &domain.ResolvedModel{ProviderID: domain.ProviderAnthropic},
				},
				Meta: &Meta{},
			}
			evaluate := func(context.Context, []domain.CacheRule, domain.CacheEvalContext) *domain.CacheDecision {
				return nil
			}

			runCacheInterceptor(t, call, evaluate)

			assert.Contains(t, string(call.Request.Body), `"cache_control"`)
			assert.Equal(t, "auto", call.Meta.CacheMode)
		})
	})
}
