package ingestionbench

// The resend probe: re-sending a fraction of a stage's spans and proving the
// summary counter did not move.
//
// Kept apart from the stage lifecycle because its correctness argument is
// subtle — an unmoved counter only means dedup held if the resend was
// ACCEPTED, so acceptance is proven before the counter is read.

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// stageResend is one stage's resend probe inputs.
type stageResend struct {
	Args   RunArgs
	Plan   StagePlan
	Traces []generatedTrace
	Window TimeWindow
	Sender *http.Client
}

// runResendProbe re-POSTs a fraction of the stage's spans and checks the
// summary counter did not move — the shape a retried batch takes in
// production, and the one that double-counts while every span is still present.
func runResendProbe(ctx context.Context, client *chClient, resend stageResend) ([]Violation, error) {
	args, stagePlan := resend.Args, resend.Plan
	if stagePlan.ResendFraction <= 0 {
		return nil, nil
	}

	rng := CreateRng(args.Seed + 99)
	var violations []Violation

	for _, tenant := range args.Tenants[:stagePlan.Tenants] {
		found, err := probeTenantResend(ctx, client, resendProbe{
			Args:   args,
			Plan:   stagePlan,
			Tenant: tenant,
			Traces: resend.Traces,
			Window: resend.Window,
			Rng:    rng,
			Sender: resend.Sender,
		})
		if err != nil {
			return nil, err
		}
		violations = append(violations, found...)
	}

	return violations, nil
}

// resendProbe is one tenant's resend probe.
type resendProbe struct {
	Args   RunArgs
	Plan   StagePlan
	Tenant Tenant
	Traces []generatedTrace
	Window TimeWindow
	Rng    Rng
	Sender *http.Client
}

// probeTenantResend resends a fraction of one tenant's spans and checks the
// summary counter did not move.
//
// The counter staying still only means dedup worked if the resend was actually
// ACCEPTED. A receiver that refused the whole resend leaves the counter exactly
// as still as a correctly deduped one, so acceptance is proven first and a
// short resend aborts the probe rather than passing it.
func probeTenantResend(ctx context.Context, client *chClient, probe resendProbe) ([]Violation, error) {
	tenantTraces, traceIDs := tracesOwnedBy(probe.Traces, probe.Tenant)
	if len(traceIDs) == 0 {
		return nil, nil
	}

	read := traceWindowRead{Tenant: probe.Tenant, TraceIDs: traceIDs, Window: probe.Window}
	before, err := readSummaryCounts(ctx, client, read)
	if err != nil {
		return nil, err
	}

	sent, accepted, err := resendSpans(ctx, probe, tenantTraces)
	if err != nil {
		return nil, err
	}
	if sent == 0 {
		return nil, nil
	}
	if accepted < sent {
		// Not a correctness violation: the pipeline was never given the
		// chance to double-count. Reported as a failed run so the result is
		// never mistaken for evidence that dedup holds.
		return nil, fmt.Errorf(
			"resend probe inconclusive for %s: the receiver accepted %d of %d resent spans, "+
				"so an unmoved summary counter would prove nothing about dedup",
			probe.Tenant.ProjectID, accepted, sent)
	}

	sleep(ctx, 5*time.Second)

	after, err := readSummaryCounts(ctx, client, read)
	if err != nil {
		return nil, err
	}
	return FindResendDrift(FindResendDriftOptions{
		TenantId: probe.Tenant.ProjectID,
		Before:   before,
		After:    after,
	}), nil
}

// resendSpans re-POSTs the selected fraction of each trace, and reports how
// many spans were offered and how many the receiver took.
func resendSpans(ctx context.Context, probe resendProbe, tenantTraces []generatedTrace) (sent, accepted int, err error) {
	for _, trace := range tenantTraces {
		resend := SelectForResend(trace.Spans, probe.Plan.ResendFraction, probe.Rng)
		if len(resend) == 0 {
			continue
		}
		chunks, chunkErr := ChunkSpans(resend, probe.Plan.SpansPerRequest)
		if chunkErr != nil {
			return 0, 0, chunkErr
		}
		for _, chunk := range chunks {
			result, postErr := postSpans(ctx, probe.Sender, spanPost{
				Endpoint: probe.Args.Endpoint,
				Tenant:   probe.Tenant,
				Spans:    chunk,
			})
			if postErr != nil {
				return 0, 0, postErr
			}
			sent += len(chunk)
			accepted += result.accepted
		}
	}
	return sent, accepted, nil
}

// tracesOwnedBy splits out one tenant's traces and their ids.
func tracesOwnedBy(traces []generatedTrace, tenant Tenant) (owned []generatedTrace, traceIDs []string) {
	for _, trace := range traces {
		if trace.Tenant.ProjectID == tenant.ProjectID {
			owned = append(owned, trace)
			traceIDs = append(traceIDs, trace.TraceID)
		}
	}
	return owned, traceIDs
}
