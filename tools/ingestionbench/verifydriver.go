package ingestionbench

// Verification orchestration: which queries run for which tenant, and how their
// answers reach the rules in verify.go.

import (
	"context"
	"fmt"
)

// stageVerify is one stage's verification inputs.
type stageVerify struct {
	Tenants []Tenant
	Traces  []generatedTrace
	// TenantOwnTraceIds is every trace id this run has generated for a tenant,
	// across ALL stages so far, keyed by project id.
	//
	// The cross-tenant check asks ClickHouse for rows under a tenant that are
	// not the tenant's own, so it needs the whole run's ids and not just this
	// stage's. Given only the current stage, stage 2 would see stage 1's traces
	// sitting under the same tenant and report them as leakage from another
	// tenant — a false positive on the check that matters most.
	TenantOwnTraceIds map[string][]string
	// AcceptedByTrace is what the receiver took, keyed tenant -> trace. Every
	// check compares against this rather than against what was sent.
	AcceptedByTrace map[string]map[string]int
	Window          TimeWindow
	// SpanEventType is the event_log type counted for the layer check.
	SpanEventType string
}

// verifyStage runs every correctness check for one stage.
func verifyStage(ctx context.Context, client *chClient, verify stageVerify) ([]Violation, error) {
	var violations []Violation

	for _, tenant := range verify.Tenants {
		_, traceIDs := tracesOwnedBy(verify.Traces, tenant)
		if len(traceIDs) == 0 {
			continue
		}

		found, err := verifyTenant(ctx, client, tenantVerify{
			Stage:    verify,
			Tenant:   tenant,
			TraceIDs: traceIDs,
		})
		if err != nil {
			return nil, err
		}
		violations = append(violations, found...)
	}

	return violations, nil
}

// tenantVerify narrows a stage's verification to a single tenant.
type tenantVerify struct {
	Stage    stageVerify
	Tenant   Tenant
	TraceIDs []string
}

// params are the bound values every per-tenant query shares.
func (v tenantVerify) params() map[string]any {
	return map[string]any{
		"tenantId": v.Tenant.ProjectID,
		"traceIds": v.TraceIDs,
		"fromMs":   v.Stage.Window.FromMs,
		"toMs":     v.Stage.Window.ToMs,
	}
}

// verifyTenant runs all three checks for one tenant.
//
// A query error aborts rather than being recorded as a violation: not knowing
// what ClickHouse holds is not the same as knowing it holds the wrong thing,
// and reporting the first as the second is how a benchmark loses its authority.
func verifyTenant(ctx context.Context, client *chClient, v tenantVerify) ([]Violation, error) {
	var violations []Violation

	layers, err := verifyLayerCounts(ctx, client, v)
	if err != nil {
		return nil, err
	}
	violations = append(violations, layers...)

	summaries, err := verifySummaries(ctx, client, v)
	if err != nil {
		return nil, err
	}
	violations = append(violations, summaries...)

	leaks, err := verifyTenantIsolation(ctx, client, v)
	if err != nil {
		return nil, err
	}
	return append(violations, leaks...), nil
}

// verifyLayerCounts compares what was accepted, what the event log recorded,
// and what was finally stored. A divergence localizes the loss to one hop.
func verifyLayerCounts(ctx context.Context, client *chClient, v tenantVerify) ([]Violation, error) {
	params := v.params()

	var storedRows []countRow
	if err := queryJSON(ctx, client, chQuery{SQL: StoredSpansPerTraceQuery(), Params: params, Into: &storedRows}); err != nil {
		return nil, fmt.Errorf("stored-span query failed for %s: %w", v.Tenant.ProjectID, err)
	}
	stored := map[string]int{}
	for _, row := range storedRows {
		stored[row.TraceID] = row.spans()
	}

	eventParams := v.params()
	eventParams["eventType"] = v.Stage.SpanEventType

	var eventRows []countRow
	if err := queryJSON(ctx, client, chQuery{SQL: EventLogCountsQuery(), Params: eventParams, Into: &eventRows}); err != nil {
		return nil, fmt.Errorf("event-log query failed for %s: %w", v.Tenant.ProjectID, err)
	}
	events := map[string]int{}
	for _, row := range eventRows {
		events[row.TraceID] = row.events()
	}

	return FindLayerDivergence(FindLayerDivergenceOptions{
		TenantId:    v.Tenant.ProjectID,
		Accepted:    v.Stage.AcceptedByTrace[v.Tenant.ProjectID],
		EventLog:    events,
		StoredSpans: stored,
	}), nil
}

// verifySummaries checks the trace-summary projection against stored spans,
// both for a wrong count and for a summary that never appeared at all.
func verifySummaries(ctx context.Context, client *chClient, v tenantVerify) ([]Violation, error) {
	var summaryRows []SummaryRow
	if err := queryJSON(ctx, client, chQuery{SQL: SummaryVsStoredQuery(), Params: v.params(), Into: &summaryRows}); err != nil {
		return nil, fmt.Errorf("summary query failed for %s: %w", v.Tenant.ProjectID, err)
	}

	violations := FindCountMismatches(FindCountMismatchesOptions{
		TenantId: v.Tenant.ProjectID,
		Rows:     summaryRows,
	})

	summarized := map[string]struct{}{}
	for _, row := range summaryRows {
		summarized[row.TraceId] = struct{}{}
	}

	return append(violations, FindMissingSummaries(FindMissingSummariesOptions{
		TenantId:           v.Tenant.ProjectID,
		ExpectedTraceIds:   v.TraceIDs,
		SummarizedTraceIds: summarized,
	})...), nil
}

// verifyTenantIsolation looks for traces visible under this tenant that this
// tenant never sent.
func verifyTenantIsolation(ctx context.Context, client *chClient, v tenantVerify) ([]Violation, error) {
	// Every id this RUN has given the tenant, not just this stage's — anything
	// this run generated under this tenant is the tenant's own by definition.
	own := v.Stage.TenantOwnTraceIds[v.Tenant.ProjectID]
	if len(own) == 0 {
		own = v.TraceIDs
	}

	var foreignRows []countRow
	foreignParams := map[string]any{
		"tenantId":    v.Tenant.ProjectID,
		"ownTraceIds": own,
		"fromMs":      v.Stage.Window.FromMs,
		"toMs":        v.Stage.Window.ToMs,
	}
	if err := queryJSON(ctx, client, chQuery{SQL: ForeignTracesQuery(), Params: foreignParams, Into: &foreignRows}); err != nil {
		return nil, fmt.Errorf("cross-tenant query failed for %s: %w", v.Tenant.ProjectID, err)
	}

	foreign := make([]string, 0, len(foreignRows))
	for _, row := range foreignRows {
		foreign = append(foreign, row.TraceID)
	}

	return FindCrossTenantLeaks(FindCrossTenantLeaksOptions{
		TenantId:        v.Tenant.ProjectID,
		ForeignTraceIds: foreign,
	}), nil
}
