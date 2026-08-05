package budget

import (
	"context"
	"testing"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type fakeBuckets struct {
	spent map[string]int64
	fail  bool
}

func (f *fakeBuckets) BucketSpendMicroUSD(_ context.Context, budgetID, endUserID string) (int64, bool) {
	if f.fail {
		return 0, false
	}
	v, ok := f.spent[budgetID+":"+endUserID]
	return v, ok
}

func templateBundle(limit int64, onBreach string) *domain.Bundle {
	return &domain.Bundle{
		OrganizationID: "org_1",
		Config: domain.BundleConfig{
			Budget: domain.BudgetConfig{
				Scopes: []domain.BudgetScope{{
					ID:            "budget_tpl",
					Scope:         "attributed_user",
					ScopeID:       "vk_1",
					PerUser:       true,
					Window:        "month",
					LimitMicroUSD: limit,
					OnBreach:      onBreach,
				}},
			},
		},
	}
}

/** @scenario The end-user bucket figure decides block and warn for templates */
func TestTemplateEnforcesTheRequestsOwnBucket(t *testing.T) {
	checker := NewChecker(CheckerOptions{Buckets: &fakeBuckets{spent: map[string]int64{
		"budget_tpl:over-user": 120_000_000,
		"budget_tpl:warn-user": 85_000_000,
		"budget_tpl:ok-user":   10_000_000,
	}}})

	over := customertracebridge.WithEndUserID(context.Background(), "over-user")
	decision, err := checker.Precheck(over, templateBundle(100_000_000, "block"))
	if err != nil {
		t.Fatal(err)
	}
	if decision.Verdict != domain.BudgetBlock {
		t.Fatalf("over-limit user verdict = %v, want block", decision.Verdict)
	}
	if decision.BlockedBy == nil || decision.BlockedBy.Scope != "attributed_user" {
		t.Fatalf("block must name the attributed_user scope, got %+v", decision.BlockedBy)
	}

	warn := customertracebridge.WithEndUserID(context.Background(), "warn-user")
	decision, err = checker.Precheck(warn, templateBundle(100_000_000, "block"))
	if err != nil {
		t.Fatal(err)
	}
	if decision.Verdict != domain.BudgetWarn || len(decision.Warnings) != 1 {
		t.Fatalf("warn-band user = %+v, want one warning", decision)
	}

	ok := customertracebridge.WithEndUserID(context.Background(), "ok-user")
	decision, err = checker.Precheck(ok, templateBundle(100_000_000, "block"))
	if err != nil {
		t.Fatal(err)
	}
	if decision.Verdict != domain.BudgetAllow {
		t.Fatalf("under-threshold user verdict = %v, want allow", decision.Verdict)
	}
}

/** @scenario An unreadable bucket figure allows rather than blocks */
func TestTemplateAllowsWhenBucketUnreadable(t *testing.T) {
	ctx := customertracebridge.WithEndUserID(context.Background(), "any-user")

	// Fetch failure: allow.
	checker := NewChecker(CheckerOptions{Buckets: &fakeBuckets{fail: true}})
	decision, err := checker.Precheck(ctx, templateBundle(100, "block"))
	if err != nil {
		t.Fatal(err)
	}
	if decision.Verdict != domain.BudgetAllow {
		t.Fatalf("fetch-failure verdict = %v, want allow", decision.Verdict)
	}

	// No reader wired: allow (the figure is unknowable, never invented).
	checker = NewChecker(CheckerOptions{})
	decision, err = checker.Precheck(ctx, templateBundle(100, "block"))
	if err != nil {
		t.Fatal(err)
	}
	if decision.Verdict != domain.BudgetAllow {
		t.Fatalf("no-reader verdict = %v, want allow", decision.Verdict)
	}
}
