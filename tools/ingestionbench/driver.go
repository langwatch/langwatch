package ingestionbench

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// generatedTrace is one trace's worth of spans, bound to the tenant that will
// send them.
type generatedTrace struct {
	Tenant  Tenant
	TraceID string
	Spans   []OtlpSpan
}

// errPlanLimit marks the one send failure that must abort the run.
//
// A plan-limit rejection silently caps the load. Treated as an ordinary
// failed request it would look like the pipeline dropping data, so the run
// would report a correctness violation that is really a billing limit.
var errPlanLimit = errors.New("project hit its plan limit (ERR_PLAN_LIMIT)")

// stageGen is one stage's generation inputs.
type stageGen struct {
	Plan    StagePlan
	Tenants []Tenant
	// Seed makes a run replayable: the same seed regenerates the same spans.
	Seed int64
	// NowMs anchors every span time, so a whole stage shares one clock reading.
	NowMs int64
}

// generateStage builds every span for a stage up front.
//
// Span start times are anchored near now and only ever move FORWARD from a
// base slightly in the past, so nothing can drift past the receiver's
// SPAN_MAX_PAST_MS cutoff and be rejected by design.
func generateStage(gen stageGen) ([]generatedTrace, error) {
	plan, tenants := gen.Plan, gen.Tenants
	rng := CreateRng(gen.Seed)

	if len(tenants) < plan.Tenants {
		return nil, fmt.Errorf(
			"stage %q needs %d tenants but only %d were provided",
			plan.Stage, plan.Tenants, len(tenants))
	}
	active := tenants[:plan.Tenants]

	// One budget for the whole stage, consumed as traces are built, so the
	// stage's size mix is spent across its traces rather than repeated in each.
	budget := spanBudget{
		nearThreshold: plan.SizeMix.NearThresholdSpans,
		overThreshold: plan.SizeMix.OverThresholdSpans,
	}

	traces := make([]generatedTrace, 0, len(active)*plan.TracesPerTenant)
	for _, tenant := range active {
		for range plan.TracesPerTenant {
			traceID := HexID(16, rng)
			spans, err := buildTraceSpans(traceBuild{
				Plan:    plan,
				TraceID: traceID,
				// Base the trace a few minutes back so all its spans stay in
				// the past but nowhere near the cutoff.
				TraceStartMs: gen.NowMs - 5*60_000,
				NowMs:        gen.NowMs,
				Budget:       &budget,
				Rng:          rng,
			})
			if err != nil {
				return nil, err
			}

			traces = append(traces, generatedTrace{Tenant: tenant, TraceID: traceID, Spans: spans})
		}
	}

	return traces, nil
}

// spanBudget is a stage's remaining allowance of oversized spans. It is
// consumed as traces are built, which is why it is passed by pointer.
type spanBudget struct {
	nearThreshold int
	overThreshold int
}

// payloadFor decides one span's payload size and spends the budget.
//
// Only span 0 can be over-threshold and only span 1 near-threshold, so no trace
// carries two large spans and each path is reached at most once per trace.
func (b *spanBudget) payloadFor(index int) (payloadBytes int, singleOversizedAttribute bool) {
	switch {
	case b.overThreshold > 0 && index == 0:
		b.overThreshold--
		// Every other over-threshold span uses one giant attribute instead of
		// chunks, so the truncation path is exercised alongside the
		// whole-command spool path.
		return OverThresholdBytes, b.overThreshold%2 == 0
	case b.nearThreshold > 0 && index == 1:
		b.nearThreshold--
		return NearThresholdBytes, false
	default:
		return SmallSpanBytes, false
	}
}

// traceBuild is everything one trace's spans are built from.
type traceBuild struct {
	Plan         StagePlan
	TraceID      string
	TraceStartMs int64
	NowMs        int64
	// Budget is shared across the stage and mutated here.
	Budget *spanBudget
	Rng    Rng
}

// buildTraceSpans builds one trace's spans, in order.
func buildTraceSpans(build traceBuild) ([]OtlpSpan, error) {
	plan := build.Plan
	spans := make([]OtlpSpan, 0, plan.SpansPerTrace)

	for s := range plan.SpansPerTrace {
		payloadBytes, singleOversizedAttribute := build.Budget.payloadFor(s)

		startMs := build.TraceStartMs + int64(s)*10
		if err := AssertSpanTimestampIsAccepted(startMs, build.NowMs); err != nil {
			return nil, err
		}

		// Every span after the first hangs off the first, so a trace is one
		// root with siblings rather than a chain.
		parentSpanID := ""
		if s > 0 && len(spans) > 0 {
			parentSpanID = spans[0].SpanID
		}

		spans = append(spans, BuildSpan(BuildSpanArgs{
			TraceID:                  build.TraceID,
			SpanID:                   HexID(8, build.Rng),
			ParentSpanID:             parentSpanID,
			Name:                     fmt.Sprintf("%s-span-%d", plan.Stage, s),
			StartMs:                  startMs,
			DurationMs:               5,
			PayloadBytes:             payloadBytes,
			SingleOversizedAttribute: singleOversizedAttribute,
			Markers: map[string]string{
				"langwatch.benchmark.stage": string(plan.Stage),
				"langwatch.benchmark.seq":   strconv.Itoa(s),
			},
			Rng: build.Rng,
		}))
	}

	return spans, nil
}

// sendOutcome is what a stage's send phase actually achieved.
type sendOutcome struct {
	Accepted int
	Rejected int
	Requests int
	Failures int
	// AcceptedByTrace holds spans the receiver ACCEPTED, keyed tenant -> trace.
	//
	// Correctness compares against this, never against what was sent. A
	// request that failed at the socket, or a 2xx that rejected spans, means
	// those spans were never offered to the pipeline — counting them as
	// expected would report data loss the pipeline never caused, and a
	// benchmark that cries wolf gets switched off.
	AcceptedByTrace map[string]map[string]int
}

// sendResult is one request's outcome.
type sendResult struct {
	accepted int
	rejected int
	ok       bool
}

// spanPost is one OTLP request: where it goes, whose it is, and what is in it.
type spanPost struct {
	// Endpoint is the platform base URL; the OTLP path is appended.
	Endpoint string
	// Tenant owns the spans and supplies the API key.
	Tenant Tenant
	// Spans travel as a single resourceSpans batch.
	Spans []OtlpSpan
}

// postSpans POSTs one OTLP request and counts what the receiver actually took.
//
// A 2xx does NOT mean the spans landed: the receiver reports drops in
// partialSuccess.rejectedSpans while still returning success. Counting a 2xx
// as "all accepted" would make the correctness check report phantom data
// loss, so rejections are subtracted here at the source.
func postSpans(ctx context.Context, client *http.Client, post spanPost) (sendResult, error) {
	endpoint, tenant, spans := post.Endpoint, post.Tenant, post.Spans

	body, err := json.Marshal(BuildResourceSpans(spans))
	if err != nil {
		return sendResult{}, err
	}

	target := strings.TrimSuffix(endpoint, "/") + "/api/otel/v1/traces"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target, strings.NewReader(string(body)))
	if err != nil {
		return sendResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Auth-Token", tenant.APIKey)

	response, err := client.Do(request)
	if err != nil {
		return sendResult{}, err
	}
	defer response.Body.Close()

	payload, err := io.ReadAll(response.Body)
	if err != nil {
		return sendResult{}, err
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if strings.Contains(string(payload), "ERR_PLAN_LIMIT") {
			return sendResult{}, fmt.Errorf(
				"%w: project %s needs enough headroom for the whole workload, "+
					"or the run measures the rate limiter rather than the pipeline",
				errPlanLimit, tenant.ProjectID)
		}
		return sendResult{accepted: 0, rejected: len(spans), ok: false}, nil
	}

	var decoded struct {
		PartialSuccess struct {
			RejectedSpans json.Number `json:"rejectedSpans"`
		} `json:"partialSuccess"`
	}
	// A body that will not decode is not a rejection signal — the receiver
	// returned success, so treat the spans as accepted rather than inventing
	// loss.
	_ = json.Unmarshal(payload, &decoded)
	rejected, _ := decoded.PartialSuccess.RejectedSpans.Int64()

	return sendResult{accepted: len(spans) - int(rejected), rejected: int(rejected), ok: true}, nil
}

// stageRequest is one (tenant, trace, chunk) POST waiting to be sent.
type stageRequest struct {
	Tenant  Tenant
	TraceID string
	Spans   []OtlpSpan
}

// stageSend is one stage's send inputs.
type stageSend struct {
	Endpoint string
	Plan     StagePlan
	Traces   []generatedTrace
	// Seed is offset from the generation seed so the send order is replayable
	// without repeating the span-generation sequence.
	Seed int64
}

// sendStage sends a whole stage, at the stage's configured concurrency.
func sendStage(ctx context.Context, client *http.Client, send stageSend) (sendOutcome, error) {
	plan := send.Plan
	rng := CreateRng(send.Seed + 1)

	requests, err := buildStageRequests(plan, send.Traces, rng)
	if err != nil {
		return sendOutcome{}, err
	}

	// Interleave tenants so no tenant's work is contiguous — a fair-dispatch
	// bug is invisible if each tenant is served in its own uninterrupted block.
	interleaved := ScatterAcrossConcurrentArrivals(requests, rng)

	results, err := runStageRequests(ctx, client, stageDispatch{
		Endpoint:    send.Endpoint,
		Requests:    interleaved,
		Concurrency: plan.Concurrency,
	})
	if err != nil {
		return sendOutcome{}, err
	}

	return tallyStage(interleaved, results), nil
}

// buildStageRequests expands a stage's traces into the POSTs that carry them,
// one entry per (tenant, trace, chunk).
//
// The trace id rides along on each request so accepted counts can be attributed
// back to a trace, which is what the correctness check compares against.
func buildStageRequests(plan StagePlan, traces []generatedTrace, rng Rng) ([]stageRequest, error) {
	var requests []stageRequest
	for _, trace := range traces {
		ordered := trace.Spans
		if plan.ScatterAcrossRequests {
			ordered = ScatterAcrossConcurrentArrivals(trace.Spans, rng)
		}
		chunks, err := ChunkSpans(ordered, plan.SpansPerRequest)
		if err != nil {
			return nil, err
		}
		for _, chunk := range chunks {
			requests = append(requests, stageRequest{Tenant: trace.Tenant, TraceID: trace.TraceID, Spans: chunk})
		}
	}
	return requests, nil
}

// stageDispatch is one stage's send phase: where to, what, and how many at once.
type stageDispatch struct {
	Endpoint    string
	Requests    []stageRequest
	Concurrency int
}

// runStageRequests sends every request, at most Concurrency at a time, and
// returns one result per request in the order they were given.
//
// Only a plan limit aborts the stage. Anything else — a socket reset, a
// timeout — is a failed request recorded in its result: the pipeline never saw
// those spans, so they are not counted as expected either, and treating an
// infrastructure blip as data loss is how a benchmark starts crying wolf.
func runStageRequests(ctx context.Context, client *http.Client, dispatch stageDispatch) ([]sendResult, error) {
	requests := dispatch.Requests
	results := make([]sendResult, len(requests))

	var (
		mu       sync.Mutex
		firstErr error
	)
	sender := stageSender{
		client:   client,
		endpoint: dispatch.Endpoint,
		fatal: func(err error) {
			mu.Lock()
			defer mu.Unlock()
			if firstErr == nil {
				firstErr = err
			}
		},
	}

	next := feedIndices(ctx, len(requests))

	var wait sync.WaitGroup
	for range max(1, min(dispatch.Concurrency, len(requests))) {
		wait.Add(1)
		go func() {
			defer wait.Done()
			for index := range next {
				results[index] = sender.send(ctx, requests[index])
			}
		}()
	}
	wait.Wait()

	if firstErr != nil {
		return nil, firstErr
	}
	return results, nil
}

// feedIndices hands request indices to the workers one at a time, and stops
// early if the run is canceled.
//
// A channel rather than a slice split: the requests are deliberately unequal in
// size, so handing each worker a fixed share would leave some idle while one
// worked through the oversized payloads.
func feedIndices(ctx context.Context, count int) <-chan int {
	next := make(chan int)
	go func() {
		defer close(next)
		for i := range count {
			select {
			case next <- i:
			case <-ctx.Done():
				return
			}
		}
	}()
	return next
}

// stageSender sends one request and classifies its failure.
type stageSender struct {
	client   *http.Client
	endpoint string
	// fatal reports an error that must abort the whole stage. Called at most
	// once per stage in effect, since the caller keeps only the first.
	fatal func(error)
}

// send posts one request. A failure that is not a plan limit is recorded in the
// result rather than raised: the spans were never offered to the pipeline, so
// they are not counted as expected either.
func (s stageSender) send(ctx context.Context, request stageRequest) sendResult {
	result, err := postSpans(ctx, s.client, spanPost{
		Endpoint: s.endpoint,
		Tenant:   request.Tenant,
		Spans:    request.Spans,
	})
	if err != nil {
		if errors.Is(err, errPlanLimit) {
			s.fatal(err)
		}
		return sendResult{ok: false}
	}
	return result
}

// tallyStage folds per-request results into the stage's outcome, attributing
// accepted spans back to the trace that carried them.
func tallyStage(requests []stageRequest, results []sendResult) sendOutcome {
	outcome := sendOutcome{AcceptedByTrace: map[string]map[string]int{}}
	for index, result := range results {
		request := requests[index]
		outcome.Requests++
		outcome.Accepted += result.accepted
		outcome.Rejected += result.rejected
		if !result.ok {
			outcome.Failures++
		}
		tenantID := request.Tenant.ProjectID
		if outcome.AcceptedByTrace[tenantID] == nil {
			outcome.AcceptedByTrace[tenantID] = map[string]int{}
		}
		outcome.AcceptedByTrace[tenantID][request.TraceID] += result.accepted
	}
	return outcome
}

// countRow is the shape every per-trace count query returns. ClickHouse sends
// 64-bit integers as JSON strings, so the counts decode as json.Number.
type countRow struct {
	TraceID    string      `json:"TraceId"`
	SpanCount  json.Number `json:"SpanCount"`
	EventCount json.Number `json:"EventCount"`
}

func (r countRow) spans() int  { return numberToInt(r.SpanCount) }
func (r countRow) events() int { return numberToInt(r.EventCount) }

func numberToInt(value json.Number) int {
	parsed, err := value.Int64()
	if err != nil {
		return 0
	}
	return int(parsed)
}

// waitForSettle polls until the pipeline has caught up, or the timeout expires.
//
// Polls rather than sleeping a flat interval: a fixed sleep is either wasteful
// or (much worse) too short under load, which turns a slow pipeline into a
// false "lost spans" failure.
func waitForSettle(ctx context.Context, client *chClient, watch settleWatch) {
	deadline := time.Now().Add(watch.Timeout)
	interval := 250 * time.Millisecond

	for time.Now().Before(deadline) {
		if storedCaughtUp(ctx, client, watch) {
			// One extra beat so any in-flight fold write lands before we read
			// the summaries; reading a half-written projection looks like a bug.
			sleep(ctx, time.Second)
			return
		}

		sleep(ctx, interval)
		interval = min(time.Duration(float64(interval)*1.5), 3*time.Second)
	}

	fmt.Fprintf(watch.Log,
		"[benchmark] settle timeout after %s — verifying anyway. Shortfalls below may be lag "+
			"rather than loss; check the stage duration.\n", watch.Timeout)
}

// settleWatch is what one settle loop is waiting on.
type settleWatch struct {
	Tenants        []Tenant
	TracesByTenant map[string][]string
	// ExpectedByTenant is what the send phase saw ACCEPTED, never what it sent.
	ExpectedByTenant map[string]int
	Window           TimeWindow
	Timeout          time.Duration
	Log              io.Writer
}

// storedCaughtUp reports whether every tenant's stored spans have reached what
// the receiver accepted.
//
// A query failure counts as "not yet" rather than as an answer: a replica
// restarting or a merge stalling mid-settle is not a benchmark result. If
// ClickHouse is genuinely gone, the verification queries after the loop fail
// loudly rather than silently reporting every span lost.
func storedCaughtUp(ctx context.Context, client *chClient, watch settleWatch) bool {
	for _, tenant := range watch.Tenants {
		traceIDs := watch.TracesByTenant[tenant.ProjectID]
		if len(traceIDs) == 0 {
			continue
		}

		stored, err := storedSpanCount(ctx, client, traceWindowRead{
			Tenant:   tenant,
			TraceIDs: traceIDs,
			Window:   watch.Window,
		})
		if err != nil {
			fmt.Fprintf(watch.Log, "[benchmark] settle poll failed, retrying: %v\n", err)
			return false
		}
		if stored < watch.ExpectedByTenant[tenant.ProjectID] {
			return false
		}
	}
	return true
}

// storedSpanCount totals the spans stored for one tenant's traces in a window.
func storedSpanCount(ctx context.Context, client *chClient, read traceWindowRead) (int, error) {
	var rows []countRow
	err := queryJSON(ctx, client, chQuery{
		SQL: StoredSpansPerTraceQuery(),
		Params: map[string]any{
			"tenantId": read.Tenant.ProjectID,
			"traceIds": read.TraceIDs,
			"fromMs":   read.Window.FromMs,
			"toMs":     read.Window.ToMs,
		},
		Into: &rows,
	})
	if err != nil {
		return 0, err
	}

	stored := 0
	for _, row := range rows {
		stored += row.spans()
	}
	return stored, nil
}

// sleep waits, but gives up early if the run is canceled.
func sleep(ctx context.Context, duration time.Duration) {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-ctx.Done():
	}
}

// stageVerify is one stage's verification inputs.
type stageVerify struct {
	Tenants []Tenant
	Traces  []generatedTrace
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
	var foreignRows []countRow
	foreignParams := map[string]any{
		"tenantId":    v.Tenant.ProjectID,
		"ownTraceIds": v.TraceIDs,
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

// traceWindowRead names one tenant's traces over one window.
type traceWindowRead struct {
	Tenant   Tenant
	TraceIDs []string
	Window   TimeWindow
}

// readSummaryCounts reads current summary SpanCounts, for the resend
// before/after comparison.
func readSummaryCounts(ctx context.Context, client *chClient, read traceWindowRead) (map[string]int, error) {
	var rows []SummaryRow
	err := queryJSON(ctx, client, chQuery{
		SQL: SummaryVsStoredQuery(),
		Params: map[string]any{
			"tenantId": read.Tenant.ProjectID,
			"traceIds": read.TraceIDs,
			"fromMs":   read.Window.FromMs,
			"toMs":     read.Window.ToMs,
		},
		Into: &rows,
	})
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, row := range rows {
		counts[row.TraceId] = int(row.SpanCount)
	}
	return counts, nil
}

// sampleResources reads `kubectl top pod` once.
//
// Best-effort: metrics-server can be briefly unavailable, and a missing sample
// must never fail the run — resource data is informational.
func sampleResources(ctx context.Context, namespace string) []ResourceSample {
	command := exec.CommandContext(ctx, "kubectl", "top", "pod", "-n", namespace, "--no-headers")
	output, err := command.Output()
	if err != nil {
		return nil
	}

	atMs := time.Now().UnixMilli()
	var samples []ResourceSample
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		samples = append(samples, ResourceSample{
			AtMs:          atMs,
			Target:        fields[0],
			CPUMillicores: leadingInt(fields[1]),
			MemoryBytes:   int64(leadingInt(fields[2])) * 1024 * 1024,
		})
	}
	return samples
}

// leadingInt reads the numeric prefix of a `kubectl top` cell ("142m", "83Mi").
func leadingInt(value string) int {
	end := 0
	for end < len(value) && value[end] >= '0' && value[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0
	}
	parsed, err := strconv.Atoi(value[:end])
	if err != nil {
		return 0
	}
	return parsed
}

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

	client, err := newCHClient(args.ClickHouse)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(args.Out, 0o755); err != nil {
		return nil, err
	}

	// One shared client so connections are reused across the whole run; a
	// fresh transport per request would measure connection setup.
	sender := &http.Client{Timeout: 2 * time.Minute}

	// Prove the whole path works on ONE span before spending the run on it.
	// A misconfigured harness that reaches the stages reports "lost spans",
	// which is the wrong diagnosis and the expensive one to chase.
	if err := preflight(ctx, preflightCheck{
		Sender:  sender,
		Client:  client,
		Args:    args,
		Timeout: preflightTimeout,
		Log:     out.Err,
	}); err != nil {
		return nil, err
	}

	var results []StageResult

	for _, stagePlan := range plan.Stages {
		fmt.Fprintf(out.Out, "[benchmark] stage %s: %s\n", stagePlan.Stage, stagePlan.Description)

		result, err := runStage(ctx, stageRun{
			Args:   args,
			Plan:   stagePlan,
			Client: client,
			Sender: sender,
			Out:    out,
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

// stageRun is everything one stage needs to execute.
type stageRun struct {
	Args   RunArgs
	Plan   StagePlan
	Client *chClient
	Sender *http.Client
	Out    streams
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

	waitForSettle(ctx, run.Client, settleWatch{
		Tenants:          active,
		TracesByTenant:   tracesByTenant,
		ExpectedByTenant: expectedByTenant,
		Window:           settle.Window,
		Timeout:          args.SettleTimeout,
		Log:              run.Out.Err,
	})

	violations, err := verifyStage(ctx, run.Client, stageVerify{
		Tenants:         active,
		Traces:          settle.Traces,
		AcceptedByTrace: settle.Outcome.AcceptedByTrace,
		Window:          settle.Window,
		SpanEventType:   args.SpanEventType,
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

// startSampling polls `kubectl top` every 5s until the returned stop function
// is called, which hands back everything collected.
func startSampling(ctx context.Context, namespace string) func() []ResourceSample {
	var (
		mu      sync.Mutex
		samples []ResourceSample
	)
	done := make(chan struct{})
	finished := make(chan struct{})

	go func() {
		defer close(finished)
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				collected := sampleResources(ctx, namespace)
				mu.Lock()
				samples = append(samples, collected...)
				mu.Unlock()
			case <-done:
				return
			case <-ctx.Done():
				return
			}
		}
	}()

	var once sync.Once
	return func() []ResourceSample {
		once.Do(func() {
			close(done)
			<-finished
		})
		mu.Lock()
		defer mu.Unlock()
		return append([]ResourceSample(nil), samples...)
	}
}

// writeArtifacts writes results.json, samples.json, and summary.md, and
// appends the summary to the GitHub job summary when running in Actions.
//
// results.json is the baseline the NEXT run compares against, so it is written
// even when the run failed — a failed run's numbers are still the most recent
// reading at this scale on this runner.
func writeArtifacts(args RunArgs, plan BenchmarkPlan, results []StageResult) error {
	if err := writeJSONFile(filepath.Join(args.Out, "results.json"), map[string]any{
		"plan":    plan,
		"results": results,
	}); err != nil {
		return err
	}

	if err := writeJSONFile(filepath.Join(args.Out, "samples.json"), stampedSamples(results)); err != nil {
		return err
	}

	summary := RenderJobSummary(RenderJobSummaryOptions{
		Results:               results,
		Scale:                 plan.Scale,
		ProjectedPayloadBytes: int64(plan.ProjectedPayloadBytes),
		RunnerLabel:           args.RunnerLabel,
	})
	if err := os.WriteFile(filepath.Join(args.Out, "summary.md"), []byte(summary), artifactFileMode); err != nil {
		return err
	}

	return appendJobSummary(summary)
}

// artifactFileMode is world-readable on purpose: these are CI artifacts, meant
// to be collected by the runner and attached to the job.
const artifactFileMode = 0o644

// writeJSONFile writes value as indented JSON.
func writeJSONFile(path string, value any) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, payload, artifactFileMode)
}

// stampedSample is a resource sample tagged with the stage it was taken during,
// since samples.json is flat and a sample means little without its stage.
type stampedSample struct {
	Stage StageName `json:"stage"`
	ResourceSample
}

// stampedSamples flattens every stage's samples into one stamped list.
func stampedSamples(results []StageResult) []stampedSample {
	var flattened []stampedSample
	for _, result := range results {
		for _, sample := range result.Samples {
			flattened = append(flattened, stampedSample{Stage: result.Stage, ResourceSample: sample})
		}
	}
	return flattened
}

// appendJobSummary appends the summary to the GitHub job summary, when running
// somewhere that has one.
//
// The close error is returned rather than deferred away. This handle is open
// for writing, so a failure to flush would otherwise be reported as a
// successful run that quietly published a truncated summary.
func appendJobSummary(summary string) (err error) {
	path := os.Getenv("GITHUB_STEP_SUMMARY")
	if path == "" {
		return nil
	}

	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, artifactFileMode)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil && err == nil {
			err = closeErr
		}
	}()

	_, err = file.WriteString(summary)
	return err
}
