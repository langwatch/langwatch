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

// generateStage builds every span for a stage up front.
//
// Span start times are anchored near now and only ever move FORWARD from a
// base slightly in the past, so nothing can drift past the receiver's
// SPAN_MAX_PAST_MS cutoff and be rejected by design.
func generateStage(plan StagePlan, tenants []Tenant, seed int64, nowMs int64) ([]generatedTrace, error) {
	rng := CreateRng(seed)

	if len(tenants) < plan.Tenants {
		return nil, fmt.Errorf(
			"stage %q needs %d tenants but only %d were provided",
			plan.Stage, plan.Tenants, len(tenants))
	}
	active := tenants[:plan.Tenants]

	largeNearRemaining := plan.SizeMix.NearThresholdSpans
	largeOverRemaining := plan.SizeMix.OverThresholdSpans

	traces := make([]generatedTrace, 0, len(active)*plan.TracesPerTenant)
	for _, tenant := range active {
		for range plan.TracesPerTenant {
			traceID := HexID(16, rng)
			spans := make([]OtlpSpan, 0, plan.SpansPerTrace)
			// Base the trace a few minutes back so all its spans stay in the
			// past but nowhere near the cutoff.
			traceStartMs := nowMs - 5*60_000

			for s := range plan.SpansPerTrace {
				payloadBytes := SmallSpanBytes
				singleOversizedAttribute := false

				switch {
				case largeOverRemaining > 0 && s == 0:
					payloadBytes = OverThresholdBytes
					largeOverRemaining--
					// Every other over-threshold span uses one giant attribute
					// instead of chunks, so the truncation path is exercised
					// alongside the whole-command spool path.
					singleOversizedAttribute = largeOverRemaining%2 == 0
				case largeNearRemaining > 0 && s == 1:
					payloadBytes = NearThresholdBytes
					largeNearRemaining--
				}

				startMs := traceStartMs + int64(s)*10
				if err := AssertSpanTimestampIsAccepted(startMs, nowMs); err != nil {
					return nil, err
				}

				parentSpanID := ""
				if s > 0 && len(spans) > 0 {
					parentSpanID = spans[0].SpanID
				}

				spans = append(spans, BuildSpan(BuildSpanArgs{
					TraceID:                  traceID,
					SpanID:                   HexID(8, rng),
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
					Rng: rng,
				}))
			}

			traces = append(traces, generatedTrace{Tenant: tenant, TraceID: traceID, Spans: spans})
		}
	}

	return traces, nil
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

// postSpans POSTs one OTLP request and counts what the receiver actually took.
//
// A 2xx does NOT mean the spans landed: the receiver reports drops in
// partialSuccess.rejectedSpans while still returning success. Counting a 2xx
// as "all accepted" would make the correctness check report phantom data
// loss, so rejections are subtracted here at the source.
func postSpans(ctx context.Context, client *http.Client, endpoint string, tenant Tenant, spans []OtlpSpan) (sendResult, error) {
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

// sendStage sends a whole stage, at the stage's configured concurrency.
func sendStage(ctx context.Context, client *http.Client, endpoint string, plan StagePlan, traces []generatedTrace, seed int64) (sendOutcome, error) {
	rng := CreateRng(seed + 1)

	// Build the full request list, one entry per (tenant, trace, chunk). The
	// trace id rides along so accepted counts can be attributed back to a trace.
	var requests []stageRequest
	for _, trace := range traces {
		ordered := trace.Spans
		if plan.ScatterAcrossRequests {
			ordered = ScatterAcrossConcurrentArrivals(trace.Spans, rng)
		}
		chunks, err := ChunkSpans(ordered, plan.SpansPerRequest)
		if err != nil {
			return sendOutcome{}, err
		}
		for _, chunk := range chunks {
			requests = append(requests, stageRequest{Tenant: trace.Tenant, TraceID: trace.TraceID, Spans: chunk})
		}
	}

	// Interleave tenants so no tenant's work is contiguous — a fair-dispatch
	// bug is invisible if each tenant is served in its own uninterrupted block.
	interleaved := ScatterAcrossConcurrentArrivals(requests, rng)

	results := make([]sendResult, len(interleaved))
	var (
		mu       sync.Mutex
		firstErr error
	)

	limit := plan.Concurrency
	if limit > len(interleaved) {
		limit = len(interleaved)
	}
	if limit < 1 {
		limit = 1
	}

	next := make(chan int)
	go func() {
		defer close(next)
		for i := range interleaved {
			select {
			case next <- i:
			case <-ctx.Done():
				return
			}
		}
	}()

	var wait sync.WaitGroup
	for range limit {
		wait.Add(1)
		go func() {
			defer wait.Done()
			for index := range next {
				request := interleaved[index]
				result, err := postSpans(ctx, client, endpoint, request.Tenant, request.Spans)
				if err != nil {
					// Only a plan limit is fatal. Anything else (a socket
					// reset, a timeout) is a failed request the outcome
					// records; the pipeline never saw those spans, so they are
					// not counted as expected either.
					if errors.Is(err, errPlanLimit) {
						mu.Lock()
						if firstErr == nil {
							firstErr = err
						}
						mu.Unlock()
					}
					results[index] = sendResult{ok: false}
					continue
				}
				results[index] = result
			}
		}()
	}
	wait.Wait()

	if firstErr != nil {
		return sendOutcome{}, firstErr
	}

	outcome := sendOutcome{AcceptedByTrace: map[string]map[string]int{}}
	for index, result := range results {
		request := interleaved[index]
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

	return outcome, nil
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
func waitForSettle(ctx context.Context, client *chClient, tenants []Tenant, tracesByTenant map[string][]string, expectedByTenant map[string]int, window TimeWindow, timeout time.Duration, log io.Writer) {
	deadline := time.Now().Add(timeout)
	interval := 250 * time.Millisecond

	for time.Now().Before(deadline) {
		settled := true

		for _, tenant := range tenants {
			traceIDs := tracesByTenant[tenant.ProjectID]
			if len(traceIDs) == 0 {
				continue
			}

			var rows []countRow
			err := queryJSON(ctx, client, StoredSpansPerTraceQuery(), map[string]any{
				"tenantId": tenant.ProjectID,
				"traceIds": traceIDs,
				"fromMs":   window.FromMs,
				"toMs":     window.ToMs,
			}, &rows)
			if err != nil {
				// A replica restarting or a merge stalling a query mid-settle
				// is not a benchmark result — keep polling. If ClickHouse is
				// genuinely gone, the verification queries after this loop
				// fail loudly rather than silently reporting every span lost.
				fmt.Fprintf(log, "[benchmark] settle poll failed, retrying: %v\n", err)
				settled = false
				break
			}

			stored := 0
			for _, row := range rows {
				stored += row.spans()
			}
			if stored < expectedByTenant[tenant.ProjectID] {
				settled = false
				break
			}
		}

		if settled {
			// One extra beat so any in-flight fold write lands before we read
			// the summaries; reading a half-written projection looks like a bug.
			sleep(ctx, time.Second)
			return
		}

		sleep(ctx, interval)
		interval = min(time.Duration(float64(interval)*1.5), 3*time.Second)
	}

	fmt.Fprintf(log,
		"[benchmark] settle timeout after %s — verifying anyway. Shortfalls below may be lag "+
			"rather than loss; check the stage duration.\n", timeout)
}

// sleep waits, but gives up early if the run is cancelled.
func sleep(ctx context.Context, duration time.Duration) {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-ctx.Done():
	}
}

// verifyStage runs every correctness check for one stage.
func verifyStage(ctx context.Context, client *chClient, tenants []Tenant, traces []generatedTrace, acceptedByTrace map[string]map[string]int, window TimeWindow, spanEventType string) ([]Violation, error) {
	var violations []Violation

	for _, tenant := range tenants {
		var traceIDs []string
		for _, trace := range traces {
			if trace.Tenant.ProjectID == tenant.ProjectID {
				traceIDs = append(traceIDs, trace.TraceID)
			}
		}
		if len(traceIDs) == 0 {
			continue
		}

		params := map[string]any{
			"tenantId": tenant.ProjectID,
			"traceIds": traceIDs,
			"fromMs":   window.FromMs,
			"toMs":     window.ToMs,
		}

		var storedRows []countRow
		if err := queryJSON(ctx, client, StoredSpansPerTraceQuery(), params, &storedRows); err != nil {
			return nil, fmt.Errorf("stored-span query failed for %s: %w", tenant.ProjectID, err)
		}
		stored := map[string]int{}
		for _, row := range storedRows {
			stored[row.TraceID] = row.spans()
		}

		eventParams := map[string]any{}
		for key, value := range params {
			eventParams[key] = value
		}
		eventParams["eventType"] = spanEventType

		var eventRows []countRow
		if err := queryJSON(ctx, client, EventLogCountsQuery(), eventParams, &eventRows); err != nil {
			return nil, fmt.Errorf("event-log query failed for %s: %w", tenant.ProjectID, err)
		}
		events := map[string]int{}
		for _, row := range eventRows {
			events[row.TraceID] = row.events()
		}

		violations = append(violations, FindLayerDivergence(FindLayerDivergenceOptions{
			TenantId:    tenant.ProjectID,
			Accepted:    acceptedByTrace[tenant.ProjectID],
			EventLog:    events,
			StoredSpans: stored,
		})...)

		var summaryRows []SummaryRow
		if err := queryJSON(ctx, client, SummaryVsStoredQuery(), params, &summaryRows); err != nil {
			return nil, fmt.Errorf("summary query failed for %s: %w", tenant.ProjectID, err)
		}
		violations = append(violations, FindCountMismatches(FindCountMismatchesOptions{
			TenantId: tenant.ProjectID,
			Rows:     summaryRows,
		})...)

		summarised := map[string]struct{}{}
		for _, row := range summaryRows {
			summarised[row.TraceId] = struct{}{}
		}
		violations = append(violations, FindMissingSummaries(FindMissingSummariesOptions{
			TenantId:           tenant.ProjectID,
			ExpectedTraceIds:   traceIDs,
			SummarisedTraceIds: summarised,
		})...)

		var foreignRows []countRow
		foreignParams := map[string]any{
			"tenantId":    tenant.ProjectID,
			"ownTraceIds": traceIDs,
			"fromMs":      window.FromMs,
			"toMs":        window.ToMs,
		}
		if err := queryJSON(ctx, client, ForeignTracesQuery(), foreignParams, &foreignRows); err != nil {
			return nil, fmt.Errorf("cross-tenant query failed for %s: %w", tenant.ProjectID, err)
		}
		foreign := make([]string, 0, len(foreignRows))
		for _, row := range foreignRows {
			foreign = append(foreign, row.TraceID)
		}
		violations = append(violations, FindCrossTenantLeaks(FindCrossTenantLeaksOptions{
			TenantId:        tenant.ProjectID,
			ForeignTraceIds: foreign,
		})...)
	}

	return violations, nil
}

// readSummaryCounts reads current summary SpanCounts, for the resend
// before/after comparison.
func readSummaryCounts(ctx context.Context, client *chClient, tenant Tenant, traceIDs []string, window TimeWindow) (map[string]int, error) {
	var rows []SummaryRow
	err := queryJSON(ctx, client, SummaryVsStoredQuery(), map[string]any{
		"tenantId": tenant.ProjectID,
		"traceIds": traceIDs,
		"fromMs":   window.FromMs,
		"toMs":     window.ToMs,
	}, &rows)
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
func RunBenchmark(ctx context.Context, args RunArgs, stdout, stderr io.Writer) ([]Violation, error) {
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

	var results []StageResult

	for _, stagePlan := range plan.Stages {
		fmt.Fprintf(stdout, "[benchmark] stage %s: %s\n", stagePlan.Stage, stagePlan.Description)

		nowMs := time.Now().UnixMilli()
		traces, err := generateStage(stagePlan, args.Tenants, args.Seed, nowMs)
		if err != nil {
			return nil, err
		}

		stopSampling := startSampling(ctx, args.Namespace)

		startedAtMs := time.Now().UnixMilli()
		outcome, err := sendStage(ctx, sender, args.Endpoint, stagePlan, traces, args.Seed)
		if err != nil {
			stopSampling()
			return nil, err
		}

		// The verification window bounds the PARTITION KEY columns, which for
		// stored_spans and trace_summaries are span start times — not ingest
		// time. Padding generously on both sides keeps partition pruning while
		// never excluding a span we sent.
		window := TimeWindow{
			FromMs: nowMs - 60*60_000,
			ToMs:   time.Now().UnixMilli() + 60*60_000,
		}

		// Expectations come from what the receiver ACCEPTED, not what was sent.
		tracesByTenant := map[string][]string{}
		for _, trace := range traces {
			tracesByTenant[trace.Tenant.ProjectID] = append(tracesByTenant[trace.Tenant.ProjectID], trace.TraceID)
		}
		expectedByTenant := map[string]int{}
		for tenantID, perTrace := range outcome.AcceptedByTrace {
			total := 0
			for _, count := range perTrace {
				total += count
			}
			expectedByTenant[tenantID] = total
		}

		active := args.Tenants[:stagePlan.Tenants]
		waitForSettle(ctx, client, active, tracesByTenant, expectedByTenant, window, args.SettleTimeout, stderr)

		violations, err := verifyStage(ctx, client, active, traces, outcome.AcceptedByTrace, window, args.SpanEventType)
		if err != nil {
			stopSampling()
			return nil, err
		}

		resendViolations, err := runResendProbe(ctx, client, sender, args, stagePlan, traces, window)
		if err != nil {
			stopSampling()
			return nil, err
		}
		violations = append(violations, resendViolations...)

		collected := stopSampling()

		spansSent := 0
		for _, trace := range traces {
			spansSent += len(trace.Spans)
		}

		results = append(results, StageResult{
			Stage:          stagePlan.Stage,
			Description:    stagePlan.Description,
			StartedAtMs:    startedAtMs,
			FinishedAtMs:   time.Now().UnixMilli(),
			SpansSent:      spansSent,
			SpansAccepted:  outcome.Accepted,
			SpansRejected:  outcome.Rejected,
			RequestsSent:   outcome.Requests,
			RequestsFailed: outcome.Failures,
			Violations:     violations,
			Samples:        collected,
		})

		fmt.Fprintf(stdout,
			"[benchmark] stage %s finished: %d accepted, %d rejected, %d violation(s)\n",
			stagePlan.Stage, outcome.Accepted, outcome.Rejected, len(violations))
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

// runResendProbe re-POSTs a fraction of the stage's spans and checks the
// summary counter did not move — the shape a retried batch takes in
// production, and the one that double-counts while every span is still present.
func runResendProbe(ctx context.Context, client *chClient, sender *http.Client, args RunArgs, stagePlan StagePlan, traces []generatedTrace, window TimeWindow) ([]Violation, error) {
	if stagePlan.ResendFraction <= 0 {
		return nil, nil
	}

	rng := CreateRng(args.Seed + 99)
	var violations []Violation

	for _, tenant := range args.Tenants[:stagePlan.Tenants] {
		var tenantTraces []generatedTrace
		var traceIDs []string
		for _, trace := range traces {
			if trace.Tenant.ProjectID == tenant.ProjectID {
				tenantTraces = append(tenantTraces, trace)
				traceIDs = append(traceIDs, trace.TraceID)
			}
		}

		before, err := readSummaryCounts(ctx, client, tenant, traceIDs, window)
		if err != nil {
			return nil, err
		}

		for _, trace := range tenantTraces {
			resend := SelectForResend(trace.Spans, stagePlan.ResendFraction, rng)
			if len(resend) == 0 {
				continue
			}
			chunks, err := ChunkSpans(resend, stagePlan.SpansPerRequest)
			if err != nil {
				return nil, err
			}
			for _, chunk := range chunks {
				if _, err := postSpans(ctx, sender, args.Endpoint, tenant, chunk); err != nil {
					return nil, err
				}
			}
		}

		sleep(ctx, 5*time.Second)

		after, err := readSummaryCounts(ctx, client, tenant, traceIDs, window)
		if err != nil {
			return nil, err
		}
		violations = append(violations, FindResendDrift(FindResendDriftOptions{
			TenantId: tenant.ProjectID,
			Before:   before,
			After:    after,
		})...)
	}

	return violations, nil
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
	payload, err := json.MarshalIndent(map[string]any{"plan": plan, "results": results}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(args.Out, "results.json"), payload, 0o644); err != nil {
		return err
	}

	type stampedSample struct {
		Stage StageName `json:"stage"`
		ResourceSample
	}
	var flattened []stampedSample
	for _, result := range results {
		for _, sample := range result.Samples {
			flattened = append(flattened, stampedSample{Stage: result.Stage, ResourceSample: sample})
		}
	}
	samplesJSON, err := json.MarshalIndent(flattened, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(args.Out, "samples.json"), samplesJSON, 0o644); err != nil {
		return err
	}

	summary := RenderJobSummary(RenderJobSummaryOptions{
		Results:               results,
		Scale:                 plan.Scale,
		ProjectedPayloadBytes: int64(plan.ProjectedPayloadBytes),
		RunnerLabel:           args.RunnerLabel,
	})
	if err := os.WriteFile(filepath.Join(args.Out, "summary.md"), []byte(summary), 0o644); err != nil {
		return err
	}

	if path := os.Getenv("GITHUB_STEP_SUMMARY"); path != "" {
		file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			return err
		}
		defer file.Close()
		if _, err := file.WriteString(summary); err != nil {
			return err
		}
	}

	return nil
}
