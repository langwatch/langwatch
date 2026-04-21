package pipeline

import (
	"context"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// PolicyCheckFunc checks request body against policy rules.
type PolicyCheckFunc func(ctx context.Context, rules []domain.PolicyRule, body []byte) error

// Policy creates an interceptor that rejects requests violating policy rules.
func Policy(check PolicyCheckFunc) Interceptor {
	return PreOnly("policy", func(ctx context.Context, call *Call) error {
		if len(call.Bundle.Config.PolicyRules) == 0 {
			return nil
		}
		return check(ctx, call.Bundle.Config.PolicyRules, call.Request.Body)
	})
}
