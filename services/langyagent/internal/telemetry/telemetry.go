// Package telemetry holds the langyagent manager's OpenTelemetry spans and
// metric instruments. It is deliberately a small infrastructure helper shared
// by both the app orchestrator (per-turn latency, at-capacity) and the
// workerpool driven adapter (spawn / kill / readiness) so operational
// telemetry has ONE definition instead of being scattered.
//
// The manager previously emitted zero OTel. This package is the load-bearing
// seam ADR-047 calls out: PR4's egress monitoring hangs off the same tracer
// and meter. pkg/otelsetup installs BOTH the global TracerProvider and (on the
// single-tenant primary path) the global MeterProvider, so spans AND these
// metric instruments export whenever OTEL_OTLP_ENDPOINT is configured. If no
// endpoint is set the global providers are the SDK no-ops and every call site is
// a safe no-op — the wiring is identical, nothing is exported.
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
	f := instrumentFactory{
		meter:    otel.Meter(instrumentationName),
		fallback: noop.NewMeterProvider().Meter(instrumentationName),
	}
	return &Telemetry{
		tracer:           otel.Tracer(instrumentationName),
		workerSpawns:     f.int64Counter("langy.worker.spawns", "Count of worker spawn attempts, tagged by outcome."),
		workerKills:      f.int64Counter("langy.worker.kills", "Count of worker kills, tagged by reason."),
		workerExits:      f.int64Counter("langy.worker.exits", "Count of workers that exited on their own (crash / self-exit, not an explicit kill), tagged by cause."),
		workersActive:    f.int64UpDownCounter("langy.workers.active", "Number of live workers in the pool."),
		atCapacity:       f.int64Counter("langy.pool.at_capacity", "Count of requests rejected because MAX_WORKERS is reached."),
		turnDuration:     f.float64Histogram("langy.turn.duration", "Wall-clock duration of a chat turn, tagged by outcome."),
		spawnDuration:    f.float64Histogram("langy.worker.spawn_duration", "Wall-clock duration of a worker spawn, tagged by outcome."),
		readinessSeconds: f.float64Histogram("langy.worker.readiness_duration", "Wall-clock time until a spawned worker's harness is ready, tagged by outcome."),
	}
}

// instrumentFactory creates instruments on the real meter and downgrades each
// failure to a no-op instrument (with a warning), so Telemetry construction
// never fails.
type instrumentFactory struct {
	meter    metric.Meter
	fallback metric.Meter
}

func (f instrumentFactory) int64Counter(name, description string) metric.Int64Counter {
	c, err := f.meter.Int64Counter(name, metric.WithDescription(description))
	if err != nil {
		slog.Warn("langy telemetry: instrument", "name", name, "err", err)
		c, _ = f.fallback.Int64Counter(name)
	}
	return c
}

func (f instrumentFactory) int64UpDownCounter(name, description string) metric.Int64UpDownCounter {
	c, err := f.meter.Int64UpDownCounter(name, metric.WithDescription(description))
	if err != nil {
		slog.Warn("langy telemetry: instrument", "name", name, "err", err)
		c, _ = f.fallback.Int64UpDownCounter(name)
	}
	return c
}

// float64Histogram always records seconds; every histogram this package owns
// is a wall-clock duration.
func (f instrumentFactory) float64Histogram(name, description string) metric.Float64Histogram {
	h, err := f.meter.Float64Histogram(name, metric.WithUnit("s"), metric.WithDescription(description))
	if err != nil {
		slog.Warn("langy telemetry: instrument", "name", name, "err", err)
		h, _ = f.fallback.Float64Histogram(name)
	}
	return h
}

// StartTurn opens the per-turn span. Callers defer span.End(). turnID is the
// control plane's idempotency key (so a trace pins to exactly one turn) and intent
// is the caller's create/revive/continue worker-turn label.
func (t *Telemetry) StartTurn(ctx context.Context, conversationID, turnID, intent string) (context.Context, trace.Span) {
	return t.tracer.Start(ctx, "langy.turn", //nolint:spancheck // span is returned; the caller defers End()
		trace.WithAttributes(
			attribute.String("langy.conversation_id", conversationID),
			attribute.String("langy.turn_id", turnID),
			attribute.String("langy.worker_intent", intent),
		),
	)
}

// StartSpawn opens the worker-spawn span. Callers defer span.End().
func (t *Telemetry) StartSpawn(ctx context.Context, conversationID string) (context.Context, trace.Span) {
	return t.tracer.Start(ctx, "langy.worker.spawn", //nolint:spancheck // span is returned; the caller defers End()
		trace.WithAttributes(attribute.String("langy.conversation_id", conversationID)),
	)
}

// StartPhase opens a child span for one phase of a worker spawn — egress prep,
// home/skills provision, opencode spawn, readiness wait. Deliberately generic: the
// phases share no attributes and the langy.* span name is the only thing that
// varies, so the spawn waterfall stays one cheap helper instead of a near-identical
// method per phase. Callers defer span.End() and set any per-phase attribute (e.g.
// the runner name) at the call site.
func (t *Telemetry) StartPhase(ctx context.Context, name string) (context.Context, trace.Span) {
	return t.tracer.Start(ctx, name) //nolint:spancheck // span is returned; the caller defers End()
}

// TurnObserved records a completed turn's duration, outcome, and intent.
func (t *Telemetry) TurnObserved(ctx context.Context, seconds float64, outcome, intent string) {
	t.turnDuration.Record(ctx, seconds, metric.WithAttributes(
		attribute.String("outcome", outcome),
		attribute.String("langy.worker_intent", intent),
	))
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
