package ingestionbench

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// errNothingDraining means one canary span was accepted by the collector but
// never reached ClickHouse.
//
// This is a HARNESS failure, not a pipeline failure, and the difference is the
// whole point of the check. The overwhelmingly likely cause is that no worker
// process is running: the GroupQueue consumer loop only starts for processRole
// "worker" or "all", so a web-role process enqueues into Redis and nothing ever
// folds. Without this check that misconfiguration surfaces as every span in
// every stage being reported lost — which reads as a catastrophic regression in
// the pipeline under test, and sends whoever is on the other end of the red run
// hunting for a bug that does not exist.
var errNothingDraining = errors.New("no span reached ClickHouse")

// preflightTimeout bounds the canary wait.
//
// Generous relative to what a healthy pipeline needs (a single span on an idle
// system lands in seconds) because the cost of being wrong is asymmetric: a
// premature abort wastes a whole run, while waiting an extra minute costs a
// minute of a 60-minute job.
const preflightTimeout = 90 * time.Second

// preflight sends a single span and waits for it to land before the real
// stages begin.
//
// Deliberately runs BEFORE the workload rather than relying on the stage
// verification to notice: a stage that finds nothing has already spent its
// wall-clock budget generating and sending tens of thousands of spans, and its
// violations say "lost spans", which is the wrong diagnosis.
func preflight(ctx context.Context, sender *http.Client, client *chClient, args RunArgs, timeout time.Duration, log io.Writer) error {
	tenant := args.Tenants[0]
	nowMs := time.Now().UnixMilli()
	rng := CreateRng(args.Seed)

	traceID := HexID(16, rng)
	startMs := nowMs - 60_000
	if err := AssertSpanTimestampIsAccepted(startMs, nowMs); err != nil {
		return err
	}

	span := BuildSpan(BuildSpanArgs{
		TraceID:      traceID,
		SpanID:       HexID(8, rng),
		Name:         "preflight-canary",
		StartMs:      startMs,
		DurationMs:   1,
		PayloadBytes: SmallSpanBytes,
		Markers:      map[string]string{"langwatch.benchmark.stage": "preflight"},
		Rng:          rng,
	})

	fmt.Fprintln(log, "[benchmark] preflight: checking one span makes it end to end")

	result, err := postSpans(ctx, sender, args.Endpoint, tenant, []OtlpSpan{span})
	if err != nil {
		return fmt.Errorf("preflight span was not accepted: %w", err)
	}
	if !result.ok || result.accepted != 1 {
		return fmt.Errorf(
			"preflight span was rejected by the collector at %s (accepted %d of 1) — "+
				"the run would measure the receiver refusing load, not the pipeline",
			args.Endpoint, result.accepted)
	}

	// The window matches the stage windows: these bound the PARTITION KEY, so
	// padding generously keeps partition pruning without excluding the span.
	window := TimeWindow{FromMs: nowMs - 60*60_000, ToMs: nowMs + 60*60_000}

	deadline := time.Now().Add(timeout)
	interval := 250 * time.Millisecond
	var lastErr error

	for time.Now().Before(deadline) {
		var rows []countRow
		queryErr := queryJSON(ctx, client, StoredSpansPerTraceQuery(), map[string]any{
			"tenantId": tenant.ProjectID,
			"traceIds": []string{traceID},
			"fromMs":   window.FromMs,
			"toMs":     window.ToMs,
		}, &rows)

		if queryErr != nil {
			// ClickHouse may still be settling right after the cluster comes
			// up; keep trying, but remember why in case we time out.
			lastErr = queryErr
		} else {
			stored := 0
			for _, row := range rows {
				stored += row.spans()
			}
			if stored > 0 {
				fmt.Fprintln(log, "[benchmark] preflight: ok — the pipeline is draining")
				return nil
			}
		}

		sleep(ctx, interval)
		interval = min(time.Duration(float64(interval)*1.5), 3*time.Second)
	}

	if lastErr != nil {
		return fmt.Errorf("preflight could not read ClickHouse: %w", lastErr)
	}

	return fmt.Errorf(
		"%w within %s: the collector accepted a span but it never landed.\n"+
			"This is almost always a harness problem, not a pipeline bug — most often no worker\n"+
			"process is draining the GroupQueue. Only processRole \"worker\" or \"all\" starts the\n"+
			"consumer; a web-role process enqueues and never folds. Under NODE_ENV=production,\n"+
			"WORKERS_IN_PROCESS is ignored, so run `pnpm start:workers` alongside the app (the\n"+
			"workflow sets START_WORKERS=true). Also check that app and worker share REDIS_URL,\n"+
			"REDIS_DB_INDEX and CLICKHOUSE_URL.\n"+
			"Aborting before the stages so this is not reported as data loss.",
		errNothingDraining, timeout)
}
