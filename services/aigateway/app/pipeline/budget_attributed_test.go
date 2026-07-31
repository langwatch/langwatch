package pipeline

import (
	"context"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func templateBundle() *domain.Bundle {
	return &domain.Bundle{
		OrganizationID: "org_1",
		ProjectID:      "proj_1",
		VirtualKeyID:   "vk_1",
		Config: domain.BundleConfig{
			Budget: domain.BudgetConfig{
				Scopes: []domain.BudgetScope{{
					ID:            "budget_tpl",
					Scope:         "attributed_user",
					ScopeID:       "vk_1",
					PerUser:       true,
					Window:        "month",
					LimitMicroUSD: 100_000_000,
					OnBreach:      "block",
				}},
			},
		},
	}
}

/** @scenario The end-user id resolves headers first, then the body user field */
func TestResolveEndUserPrecedence(t *testing.T) {
	call := spendTestCall()
	// Body carries end-user-9; with no header context the body wins.
	if got := ResolveEndUser(context.Background(), call); got != "end-user-9" {
		t.Fatalf("body user = %q, want end-user-9", got)
	}
	// A middleware-lifted header value (either header, already resolved in
	// precedence order there) beats the body.
	ctx := customertracebridge.WithEndUserID(context.Background(), "header-user")
	if got := ResolveEndUser(ctx, call); got != "header-user" {
		t.Fatalf("header user = %q, want header-user", got)
	}
}

/** @scenario A request with no end-user id is rejected while a template is active */
func TestBudgetFailsClosedWithoutEndUser(t *testing.T) {
	call := spendTestCall()
	call.Bundle = templateBundle()
	call.Request.Body = []byte(`{"model":"gpt-x"}`)

	precheck := func(_ context.Context, _ *domain.Bundle) (domain.BudgetDecision, error) {
		t.Fatal("precheck must not run: the fail-closed check rejects first")
		return domain.BudgetDecision{}, nil
	}
	interceptor := Budget(precheck, zap.NewNop())
	_, err := interceptor.Sync(func(_ context.Context, _ *Call) (*domain.Response, error) {
		t.Fatal("dispatch must not run")
		return nil, nil
	})(context.Background(), call)
	if err == nil {
		t.Fatal("expected the end-user-required rejection")
	}
	if !herr.IsCode(err, domain.ErrEndUserRequired) {
		t.Fatalf("err = %v, want code %q", err, domain.ErrEndUserRequired)
	}
}
