package ingestionbench

// Markdown rendering for the benchmark's GitHub job summary.
//
// Pure — takes samples and stage results, returns a string. Kept separate
// from the driver so the formatting is unit-tested rather than eyeballed in a
// CI log after the fact.

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// ResourceSample is one point on a target's resource curve.
type ResourceSample struct {
	// AtMs is ms since epoch.
	AtMs int64
	// Target is a pod name, or a host-process label.
	Target string
	// CPUMillicores is millicores.
	CPUMillicores int
	// MemoryBytes is bytes of working set.
	MemoryBytes int64
}

// StageResult is everything one workload stage produced.
type StageResult struct {
	Stage        StageName
	Description  string
	StartedAtMs  int64
	FinishedAtMs int64
	// SpansSent is the spans the driver POSTed.
	SpansSent int
	// SpansAccepted is the spans the receiver ACCEPTED — sent minus
	// partialSuccess.rejectedSpans. All correctness comparisons use this, never
	// SpansSent: the receiver can return 2xx while rejecting spans, and
	// treating those as sent would report data loss that never happened.
	SpansAccepted  int
	SpansRejected  int
	RequestsSent   int
	RequestsFailed int
	Violations     []Violation
	// SettleTimedOut is true when the stage verified a pipeline that had not
	// visibly caught up, so its shortfalls may be lag rather than loss. Kept
	// in results.json because it is what decides whether a shortfall is a
	// failure or an inconclusive result, and reading the artifact without it
	// would show violations the run did not fail on.
	SettleTimedOut bool
	Samples        []ResourceSample
}

// pct renders n/d as a one-decimal percentage, or "n/a" when d is zero.
func pct(n, d int) string {
	if d == 0 {
		return "n/a"
	}
	return fmt.Sprintf("%.1f%%", (float64(n)/float64(d))*100)
}

// formatThousands renders an integer with comma group separators, matching the
// TypeScript driver's Number.toLocaleString() output.
func formatThousands(n int) string {
	s := strconv.Itoa(n)
	sign := ""
	if strings.HasPrefix(s, "-") {
		sign, s = "-", s[1:]
	}
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(r)
	}
	return sign + b.String()
}

// StageDurationMs returns the elapsed stage window, never negative.
func StageDurationMs(result StageResult) int64 {
	return max(0, result.FinishedAtMs-result.StartedAtMs)
}

// StageThroughputPerSecond returns accepted spans per second, or zero for an
// instantaneous stage rather than dividing by zero.
func StageThroughputPerSecond(result StageResult) float64 {
	seconds := float64(StageDurationMs(result)) / 1000
	if seconds > 0 {
		return float64(result.SpansAccepted) / seconds
	}
	return 0
}

// PeakCPUMillicores returns the highest CPU sample, or zero for no samples.
func PeakCPUMillicores(samples []ResourceSample) int {
	peak := 0
	for _, s := range samples {
		peak = max(peak, s.CPUMillicores)
	}
	return peak
}

// PeakMemoryBytes returns the highest memory sample, or zero for no samples.
func PeakMemoryBytes(samples []ResourceSample) int64 {
	var peak int64
	for _, s := range samples {
		peak = max(peak, s.MemoryBytes)
	}
	return peak
}

// TargetPeak is one row of the per-pod resource breakdown.
type TargetPeak struct {
	Target        string
	CPUMillicores int
	MemoryBytes   int64
}

// PeaksByTarget returns peak CPU and memory per target, for the per-pod
// breakdown table, sorted by target so the table is stable across runs.
func PeaksByTarget(samples []ResourceSample) []TargetPeak {
	byTarget := map[string]TargetPeak{}
	for _, s := range samples {
		cur := byTarget[s.Target]
		byTarget[s.Target] = TargetPeak{
			Target:        s.Target,
			CPUMillicores: max(cur.CPUMillicores, s.CPUMillicores),
			MemoryBytes:   max(cur.MemoryBytes, s.MemoryBytes),
		}
	}
	peaks := make([]TargetPeak, 0, len(byTarget))
	for _, p := range byTarget {
		peaks = append(peaks, p)
	}
	sort.Slice(peaks, func(i, j int) bool { return peaks[i].Target < peaks[j].Target })
	return peaks
}

// MeasurementCaveat is the header that stops the next person from "fixing"
// this into a flaky gate.
//
// This text is deliberately duplicated between the workflow file and the job
// summary. Someone reading a confusing red run looks at the summary, not at
// the YAML, and that is exactly the moment they decide to add a threshold.
const MeasurementCaveat = "> **These numbers measure contention, not capacity.**\n" +
	"> The 3-replica ClickHouse, its Keepers, the platform, and the load driver all share\n" +
	"> 4 vCPU on one runner. Throughput and CPU here are far below what the same code does\n" +
	"> on real hardware, and they move run to run with whatever else the runner is doing.\n" +
	">\n" +
	"> **Resource figures are informational and never fail the run.** Only the correctness\n" +
	"> checks gate. Compare against the baseline artifact from a previous run on the same\n" +
	"> runner size — never against an absolute threshold."

// RenderStageTable renders the one-row-per-stage summary table.
func RenderStageTable(results []StageResult) string {
	var b strings.Builder
	b.WriteString("| Stage | Spans accepted | Rejected | Duration | Spans/s | Peak CPU | Peak memory | Correctness |\n")
	b.WriteString("| --- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |")

	for _, r := range results {
		verdict := "PASS"
		if len(r.Violations) != 0 {
			verdict = fmt.Sprintf("**FAIL** (%d)", len(r.Violations))
		}
		fmt.Fprintf(&b, "\n| `%s` | %s | %s | %.1fs | %.0f | %dm | %s | %s |",
			r.Stage,
			formatThousands(r.SpansAccepted),
			formatThousands(r.SpansRejected),
			float64(StageDurationMs(r))/1000,
			StageThroughputPerSecond(r),
			PeakCPUMillicores(r.Samples),
			FormatBytes(PeakMemoryBytes(r.Samples)),
			verdict,
		)
	}
	return b.String()
}

// RenderResourceBreakdown renders a per-target peak table for each stage.
func RenderResourceBreakdown(results []StageResult) string {
	sections := []string{}
	for _, r := range results {
		peaks := PeaksByTarget(r.Samples)
		if len(peaks) == 0 {
			sections = append(sections, fmt.Sprintf("### `%s`\n\n_No resource samples captured._", r.Stage))
			continue
		}
		var b strings.Builder
		fmt.Fprintf(&b, "### `%s`\n\n", r.Stage)
		b.WriteString("| Target | Peak CPU | Peak memory |\n")
		b.WriteString("| --- | ---: | ---: |")
		for _, p := range peaks {
			fmt.Fprintf(&b, "\n| `%s` | %dm | %s |", p.Target, p.CPUMillicores, FormatBytes(p.MemoryBytes))
		}
		sections = append(sections, b.String())
	}
	return strings.Join(sections, "\n\n")
}

// RenderCorrectnessSection renders the verdict, naming only failing stages.
//
// The heading is the verdict the exit code carries, so a reader of the job
// summary and a reader of the exit status never disagree: a run whose only
// shortfalls came from a stage that never settled is INCONCLUSIVE in both.
func RenderCorrectnessSection(results []StageResult) string {
	var all []Violation
	settled := true
	for _, r := range results {
		all = append(all, r.Violations...)
		if r.SettleTimedOut {
			settled = false
		}
	}

	var b strings.Builder
	b.WriteString("## Correctness\n\n")

	switch ClassifyRun(all, settled) {
	case VerdictPassed:
		b.WriteString("All stages passed: no lost spans, no double-counted `SpanCount`, no cross-tenant leakage.")
		writeUnsettledStages(&b, results)
		return b.String()
	case VerdictInconclusive:
		b.WriteString("**This run was INCONCLUSIVE.**\n\n" +
			"The shortfalls below come from a stage that gave up waiting for the pipeline to " +
			"catch up, so they may be lag rather than loss. Re-run with a longer settle timeout " +
			"before reading them as a regression.\n")
	default:
		b.WriteString("**This run FAILED.**\n")
	}

	for _, r := range results {
		if len(r.Violations) == 0 {
			continue
		}
		fmt.Fprintf(&b, "\n### `%s`\n\n%s\n", r.Stage, SummarizeViolations(r.Violations))
	}
	writeUnsettledStages(&b, results)
	return b.String()
}

// writeUnsettledStages names the stages that stopped waiting, if any.
//
// Worth saying even on a passing run: it is the signal that the settle timeout
// is too short for this scale, and the next run at the same size may well be
// the one that cannot decide.
func writeUnsettledStages(b *strings.Builder, results []StageResult) {
	var stages []string
	for _, r := range results {
		if r.SettleTimedOut {
			stages = append(stages, fmt.Sprintf("`%s`", r.Stage))
		}
	}
	if len(stages) == 0 {
		return
	}
	fmt.Fprintf(b, "\nStages that timed out settling: %s. Raise `settle_timeout` for a run at this scale.\n",
		strings.Join(stages, ", "))
}

// RenderJobSummaryOptions are the inputs to RenderJobSummary.
type RenderJobSummaryOptions struct {
	// Results are the completed stages. Treat as read-only.
	Results []StageResult
	// Scale is fractional on purpose: local runs use -scale 0.1, and rendering
	// that as an integer would report a run that never happened.
	Scale                 float64
	ProjectedPayloadBytes int64
	RunnerLabel           string
}

// RenderJobSummary renders the whole GitHub job summary, caveat first.
func RenderJobSummary(opts RenderJobSummaryOptions) string {
	totalAccepted, totalRejected, totalFailedReqs, totalReqs := 0, 0, 0, 0
	for _, r := range opts.Results {
		totalAccepted += r.SpansAccepted
		totalRejected += r.SpansRejected
		totalFailedReqs += r.RequestsFailed
		totalReqs += r.RequestsSent
	}

	var b strings.Builder
	b.WriteString("# Event-sourcing ingestion benchmark\n\n")
	b.WriteString(MeasurementCaveat)
	b.WriteString("\n\n")
	fmt.Fprintf(&b, "**Runner:** `%s` · **Scale:** `%s` · **Projected payload:** %s\n\n",
		opts.RunnerLabel, formatScale(opts.Scale), FormatBytes(opts.ProjectedPayloadBytes))
	fmt.Fprintf(&b, "**Totals:** %s spans accepted, %s rejected, %s/%s requests failed (%s)\n\n",
		formatThousands(totalAccepted), formatThousands(totalRejected),
		formatThousands(totalFailedReqs), formatThousands(totalReqs),
		pct(totalFailedReqs, totalReqs))
	b.WriteString("## Stages\n\n")
	b.WriteString(RenderStageTable(opts.Results))
	b.WriteString("\n\n")
	b.WriteString(RenderCorrectnessSection(opts.Results))
	b.WriteString("\n\n## Resource usage (informational)\n\n")
	b.WriteString(RenderResourceBreakdown(opts.Results))
	b.WriteString("\n\n---\n\n")
	b.WriteString("Raw samples are attached to this run as the `ingestion-benchmark-samples` artifact.")
	return b.String()
}
