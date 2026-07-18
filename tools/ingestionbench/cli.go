// Package ingestionbench is the event-sourcing ingestion benchmark: it drives
// synthetic OTLP load through the real collector and then asserts, in
// ClickHouse, that nothing was lost, double-counted, or leaked across tenants.
//
// The load generation, the correctness rules, and the reporting are pure and
// unit-tested (otlp.go, workload.go, verify.go, report.go). Everything impure
// — HTTP, ClickHouse, kubectl, psql, argv — lives in cli.go, driver.go,
// clickhouse.go, and seed.go. Keep it that way: anything with a decision in it
// belongs in the pure half, where it can be tested without infrastructure.
//
// Docs: dev/docs/event-sourcing-ingestion-benchmark.md
// Spec: specs/ci/event-sourcing-ingestion-benchmark.feature
package ingestionbench

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"time"
)

const usage = `ingestionbench drives the event-sourcing ingestion benchmark.

Usage:
  ingestionbench seed [-count N] [-database-url URL]
  ingestionbench run  -clickhouse URL [-endpoint URL] [-tenants JSON] [flags]

Commands:
  seed   Mint isolated projects for a run and print them as JSON on stdout.
  run    Send the workload, verify correctness, and write the report.

Run "ingestionbench <command> -h" for the flags of each command.
`

// Run is the ingestionbench CLI. It returns the process exit code: 0 when the
// benchmark passed, 1 when it found a correctness violation, 2 when it could
// not be run at all.
//
// The distinction matters. Exit 1 means the pipeline is wrong and someone must
// look; exit 2 means the benchmark itself could not reach ClickHouse, or was
// misconfigured, and says nothing about the code under test.
func Run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}

	ctx := context.Background()

	switch args[0] {
	case "seed":
		return runSeedCommand(ctx, args[1:], stdout, stderr)
	case "run":
		return runBenchmarkCommand(ctx, args[1:], stdout, stderr)
	case "-h", "-help", "--help", "help":
		fmt.Fprint(stdout, usage)
		return 0
	default:
		fmt.Fprintf(stderr, "unknown command %q\n\n%s", args[0], usage)
		return 2
	}
}

// runSeedCommand seeds isolated projects and prints them as JSON.
//
// stdout carries ONLY the JSON so the workflow can capture it directly;
// progress goes to stderr.
func runSeedCommand(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("ingestionbench seed", flag.ContinueOnError)
	flags.SetOutput(stderr)
	count := flags.Int("count", 4, "how many projects to seed (minimum 2)")
	databaseURL := flags.String("database-url", os.Getenv("DATABASE_URL"), "Postgres URL to seed into")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	resolved := seedArgs{DatabaseURL: *databaseURL, Count: *count}
	if err := resolved.validate(); err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}

	runID, err := nanoid(8)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}

	plan, err := buildSeedPlan(runID, resolved.Count)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	if err := applySeed(ctx, resolved.DatabaseURL, plan.SQL); err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}

	for _, tenant := range plan.Tenants {
		fmt.Fprintf(stderr, "[seed] project %s\n", tenant.ProjectID)
	}

	encoded, err := json.Marshal(plan.Tenants)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	fmt.Fprintln(stdout, string(encoded))
	return 0
}

// runBenchmarkCommand parses the run flags and executes the benchmark.
func runBenchmarkCommand(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("ingestionbench run", flag.ContinueOnError)
	flags.SetOutput(stderr)

	endpoint := flags.String("endpoint", envOr("LANGWATCH_ENDPOINT", "http://localhost:5560"), "platform base URL to ingest against")
	clickhouse := flags.String("clickhouse", os.Getenv("CLICKHOUSE_URL"), "ClickHouse URL the correctness checks read from")
	tenants := flags.String("tenants", os.Getenv("BENCHMARK_TENANTS"), "tenants as JSON, from `ingestionbench seed`")
	scale := flags.Float64("scale", 1, "workload multiplier (trace counts only; payload sizes are fixed)")
	seed := flags.Int64("seed", 1337, "PRNG seed; reuse a failing run's seed to replay it exactly")
	out := flags.String("out", "/tmp/ingestion-benchmark", "directory for results.json, samples.json, and summary.md")
	runnerLabel := flags.String("runner-label", envOr("RUNNER_LABEL", "unknown"), "runner the numbers were measured on, recorded in the report")
	// The trace aggregate carries several event types; only the span-recording
	// one is counted. Overridable so a rename does not silently zero the
	// event_log layer check.
	spanEventType := flags.String("span-event-type", envOr("BENCHMARK_SPAN_EVENT_TYPE", "span.recorded"), "event type counted in the event_log layer check")
	settleTimeout := flags.Duration("settle-timeout", 3*time.Minute, "how long each stage waits for the pipeline to drain")
	namespace := flags.String("namespace", envOr("BENCHMARK_NAMESPACE", "ingestion-bench"), "Kubernetes namespace sampled for informational resource usage")

	if err := flags.Parse(args); err != nil {
		return 2
	}

	parsedTenants, err := parseTenants(*tenants)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}

	resolved := RunArgs{
		Endpoint:      *endpoint,
		ClickHouse:    *clickhouse,
		Tenants:       parsedTenants,
		Scale:         *scale,
		Seed:          *seed,
		Out:           *out,
		RunnerLabel:   *runnerLabel,
		SpanEventType: *spanEventType,
		SettleTimeout: *settleTimeout,
		Namespace:     *namespace,
	}
	if err := resolved.validate(); err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}

	violations, err := RunBenchmark(ctx, resolved, stdout, stderr)
	if err != nil {
		fmt.Fprintf(stderr, "[benchmark] could not run: %v\n", err)
		return 2
	}

	if IsFailure(violations) {
		fmt.Fprintf(stderr, "[benchmark] FAILED with %d correctness violation(s).\n%s\n",
			len(violations), SummariseViolations(violations))
		return 1
	}

	fmt.Fprintln(stdout, "[benchmark] all stages passed.")
	return 0
}

// envOr returns the environment variable, or fallback when it is unset.
func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
