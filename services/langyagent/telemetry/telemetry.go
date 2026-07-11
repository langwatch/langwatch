// Package telemetry holds the langyagent manager's OpenTelemetry spans and
// metric instruments. It is deliberately a small infrastructure helper shared
// by both the app orchestrator (per-turn latency, at-capacity) and the
// workerpool driven adapter (spawn / kill / readiness) so operational
// telemetry has ONE definition instead of being scattered.
//
// The manager previously emitted zero OTel. This package is the load-bearing
// seam ADR-047 calls out: PR4's egress monitoring hangs off the same tracer
// and meter. The global TracerProvider is installed by pkg/otelsetup, so spans
// export today. The metric instruments are created against the global Meter —
// a no-op MeterProvider until one is wired — so every call site exists and
// lights up the moment a MeterProvider is installed, with no restructuring.
package telemetry

import (
	"context"
	"log/slog"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/metric/noop"
	"go.opentelemetry.io/otel/trace"
)

const (
	// instrumentationName is the tracer + meter scope. Matches the
	// "langwatch-<service>" convention used by the other Go services.
	instrumentationName = "langwatch-langyagent"
)

// Telemetry carries the manager's tracer and metric instruments. Construct
// once (see New) and inject into the app and the worker pool.
type Telemetry struct {
	tracer trace.Tracer

	workerSpawns     metric.Int64Counter
	workerKills      metric.Int64Counter
	workerExits      metric.Int64Counter
	workersActive    metric.Int64UpDownCounter
	atCapacity       metric.Int64Counter
	turnDuration     metric.Float64Histogram
	spawnDuration    metric.Float64Histogram
	readinessSeconds metric.Float64Histogram
}

// New builds the tracer and instruments from the global OTel providers. It
// never fails: an instrument that can't be created falls back to a no-op so
// telemetry is always safe to call.
func New() *Telemetry {
	meter := otel.Meter(instrumentationName)
	t := &Telemetry{tracer: otel.Tracer(instrumentationName)}

	var err error
	fallback := noop.NewMeterProvider().Meter(instrumentationName)

	if t.workerSpawns, err = meter.Int64Counter(
		"langy.worker.spawns",
		metric.WithDescription("Count of worker spawn attempts, tagged by outcome."),
	); err != nil {
		slog.Warn("langy telemetry: worker.spawns instrument", "err", err)
		t.workerSpawns, _ = fallback.Int64Counter("langy.worker.spawns")
	}
	if t.workerKills, err = meter.Int64Counter(
		"langy.worker.kills",
		metric.WithDescription("Count of worker kills, tagged by reason."),
	); err != nil {
		slog.Warn("langy telemetry: worker.kills instrument", "err", err)
		t.workerKills, _ = fallback.Int64Counter("langy.worker.kills")
	}
	if t.workerExits, err = meter.Int64Counter(
		"langy.worker.exits",
		metric.WithDescription("Count of workers that exited on their own (crash / self-exit, not an explicit kill), tagged by cause."),
	); err != nil {
		slog.Warn("langy telemetry: worker.exits instrument", "err", err)
		t.workerExits, _ = fallback.Int64Counter("langy.worker.exits")
	}
	if t.workersActive, err = meter.Int64UpDownCounter(
		"langy.workers.active",
		metric.WithDescription("Number of live workers in the pool."),
	); err != nil {
		slog.Warn("langy telemetry: workers.active instrument", "err", err)
		t.workersActive, _ = fallback.Int64UpDownCounter("langy.workers.active")
	}
	if t.atCapacity, err = meter.Int64Counter(
		"langy.pool.at_capacity",
		metric.WithDescription("Count of requests rejected because MAX_WORKERS is reached."),
	); err != nil {
		slog.Warn("langy telemetry: pool.at_capacity instrument", "err", err)
		t.atCapacity, _ = fallback.Int64Counter("langy.pool.at_capacity")
	}
	if t.turnDuration, err = meter.Float64Histogram(
		"langy.turn.duration",
		metric.WithUnit("s"),
		metric.WithDescription("Wall-clock duration of a chat turn, tagged by outcome."),
	); err != nil {
		slog.Warn("langy telemetry: turn.duration instrument", "err", err)
		t.turnDuration, _ = fallback.Float64Histogram("langy.turn.duration")
	}
	if t.spawnDuration, err = meter.Float64Histogram(
		"langy.worker.spawn_duration",
		metric.WithUnit("s"),
		metric.WithDescription("Wall-clock duration of a worker spawn, tagged by outcome."),
	); err != nil {
		slog.Warn("langy telemetry: worker.spawn_duration instrument", "err", err)
		t.spawnDuration, _ = fallback.Float64Histogram("langy.worker.spawn_duration")
	}
	if t.readinessSeconds, err = meter.Float64Histogram(
		"langy.worker.readiness_duration",
		metric.WithUnit("s"),
		metric.WithDescription("Wall-clock time until a spawned worker's opencode is ready, tagged by outcome."),
	); err != nil {
		slog.Warn("langy telemetry: worker.readiness_duration instrument", "err", err)
		t.readinessSeconds, _ = fallback.Float64Histogram("langy.worker.readiness_duration")
	}

	return t
}

// StartTurn opens the per-turn span. Callers defer span.End().
func (t *Telemetry) StartTurn(ctx context.Context, conversationID string) (context.Context, trace.Span) {
	return t.tracer.Start(ctx, "langy.turn",
		trace.WithAttributes(attribute.String("langy.conversation_id", conversationID)),
	)
}

// StartSpawn opens the worker-spawn span. Callers defer span.End().
func (t *Telemetry) StartSpawn(ctx context.Context, conversationID string) (context.Context, trace.Span) {
	return t.tracer.Start(ctx, "langy.worker.spawn",
		trace.WithAttributes(attribute.String("langy.conversation_id", conversationID)),
	)
}

// TurnObserved records a completed turn's duration + outcome.
func (t *Telemetry) TurnObserved(ctx context.Context, seconds float64, outcome string) {
	t.turnDuration.Record(ctx, seconds, metric.WithAttributes(attribute.String("outcome", outcome)))
}

// AtCapacity records a rejected-at-capacity request.
func (t *Telemetry) AtCapacity(ctx context.Context) {
	t.atCapacity.Add(ctx, 1)
}

// WorkerSpawned records a spawn attempt's outcome, duration, and (on success)
// bumps the active-workers gauge.
func (t *Telemetry) WorkerSpawned(ctx context.Context, seconds float64, ok bool) {
	outcome := "ok"
	if !ok {
		outcome = "error"
	}
	t.workerSpawns.Add(ctx, 1, metric.WithAttributes(attribute.String("outcome", outcome)))
	t.spawnDuration.Record(ctx, seconds, metric.WithAttributes(attribute.String("outcome", outcome)))
	if ok {
		t.workersActive.Add(ctx, 1)
	}
}

// ReadinessObserved records how long a worker took to become ready.
func (t *Telemetry) ReadinessObserved(ctx context.Context, seconds float64, ok bool) {
	outcome := "ready"
	if !ok {
		outcome = "timeout"
	}
	t.readinessSeconds.Record(ctx, seconds, metric.WithAttributes(attribute.String("outcome", outcome)))
}

// WorkerKilled records a kill and decrements the active-workers gauge.
func (t *Telemetry) WorkerKilled(ctx context.Context, reason string) {
	t.workerKills.Add(ctx, 1, metric.WithAttributes(attribute.String("reason", reason)))
	t.workersActive.Add(ctx, -1)
}

// WorkerExited decrements the active-workers gauge for a worker that exited on
// its own — a crash or self-exit that never went through kill(). kill() already
// decrements via WorkerKilled, so this is called ONLY on the identity-owned exit
// path in onWorkerExit (the branch that deletes our own registry entry). Without
// it the gauge drifts upward every time a worker dies without an explicit kill.
func (t *Telemetry) WorkerExited(ctx context.Context) {
	t.workerExits.Add(ctx, 1, metric.WithAttributes(attribute.String("cause", "self_exit")))
	t.workersActive.Add(ctx, -1)
}
