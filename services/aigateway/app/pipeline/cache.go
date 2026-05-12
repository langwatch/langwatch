package pipeline

import (
	"context"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// EvaluateCacheFunc evaluates cache rules for a request.
type EvaluateCacheFunc func(ctx context.Context, rules []domain.CacheRule, eval domain.CacheEvalContext) *domain.CacheDecision

// Cache creates an interceptor that evaluates cache rules and applies
// cache control to the request body.
func Cache(evaluate EvaluateCacheFunc) Interceptor {
	return PreOnly("cache", func(ctx context.Context, call *Call) error {
		if len(call.Bundle.Config.CacheRules) == 0 {
			return nil
		}
		decision := evaluate(ctx, call.Bundle.Config.CacheRules, domain.CacheEvalContext{
			Model:           call.Request.Model,
			VKID:            call.Bundle.VirtualKeyID,
			VKDisplayPrefix: call.Bundle.Config.VKDisplayPrefix,
			VKTags:          call.Bundle.Config.VKTags,
		})
		if decision != nil {
			call.Meta.CacheMode = string(decision.Action)
			if err := call.MaterializeBody(); err != nil {
				return err
			}
			call.Request.Body = applyCacheControl(call.Request.Body, decision.Action, call.Request.Type)
		}
		return nil
	})
}
