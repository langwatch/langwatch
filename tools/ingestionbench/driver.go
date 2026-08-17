package ingestionbench

// The benchmark driver: the run and stage lifecycle that ties generation,
// sending, settling and verification together.
//
// Everything impure lives on this side of the package — HTTP, ClickHouse,
// kubectl, clocks. The rules it calls into are pure and unit-tested.

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"
)

// RunBenchmark executes every stage and writes the artifacts.
//
// It returns the violations it found; a non-empty failure set is reported by
// the caller as a non-zero exit, not as an error — an error here means the
// benchmark could not be run at all, which is a different thing from the
// benchmark finding a bug.
func RunBenchmark(ctx context.Context, args RunArgs, out streams) ([]Violation, error) {
	// 0 takes the default byte budget.
	plan, err := PlanBenchmark(args.Scale, 0)
	if err != nil {
		return nil, err
	}
	if err := AssertWithinBudget(plan); err != nil {
		return nil, err
	}

	client, sender, err := openRun(ctx, args, out)
	if err != nil {
		return nil, err
	}

	var results []StageResult

	// One ledger for the whole run: every trace id given to a tenant, so a
	// later stage does not read an earlier stage's traces as another tenant's.
	ledger := map[string][]string{}

	for _, stagePlan := range plan.Stages {
		fmt.Fprintf(out.Out, "[benchmark] stage %s: %s\n", stagePlan.Stage, stagePlan.Description)

		result, err := runStage(ctx, stageRun{
			Args:   args,
			Plan:   stagePlan,
			Client: client,
			Sender: sender,
			Out:    out,
			Ledger: ledger,
		})
		if err != nil {
			return nil, err
		}
		results = append(results, result)

		fmt.Fprintf(out.Out,
			"[benchmark] stage %s finished: %d accepted, %d rejected, %d violation(s)\n",
			stagePlan.Stage, result.SpansAccepted, result.SpansRejected, len(result.Violations))
	}

	if err := writeArtifacts(args, plan, results); err != nil {
		return nil, err
	}

	var all []Violation
	for _, result := range results {
		all = append(all, result.Violations...)
	}
	return all, nil
}

// openRun builds the two clients the run needs, prepares the output directory,
// and proves the whole path works on ONE span before the stages spend an hour
// on it.
//
// The preflight is the reason this is a step of its own. A misconfigured
// harness that reaches the stages reports "lost spans", which is both the wrong
// diagnosis and the expensive one to chase.
func openRun(ctx context.Context, args RunArgs, out streams) (*chClient, *http.Client, error) {
	client, err := newCHClient(args.ClickHouse)
	if err != nil {
		return nil, nil, err
	}
	if err := os.MkdirAll(args.Out, artifactDirMode); err != nil {
		return nil, nil, err
	}

	// One shared client so connections are reused across the whole run; a
	// fresh transport per request would measure connection setup.
	sender := &http.Client{Timeout: 2 * time.Minute}

	if err := preflight(ctx, preflightCheck{
		Sender:  sender,
		Client:  client,
		Args:    args,
		Timeout: preflightTimeout,
		Log:     out.Err,
	}); err != nil {
		return nil, nil, err
	}

	return client, sender, nil
}

// artifactDirMode matches artifactFileMode: the runner has to be able to walk
// this directory to collect what it holds.
const artifactDirMode = 0o755

// stageRun is everything one stage needs to execute.
type stageRun struct {
	Args   RunArgs
	Plan   StagePlan
	Client *chClient
	Sender *http.Client
	Out    streams
	// Ledger accumulates every trace id the run has generated per tenant, and
	// is added to by each stage before that stage verifies. Shared across the
	// run on purpose: see stageVerify.TenantOwnTraceIds.
	Ledger map[string][]string
}

// runStage generates, sends, settles and verifies one stage.
//
// Resource sampling is started before the first request and stopped on every
// exit path, including the error ones — a sampler left running would keep
// shelling out to kubectl for the rest of the process.
func runStage(ctx context.Context, run stageRun) (StageResult, error) {
	args, stagePlan := run.Args, run.Plan

	nowMs := time.Now().UnixMilli()
	traces, err := generateStage(stageGen{
		Plan:    stagePlan,
		Tenants: args.Tenants,
		Seed:    args.Seed,
		NowMs:   nowMs,
	})
	if err != nil {
		return StageResult{}, err
	}

	stopSampling := startSampling(ctx, args.Namespace)
	sampling := true
	defer func() {
		if sampling {
			stopSampling()
		}
	}()

	startedAtMs := time.Now().UnixMilli()
	outcome, err := sendStage(ctx, run.Sender, stageSend{
		Endpoint: args.Endpoint,
		Plan:     stagePlan,
		Traces:   traces,
		Seed:     args.Seed,
	})
	if err != nil {
		return StageResult{}, err
	}

	// The verification window bounds the PARTITION KEY columns, which for
	// stored_spans and trace_summaries are span start times — not ingest
	// time. Padding generously on both sides keeps partition pruning while
	// never excluding a span we sent.
	window := TimeWindow{
		FromMs: nowMs - 60*60_000,
		ToMs:   time.Now().UnixMilli() + 60*60_000,
	}

	violations, err := settleAndVerify(ctx, run, stageSettle{
		Traces:  traces,
		Outcome: outcome,
		Window:  window,
	})
	if err != nil {
		return StageResult{}, err
	}

	sampling = false

	return stageResultOf(stagePlan, stageTally{
		StartedAtMs: startedAtMs,
		Traces:      traces,
		Outcome:     outcome,
		Violations:  violations,
		Samples:     stopSampling(),
	}), nil
}

// stageTally is everything a finished stage has to report.
type stageTally struct {
	StartedAtMs int64
	Traces      []generatedTrace
	Outcome     sendOutcome
	Violations  []Violation
	Samples     []ResourceSample
}

// stageResultOf assembles the record written to results.json. FinishedAtMs is
// read here rather than passed in, so it is the moment the stage was actually
// done rather than whenever the caller got around to building the result.
func stageResultOf(plan StagePlan, tally stageTally) StageResult {
	spansSent := 0
	for _, trace := range tally.Traces {
		spansSent += len(trace.Spans)
	}

	return StageResult{
		Stage:          plan.Stage,
		Description:    plan.Description,
		StartedAtMs:    tally.StartedAtMs,
		FinishedAtMs:   time.Now().UnixMilli(),
		SpansSent:      spansSent,
		SpansAccepted:  tally.Outcome.Accepted,
		SpansRejected:  tally.Outcome.Rejected,
		RequestsSent:   tally.Outcome.Requests,
		RequestsFailed: tally.Outcome.Failures,
		Violations:     tally.Violations,
		Samples:        tally.Samples,
	}
}

// stageSettle is what one stage produced, ready to be settled and checked.
type stageSettle struct {
	Traces  []generatedTrace
	Outcome sendOutcome
	Window  TimeWindow
}

// settleAndVerify waits for the pipeline to catch up, then runs every
// correctness check including the resend probe.
func settleAndVerify(ctx context.Context, run stageRun, settle stageSettle) ([]Violation, error) {
	args := run.Args
	tracesByTenant, expectedByTenant := stageExpectations(settle.Traces, settle.Outcome)
	active := args.Tenants[:run.Plan.Tenants]

	// Record this stage's ids before verifying, so the cross-tenant check sees
	// everything the run has put under each tenant, including earlier stages.
	for tenantID, traceIDs := range tracesByTenant {
		run.Ledger[tenantID] = append(run.Ledger[tenantID], traceIDs...)
	}

	waitForSettle(ctx, run.Client, settleWatch{
		Tenants:          active,
		TracesByTenant:   tracesByTenant,
		ExpectedByTenant: expectedByTenant,
		Window:           settle.Window,
		Timeout:          args.SettleTimeout,
		Log:              run.Out.Err,
	})

	violations, err := verifyStage(ctx, run.Client, stageVerify{
		Tenants:           active,
		Traces:            settle.Traces,
		AcceptedByTrace:   settle.Outcome.AcceptedByTrace,
		Window:            settle.Window,
		SpanEventType:     args.SpanEventType,
		TenantOwnTraceIds: run.Ledger,
	})
	if err != nil {
		return nil, err
	}

	resendViolations, err := runResendProbe(ctx, run.Client, stageResend{
		Args:   args,
		Plan:   run.Plan,
		Traces: settle.Traces,
		Window: settle.Window,
		Sender: run.Sender,
	})
	if err != nil {
		return nil, err
	}

	return append(violations, resendViolations...), nil
}

// stageExpectations derives what the settle loop should wait for: which traces
// each tenant owns, and how many spans that tenant should end up with.
//
// The counts come from what the receiver ACCEPTED, never from what was sent.
func stageExpectations(traces []generatedTrace, outcome sendOutcome) (tracesByTenant map[string][]string, expectedByTenant map[string]int) {
	tracesByTenant = map[string][]string{}
	for _, trace := range traces {
		tracesByTenant[trace.Tenant.ProjectID] = append(tracesByTenant[trace.Tenant.ProjectID], trace.TraceID)
	}

	expectedByTenant = map[string]int{}
	for tenantID, perTrace := range outcome.AcceptedByTrace {
		total := 0
		for _, count := range perTrace {
			total += count
		}
		expectedByTenant[tenantID] = total
	}

	return tracesByTenant, expectedByTenant
}
