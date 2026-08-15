package pipeline

import (
	"context"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// PolicyCheckFunc checks request body against policy rules.
type PolicyCheckFunc func(ctx context.Context, rules []domain.PolicyRule, body []byte) error

// Policy creates an interceptor that rejects requests violating policy rules.
//
// `canEnforceModelRules` says whether a model resolver is wired, which is what
// enforces the model dimension (on the resolved id, from ModelResolve). Without
// one, a bundle carrying a model rule is refused rather than served: an
// unenforced deny rule looks exactly like a working one from the outside, and
// serving the request would silently grant what the rule exists to withhold.
func Policy(check PolicyCheckFunc, canEnforceModelRules bool) Interceptor {
	return PreOnly("policy", func(ctx context.Context, call *Call) error {
		rules := call.Bundle.Config.PolicyRules
		if len(rules) == 0 {
			return nil
		}
		if !canEnforceModelRules && hasModelRule(rules) {
			return herr.New(ctx, domain.ErrInternal, herr.M{
				"message": "this gateway cannot enforce the model rules on this key's routing policy",
				"fault":   "platform",
			})
		}
		if err := call.MaterializeBody(); err != nil {
			return err
		}
		return check(ctx, rules, call.Request.Body)
	})
}

func hasModelRule(rules []domain.PolicyRule) bool {
	for _, r := range rules {
		if r.Target == domain.PolicyTargetModel {
			return true
		}
	}
	return false
}
