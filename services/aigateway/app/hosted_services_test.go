package app

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/adapters/budget"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// recordingHostedServices is the control plane as the app sees it.
type recordingHostedServices struct {
	calls []domain.HostedServiceRequest
}

func (r *recordingHostedServices) CallHostedService(_ context.Context, req domain.HostedServiceRequest) (domain.HostedServiceResponse, error) {
	r.calls = append(r.calls, req)
	return domain.HostedServiceResponse{StatusCode: 200, Body: []byte(`{"ok":true}`)}, nil
}

func connectBundle(spentUSD, limitUSD float64) *domain.Bundle {
	b := testBundle()
	b.VirtualKeyID = "vk_connect"
	b.OrganizationID = "org_acme"
	b.ProjectID = "proj_hidden"
	b.Config.Budget.Scopes = []domain.BudgetScope{{
		ID: "budget_contract", Scope: "organization", ScopeID: "org_acme", Window: "manual",
		LimitMicroUSD: usd(limitUSD), SpentMicroUSD: usd(spentUSD), OnBreach: "block",
	}}
	return b
}

func appWithHostedServices(hosted HostedServices) *App {
	return New(
		WithBudget(budget.NewChecker(budget.CheckerOptions{Logger: zap.NewNop()})),
		WithHostedServices(hosted),
		WithLogger(zap.NewNop()),
	)
}

func TestCallHostedService_WithinBudget_CarriesTheResolvedIdentity(t *testing.T) {
	hosted := &recordingHostedServices{}
	a := appWithHostedServices(hosted)

	answer, err := a.CallHostedService(context.Background(), connectBundle(120, 1000),
		domain.HostedInstantEvalsClassify, []byte(`{"text":"hello","virtual_key_id":"vk_someone_else"}`))

	require.NoError(t, err)
	assert.Equal(t, 200, answer.StatusCode)
	require.Len(t, hosted.calls, 1)
	assert.Equal(t, domain.HostedServiceRequest{
		Operation:      domain.HostedInstantEvalsClassify,
		VirtualKeyID:   "vk_connect",
		OrganizationID: "org_acme",
		ProjectID:      "proj_hidden",
		Body:           []byte(`{"text":"hello","virtual_key_id":"vk_someone_else"}`),
	}, hosted.calls[0], "identity comes from the bundle; the caller's body rides along unread")
}

// @scenario "The budget is a hard stop"
func TestCallHostedService_Classify_BudgetUsedUp_RefusedBeforeAnythingIsJudged(t *testing.T) {
	hosted := &recordingHostedServices{}
	a := appWithHostedServices(hosted)

	_, err := a.CallHostedService(context.Background(), connectBundle(1000, 1000),
		domain.HostedInstantEvalsClassify, []byte(`{"text":"hello"}`))

	require.ErrorIs(t, err, domain.ErrBudgetExceeded)
	assert.Empty(t, hosted.calls, "nothing reaches the classifier, so nothing is judged or recorded")
}

// A caller at its cap still has to be able to see why, and to raise the cap.
func TestCallHostedService_UsageAndBudget_AreServedAtTheCap(t *testing.T) {
	for _, op := range []domain.HostedServiceOperation{domain.HostedUsage, domain.HostedBudget} {
		hosted := &recordingHostedServices{}
		a := appWithHostedServices(hosted)

		_, err := a.CallHostedService(context.Background(), connectBundle(1000, 1000), op, nil)

		require.NoError(t, err, string(op))
		assert.Len(t, hosted.calls, 1, string(op))
	}
}

func TestCallHostedService_NotWired_IsNotFound(t *testing.T) {
	a := New(WithLogger(zap.NewNop()))

	_, err := a.CallHostedService(context.Background(), connectBundle(0, 1000), domain.HostedUsage, nil)

	require.ErrorIs(t, err, domain.ErrNotFound)
}
