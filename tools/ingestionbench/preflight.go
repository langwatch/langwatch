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
func preflight(ctx context.Context, check preflightCheck) error {
	args, log := check.Args, check.Log
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

	result, err := postSpans(ctx, check.Sender, spanPost{
		Endpoint: args.Endpoint,
		Tenant:   tenant,
		Spans:    []OtlpSpan{span},
	})
	if err != nil {
		return fmt.Errorf("preflight span was not accepted: %w", err)
	}
	if !result.ok || result.accepted != 1 {
		return fmt.Errorf(
			"preflight span was rejected by the collector at %s (accepted %d of 1) — "+
				"the run would measure the receiver refusing load, not the pipeline",
			args.Endpoint, result.accepted)
	}

	return awaitCanary(ctx, canaryWait{
		Client: check.Client,
		Read: traceWindowRead{
			Tenant:   tenant,
			TraceIDs: []string{traceID},
			// The window matches the stage windows: these bound the PARTITION
			// KEY, so padding generously keeps partition pruning without
			// excluding the span.
			Window: TimeWindow{FromMs: nowMs - 60*60_000, ToMs: nowMs + 60*60_000},
		},
		Timeout: check.Timeout,
		Log:     log,
	})
}

// preflightCheck is the canary's inputs.
type preflightCheck struct {
	Sender  *http.Client
	Client  *chClient
	Args    RunArgs
	Timeout time.Duration
	Log     io.Writer
}

// canaryWait is the poll that waits for the canary span to land.
type canaryWait struct {
	Client  *chClient
	Read    traceWindowRead
	Timeout time.Duration
	Log     io.Writer
}

// awaitCanary polls until the canary span is stored, or the timeout expires.
//
// A read error is remembered rather than returned: ClickHouse may still be
// settling right after the cluster comes up, so the poll keeps trying and only
// reports the last failure if it runs out of time.
func awaitCanary(ctx context.Context, wait canaryWait) error {
	deadline := time.Now().Add(wait.Timeout)
	interval := 250 * time.Millisecond
	var lastErr error

	for time.Now().Before(deadline) {
		stored, err := storedSpanCount(ctx, wait.Client, wait.Read)
		switch {
		case err != nil:
			lastErr = err
		case stored > 0:
			fmt.Fprintln(wait.Log, "[benchmark] preflight: ok — the pipeline is draining")
			return nil
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
		errNothingDraining, wait.Timeout)
}
