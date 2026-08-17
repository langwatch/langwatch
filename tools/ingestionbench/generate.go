package ingestionbench

// Span generation for the ingestion benchmark: turning a stage plan into the
// exact spans it will send.
//
// Seeded and deterministic — the same -seed regenerates the same trace ids, so
// a failing run replays exactly.

import (
	"fmt"
	"strconv"
)

// generatedTrace is one trace's worth of spans, bound to the tenant that will
// send them.
type generatedTrace struct {
	Tenant  Tenant
	TraceID string
	Spans   []OtlpSpan
}

// stageSeed derives a per-stage seed from the run's seed.
//
// Every stage used to build its RNG from the run seed directly, which made the
// three stages generate the SAME sequence — so stage 2's first trace carried
// the identical trace id to stage 1's, against the same tenant. The stages then
// shared rows in ClickHouse: stage 2 read stage 1's spans inside its own trace
// and reported a count mismatch the pipeline never caused.
//
// Derived rather than random so a run stays replayable from one -seed.
func stageSeed(runSeed int64, stage StageName) int64 {
	var offset int64
	for _, b := range []byte(stage) {
		offset = offset*31 + int64(b)
	}
	return runSeed + offset
}

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
	rng := CreateRng(stageSeed(gen.Seed, plan.Stage))

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
