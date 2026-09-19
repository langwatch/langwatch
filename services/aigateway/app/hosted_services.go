package app

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// HostedServices carries a hosted-service call to the control plane, where the
// one implementation of each service lives.
type HostedServices interface {
	CallHostedService(ctx context.Context, req domain.HostedServiceRequest) (domain.HostedServiceResponse, error)
}

// WithHostedServices wires the control plane channel hosted services run over.
// Without it the hosted routes refuse.
func WithHostedServices(h HostedServices) Option {
	return func(app *App) { app.hosted = h }
}

// CallHostedService serves one hosted-service call for an authenticated caller.
//
// A call that spends is checked against the caller's budgets first, with the
// same check and the same 402 a model call gets, so a used-up commit stops a
// hosted service exactly where it stops everything else. Reading usage and
// changing the cap never spend, and they are what a caller at its cap needs, so
// they skip the check.
func (a *App) CallHostedService(ctx context.Context, bundle *domain.Bundle, op domain.HostedServiceOperation, body []byte) (domain.HostedServiceResponse, error) {
	if a.hosted == nil {
		return domain.HostedServiceResponse{}, herr.New(ctx, domain.ErrNotFound, herr.M{
			"message": "hosted services are not available on this gateway",
		})
	}
	if op == domain.HostedInstantEvalsClassify {
		if err := a.refuseOverBudget(ctx, bundle); err != nil {
			return domain.HostedServiceResponse{}, err
		}
	}
	return a.hosted.CallHostedService(ctx, domain.HostedServiceRequest{
		Operation:      op,
		VirtualKeyID:   bundle.VirtualKeyID,
		OrganizationID: bundle.OrganizationID,
		ProjectID:      bundle.ProjectID,
		Body:           body,
	})
}

// refuseOverBudget answers the 402 of a blocking budget that has run out. A
// precheck that could not run does not refuse, the rule the dispatch pipeline
// follows: the control plane still meters the call, and an outage of the
// budget read must not take every hosted service down with it.
func (a *App) refuseOverBudget(ctx context.Context, bundle *domain.Bundle) error {
	if a.budget == nil {
		return nil
	}
	decision, err := a.budget.Precheck(ctx, bundle)
	if err != nil {
		a.logger.Warn("hosted_service_budget_precheck_error", zap.Error(err))
		return nil
	}
	if decision.Verdict != domain.BudgetBlock {
		return nil
	}
	var blocked domain.BudgetScope
	if decision.BlockedBy != nil {
		blocked = *decision.BlockedBy
	}
	return pipeline.BudgetBreachError(ctx, blocked)
}
