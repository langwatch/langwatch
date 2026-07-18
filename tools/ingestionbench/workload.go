// Workload planning for the event-sourcing ingestion benchmark.
//
// Everything here is PURE — it turns a scale factor into a concrete plan and
// checks that plan against a byte budget. It never touches the network, so
// the sizing arithmetic below is unit-tested rather than discovered at 3am
// when a CI volume fills up.
//
// ---------------------------------------------------------------------------
// Why the bounds are what they are
// ---------------------------------------------------------------------------
// The runner is a 4-vCPU / 16 GB / 14 GB-SSD `ubuntu-latest`, and it is
// hosting the kind cluster (3 ClickHouse replicas + 3 Keepers), the platform,
// and this driver, all at once.
//
// DISK is NOT the binding constraint, despite being the scariest number.
// ClickHouse stores each row on all three replicas and ZSTD-compresses the
// heavy columns, which roughly cancel out; the observed multiplier on ingested
// payload bytes lands near 2x, not 6x. The default plan ingests tens of MiB,
// so even a pessimistic 6x multiplier leaves the volume nearly untouched.
//
// WALL CLOCK is the binding constraint. Four shared vCPU running the whole
// stack co-resident means throughput is low and variable, so the plan is sized
// to finish comfortably inside the job timeout rather than to saturate
// anything. That is also why the numbers this produces are contention
// readings, not capacity readings — see the workflow header.
//
// The byte budget is therefore a SAFETY RAIL, not the design target: it exists
// so that someone raising `scale` to 20 gets a clear refusal instead of a run
// that dies half way through with a full volume and tells them nothing.
package ingestionbench

import (
	"fmt"
	"math"
	"strconv"
)

// CommandInlineThresholdBytes is the size above which whole commands are
// spooled to object storage instead of riding inline through Redis
// (`COMMAND_INLINE_THRESHOLD`, ADR-022). The adversarial stage places payloads
// on BOTH sides of this line, because the inline/offload branch is exactly
// where a span goes missing.
//
// NOT to be confused with the identically-valued per-attribute truncation cap
// (MaxAttributeValueBytes in otlp.go) — different behaviour. See the comment
// there.
const CommandInlineThresholdBytes = 256 * 1024

// QueueInlineCeilingBytes is the GroupQueue's inline ceiling: envelopes above
// this are written to a standalone Redis key rather than carried inline.
// Straddled too, since it is a second place a payload can take a different code
// path.
const QueueInlineCeilingBytes = 4 * 1024

// MaxPastSkewMs mirrors `SPAN_MAX_PAST_MS` — the receiver rejects spans whose
// START TIME is further in the past than this. Generated span timestamps must
// stay well inside it, or the stage reports "lost spans" when the receiver was
// working correctly.
const MaxPastSkewMs int64 = 31 * 24 * 60 * 60 * 1000

// DefaultByteBudget refuses a run whose ingested payload exceeds this. At the
// ~2x on-disk multiplier this is well inside the runner's free space, and it is
// far enough above the default plan that normal scaling never trips it.
const DefaultByteBudget = 512 * 1024 * 1024

// SmallSpanBytes is the nominal wire size of an ordinary span, used for
// budgeting only.
const SmallSpanBytes = 1024

// StageName identifies one of the benchmark's three stages.
type StageName string

const (
	StageSerial      StageName = "serial"
	StageConcurrent  StageName = "concurrent"
	StageAdversarial StageName = "adversarial"
)

// SpanSizeMix is the payload size mix of a stage, as counts.
type SpanSizeMix struct {
	// SmallSpans carry an ordinary, small attribute set.
	SmallSpans int
	// NearThresholdSpans are sized just UNDER the inline threshold.
	NearThresholdSpans int
	// OverThresholdSpans are sized just OVER the inline threshold, forcing the
	// offload path.
	OverThresholdSpans int
}

// StagePlan is the plan for one benchmark stage.
type StagePlan struct {
	Stage StageName
	// Tenants is the number of distinct tenants ingesting in this stage.
	Tenants int
	// TracesPerTenant is traces per tenant.
	TracesPerTenant int
	// SpansPerTrace is spans per trace.
	SpansPerTrace int
	// Concurrency is how many requests may be in flight at once.
	Concurrency int
	// SpansPerRequest is spans per HTTP request.
	SpansPerRequest int
	// ScatterAcrossRequests, when true, scatters a trace's spans across
	// concurrent in-flight requests instead of sending them as an ordered run,
	// maximising concurrent processing of the same aggregate. That contention —
	// not anything in the payload — is what produces out-of-order folds. See
	// ScatterAcrossConcurrentArrivals.
	ScatterAcrossRequests bool
	// ResendFraction is the fraction (0..1) of spans sent a second time. The
	// ingest dedup lock must discard them and SpanCount must not move.
	ResendFraction float64
	// BurstSize is the number of spans sent in a dense burst before pausing, or
	// 0 for steady arrival.
	BurstSize int
	// SizeMix is the payload size mix, as counts across the WHOLE stage.
	SizeMix     SpanSizeMix
	Description string
}

// BenchmarkPlan is the whole three-stage plan plus its budget check inputs.
type BenchmarkPlan struct {
	Scale                 float64
	Stages                []StagePlan
	TotalSpans            int
	ProjectedPayloadBytes int
	ByteBudget            int
}

// Sizes chosen for the two straddling buckets. Both sit close enough to the
// threshold that a rounding error in the size check would flip them, which is
// the point — this is a boundary test, not a "big payload" test.
var (
	NearThresholdBytes = int(math.Floor(CommandInlineThresholdBytes * 0.75))
	OverThresholdBytes = int(math.Floor(CommandInlineThresholdBytes * 1.25))
)

// StageSpanTotal is the total spans a stage will send.
func StageSpanTotal(plan StagePlan) int {
	return plan.Tenants * plan.TracesPerTenant * plan.SpansPerTrace
}

// StagePayloadBytes is the projected wire bytes for a stage, from its size mix.
func StagePayloadBytes(plan StagePlan) int {
	return plan.SizeMix.SmallSpans*SmallSpanBytes +
		plan.SizeMix.NearThresholdSpans*NearThresholdBytes +
		plan.SizeMix.OverThresholdSpans*OverThresholdBytes
}

// PlanBenchmark builds the three-stage plan at a given scale.
//
// `scale` multiplies trace counts only — never span SIZES and never the
// out-of-order skew, both of which are calibrated against real thresholds and
// would stop testing the boundary if they moved.
//
// Pass byteBudget <= 0 to use DefaultByteBudget.
func PlanBenchmark(scale float64, byteBudget int) (BenchmarkPlan, error) {
	if math.IsNaN(scale) || math.IsInf(scale, 0) || scale <= 0 {
		return BenchmarkPlan{}, fmt.Errorf("scale must be a positive number, got %v", scale)
	}
	if byteBudget <= 0 {
		byteBudget = DefaultByteBudget
	}

	mul := func(n float64) int {
		v := int(math.Round(n * scale))
		if v < 1 {
			return 1
		}
		return v
	}

	// --- Stage 1: serial stream -------------------------------------------
	// One tenant, one long trace, spans strictly in order, one span per
	// request. This is the per-aggregate FIFO hot path: every span lands on
	// the SAME aggregate, so the fold is re-entered continuously and any
	// per-aggregate ordering bug shows up as a wrong SpanCount.
	serialSpans := mul(2000)
	serial := StagePlan{
		Stage:                 StageSerial,
		Tenants:               1,
		TracesPerTenant:       1,
		SpansPerTrace:         serialSpans,
		Concurrency:           1,
		SpansPerRequest:       1,
		ScatterAcrossRequests: false,
		ResendFraction:        0,
		BurstSize:             0,
		SizeMix:               SpanSizeMix{SmallSpans: serialSpans},
		Description:           "One long trace, spans strictly sequential — fold hot path and per-aggregate FIFO.",
	}

	// --- Stage 2: concurrent influx ---------------------------------------
	// Many traces across several tenants, all in flight together. This is
	// where dispatch fairness and the per-tenant soft cap are exercised: one
	// tenant is given far more traces than the others so an unfair scheduler
	// starves the quiet ones visibly.
	concurrentTenants := 4
	concurrentTraces := mul(50)
	concurrentSpansPerTrace := 40
	concurrentSpans := concurrentTenants * concurrentTraces * concurrentSpansPerTrace
	concurrent := StagePlan{
		Stage:                 StageConcurrent,
		Tenants:               concurrentTenants,
		TracesPerTenant:       concurrentTraces,
		SpansPerTrace:         concurrentSpansPerTrace,
		Concurrency:           16,
		SpansPerRequest:       10,
		ScatterAcrossRequests: false,
		ResendFraction:        0,
		BurstSize:             0,
		SizeMix:               SpanSizeMix{SmallSpans: concurrentSpans},
		Description:           "Many traces ingesting at once across tenants — dispatch fairness and the per-tenant soft cap.",
	}

	// --- Stage 3: adversarial ---------------------------------------------
	// Bursty, out-of-order, multi-tenant, and straddling the inline/offload
	// threshold. This is the stage expected to find real bugs: the
	// out-of-order fraction reproduces the shape of the 2026-07-09 re-fold
	// storm, and the size mix walks both sides of the offload branch.
	advTenants := 3
	advTraces := mul(60)
	advSpansPerTrace := 30
	advTotal := advTenants * advTraces * advSpansPerTrace
	// Large spans are a small, FIXED count — they dominate bytes, so scaling
	// them would blow the byte budget long before the small spans mattered.
	nearThreshold := 60
	overThreshold := 60
	smallSpans := advTotal - nearThreshold - overThreshold
	if smallSpans < 0 {
		smallSpans = 0
	}
	adversarial := StagePlan{
		Stage:           StageAdversarial,
		Tenants:         advTenants,
		TracesPerTenant: advTraces,
		SpansPerTrace:   advSpansPerTrace,
		Concurrency:     24,
		SpansPerRequest: 5,
		// Scatter each trace's spans across concurrent requests so the same
		// aggregate is processed by several workers at once — the only lever a
		// client has on out-of-order folding.
		ScatterAcrossRequests: true,
		// A tenth of the stream is sent twice. The dedup lock must swallow it and
		// SpanCount must not move.
		ResendFraction: 0.1,
		BurstSize:      200,
		SizeMix: SpanSizeMix{
			SmallSpans:         smallSpans,
			NearThresholdSpans: nearThreshold,
			OverThresholdSpans: overThreshold,
		},
		Description: "Bursty, scattered across concurrent arrivals, interleaved tenants, resends, and payloads straddling the offload threshold.",
	}

	stages := []StagePlan{serial, concurrent, adversarial}
	totalSpans := 0
	projectedPayloadBytes := 0
	for _, s := range stages {
		totalSpans += StageSpanTotal(s)
		projectedPayloadBytes += StagePayloadBytes(s)
	}

	plan := BenchmarkPlan{
		Scale:                 scale,
		Stages:                stages,
		TotalSpans:            totalSpans,
		ProjectedPayloadBytes: projectedPayloadBytes,
		ByteBudget:            byteBudget,
	}

	if err := AssertWithinBudget(plan); err != nil {
		return BenchmarkPlan{}, err
	}
	return plan, nil
}

// AssertWithinBudget refuses a plan that would exceed the byte budget. Fails at
// PLANNING time, before a single span is sent, so the operator gets a clear
// message instead of a wedged run.
//
// The TypeScript original threw; here it returns an error. The "Assert" name is
// kept because the semantics are unchanged — a non-nil result means refuse.
func AssertWithinBudget(plan BenchmarkPlan) error {
	if plan.ProjectedPayloadBytes > plan.ByteBudget {
		return fmt.Errorf(
			"Planned workload projects %s of payload, over the %s budget. "+
				"Lower --scale (currently %s) or raise the budget only if you have "+
				"confirmed the runner has the free space for roughly 2x this figure on disk.",
			FormatBytes(int64(plan.ProjectedPayloadBytes)),
			FormatBytes(int64(plan.ByteBudget)),
			formatScale(plan.Scale),
		)
	}
	return nil
}

// formatScale renders the scale the way the operator typed it (1, not 1.0).
func formatScale(scale float64) string {
	return strconv.FormatFloat(scale, 'g', -1, 64)
}

// AssertSpanTimestampIsAccepted validates a generated span start time is recent
// enough to be accepted.
//
// The receiver drops spans older than `SPAN_MAX_PAST_MS` silently-ish, so a
// generator bug that backdates timestamps would surface as "lost spans" and
// send someone hunting a pipeline bug that does not exist.
//
// Returns an error rather than throwing; the "Assert" name is kept because a
// non-nil result still means "this must not proceed".
func AssertSpanTimestampIsAccepted(spanStartMs, nowMs int64) error {
	age := nowMs - spanStartMs
	if age >= MaxPastSkewMs {
		return fmt.Errorf(
			"Generated a span starting %dms in the past, at or beyond the receiver's "+
				"%dms cutoff. It would be rejected by design and the stage would "+
				"report data loss that is not a bug.",
			age, MaxPastSkewMs,
		)
	}
	return nil
}

// FormatBytes renders a byte count in binary units. Takes int64 so memory and
// payload counters (which are int64 elsewhere in the benchmark) pass straight
// through without a cast at every call site.
func FormatBytes(bytes int64) string {
	b := float64(bytes)
	if bytes < 1024 {
		return fmt.Sprintf("%d B", bytes)
	}
	if bytes < 1024*1024 {
		return toFixed(b/1024, 1) + " KiB"
	}
	if bytes < 1024*1024*1024 {
		return toFixed(b/(1024*1024), 1) + " MiB"
	}
	return toFixed(b/(1024*1024*1024), 2) + " GiB"
}

// toFixed matches JavaScript's Number#toFixed, which breaks ties by rounding
// away from zero. Go's strconv rounds ties to even, so the halfway cases would
// otherwise render differently from the TypeScript original.
func toFixed(v float64, digits int) string {
	scale := math.Pow(10, float64(digits))
	return strconv.FormatFloat(math.Floor(v*scale+0.5)/scale, 'f', digits, 64)
}
