package pipeline

import (
	"context"

	"github.com/bytedance/sonic"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// ResolveModelFunc resolves a raw model string against bundle config.
type ResolveModelFunc func(ctx context.Context, rawModel string, config domain.BundleConfig) (*domain.ResolvedModel, error)

// ModelResolve creates an interceptor that resolves model aliases and
// rewrites the request body with the canonical model name.
func ModelResolve(resolve ResolveModelFunc) Interceptor {
	return PreOnly("model_resolve", func(ctx context.Context, call *Call) error {
		resolved, err := resolve(ctx, call.Request.Model, call.Bundle.Config)
		if err != nil {
			return err
		}
		call.Request.Resolved = resolved
		if call.Request.Model != resolved.ModelID {
			if err := call.MaterializeBody(); err != nil {
				return err
			}
			call.Request.Body = rewriteModel(call.Request.Body, resolved.ModelID)
		}
		return nil
	})
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
