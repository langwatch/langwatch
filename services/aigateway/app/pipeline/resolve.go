package pipeline

import (
	"context"

	"github.com/bytedance/sonic"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// ResolveModelFunc resolves a request's model against bundle config.
type ResolveModelFunc func(ctx context.Context, req *domain.Request, config domain.BundleConfig) (*domain.ResolvedModel, error)

// CheckModelFunc applies the policy model rules to a resolved model.
type CheckModelFunc func(ctx context.Context, rules []domain.PolicyRule, resolved domain.ResolvedModel) error

// ModelResolve creates an interceptor that resolves model aliases, applies
// the policy model rules to what the alias resolved to, and rewrites the
// request body with the canonical model name.
//
// The model rules are enforced here rather than in the Policy interceptor
// because only here is the real model known. Policy stays where it is: it
// also covers tools, MCP and URLs, and moving it would change which rejection
// a request carrying several violations gets.
func ModelResolve(resolve ResolveModelFunc, checkModel CheckModelFunc) Interceptor {
	return PreOnly("model_resolve", func(ctx context.Context, call *Call) error {
		resolved, err := resolve(ctx, call.Request, call.Bundle.Config)
		if err != nil {
			return err
		}
		// The policy model rules run here, on what the resolver settled on,
		// and before the request is marked resolved.
		if checkModel != nil && len(call.Bundle.Config.PolicyRules) > 0 {
			if err := checkModel(ctx, call.Bundle.Config.PolicyRules, *resolved); err != nil {
				return err
			}
		}
		call.Request.Resolved = resolved
		return rewriteResolvedModel(call, resolved)
	})
}

// rewriteResolvedModel puts the canonical model name in the body when the
// caller named something else (an alias, or a provider-qualified spelling).
func rewriteResolvedModel(call *Call, resolved *domain.ResolvedModel) error {
	if call.Request.Model == resolved.ModelID {
		return nil
	}
	if err := call.MaterializeBody(); err != nil {
		return err
	}
	call.Request.Body = rewriteModel(call.Request.Body, resolved.ModelID)
	return nil
}

func rewriteModel(body []byte, model string) []byte {
	var obj map[string]any
	if err := sonic.Unmarshal(body, &obj); err != nil {
		return body
	}
	obj["model"] = model
	out, err := sonic.Marshal(obj)
	if err != nil {
		return body
	}
	return out
}
