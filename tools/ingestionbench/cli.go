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

// streams are the command's two output channels, kept together because the
// split between them is a contract rather than a convenience: the workflow
// captures stdout and pipes it straight into the next step, so anything that is
// not the machine-readable result belongs on stderr.
type streams struct {
	// Out carries the result, and nothing else.
	Out io.Writer
	// Err carries progress, diagnostics and usage.
	Err io.Writer
}

// Run is the ingestionbench CLI. It returns the process exit code: 0 when the
// benchmark passed, 1 when it found a correctness violation, 2 when it could
// not decide.
//
// The distinction matters. Exit 1 means the pipeline is wrong and someone must
// look; exit 2 means the benchmark reached no verdict — it could not be
// configured, could not reach ClickHouse, or saw a stage give up waiting for
// the pipeline to catch up — and says nothing about the code under test.
func Run(args []string, stdout, stderr io.Writer) int {
	out := streams{Out: stdout, Err: stderr}
	if len(args) == 0 {
		fmt.Fprint(out.Err, usage)
		return 2
	}

	ctx := context.Background()

	switch args[0] {
	case "seed":
		return runSeedCommand(ctx, args[1:], out)
	case "run":
		return runBenchmarkCommand(ctx, args[1:], out)
	case "-h", "-help", "--help", "help":
		fmt.Fprint(out.Out, usage)
		return 0
	default:
		fmt.Fprintf(out.Err, "unknown command %q\n\n%s", args[0], usage)
		return 2
	}
}

// runSeedCommand seeds isolated projects and prints them as JSON.
//
// stdout carries ONLY the JSON so the workflow can capture it directly;
// progress goes to stderr.
func runSeedCommand(ctx context.Context, args []string, out streams) int {
	flags := flag.NewFlagSet("ingestionbench seed", flag.ContinueOnError)
	flags.SetOutput(out.Err)
	count := flags.Int("count", 4, "how many projects to seed (minimum 2)")
	// Empty default, resolved from the environment AFTER parsing. A secret must
	// never be a flag's DefValue: ContinueOnError still runs the usage function
	// on a parse failure, and that prints every default — so one mistyped flag
	// would write the Postgres URL, credentials and all, to the workflow log.
	databaseURL := flags.String("database-url", "", "Postgres URL to seed into (defaults to $DATABASE_URL)")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	resolved := seedArgs{
		DatabaseURL: valueOrEnv(*databaseURL, "DATABASE_URL"),
		Count:       *count,
	}
	if err := resolved.validate(); err != nil {
		fmt.Fprintln(out.Err, err)
		return 2
	}

	runID, err := nanoid(8)
	if err != nil {
		fmt.Fprintln(out.Err, err)
		return 2
	}

	plan, err := buildSeedPlan(runID, resolved.Count)
	if err != nil {
		fmt.Fprintln(out.Err, err)
		return 2
	}
	if err := applySeed(ctx, resolved.DatabaseURL, plan.SQL); err != nil {
		fmt.Fprintln(out.Err, err)
		return 2
	}

	for _, tenant := range plan.Tenants {
		fmt.Fprintf(out.Err, "[seed] project %s\n", tenant.ProjectID)
	}

	encoded, err := json.Marshal(plan.Tenants)
	if err != nil {
		fmt.Fprintln(out.Err, err)
		return 2
	}
	fmt.Fprintln(out.Out, string(encoded))
	return 0
}

// runBenchmarkCommand parses the run flags and executes the benchmark.
func runBenchmarkCommand(ctx context.Context, args []string, out streams) int {
	flags := flag.NewFlagSet("ingestionbench run", flag.ContinueOnError)
	flags.SetOutput(out.Err)

	endpoint := flags.String("endpoint", envOr("LANGWATCH_ENDPOINT", "http://localhost:5560"), "platform base URL to ingest against")
	// Both carry secrets — the ClickHouse URL its credentials, the tenants blob
	// every project's API key — so neither may be a flag default. See the note
	// in runSeedCommand: a parse failure prints every DefValue.
	clickhouse := flags.String("clickhouse", "", "ClickHouse URL the correctness checks read from (defaults to $CLICKHOUSE_URL)")
	tenants := flags.String("tenants", "", "tenants as JSON, from `ingestionbench seed` (defaults to $BENCHMARK_TENANTS)")
	scale := flags.Float64("scale", 1, "workload multiplier (trace counts only; payload sizes are fixed)")
	seed := flags.Int64("seed", 1337, "PRNG seed; reuse a failing run's seed to replay it exactly")
	outDir := flags.String("out", "/tmp/ingestion-benchmark", "directory for results.json, samples.json, and summary.md")
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

	parsedTenants, err := parseTenants(valueOrEnv(*tenants, "BENCHMARK_TENANTS"))
	if err != nil {
		fmt.Fprintln(out.Err, err)
		return 2
	}

	resolved := RunArgs{
		Endpoint:      *endpoint,
		ClickHouse:    valueOrEnv(*clickhouse, "CLICKHOUSE_URL"),
		Tenants:       parsedTenants,
		Scale:         *scale,
		Seed:          *seed,
		Out:           *outDir,
		RunnerLabel:   *runnerLabel,
		SpanEventType: *spanEventType,
		SettleTimeout: *settleTimeout,
		Namespace:     *namespace,
	}
	if err := resolved.validate(); err != nil {
		fmt.Fprintln(out.Err, err)
		return 2
	}

	outcome, err := RunBenchmark(ctx, resolved, out)
	if err != nil {
		fmt.Fprintf(out.Err, "[benchmark] could not run: %v\n", err)
		return 2
	}

	return reportVerdict(outcome, out)
}

// reportVerdict says what the run concluded and returns the exit code that
// carries it.
//
// The wording and the exit code are decided in one place on purpose: a log
// line that says FAILED next to an exit code that means "could not tell" is
// worse than either signal alone.
func reportVerdict(outcome RunOutcome, out streams) int {
	verdict := ClassifyRun(outcome.Violations, outcome.Settled)
	switch verdict {
	case VerdictViolated:
		fmt.Fprintf(out.Err, "[benchmark] FAILED with %d correctness violation(s).\n%s\n",
			len(outcome.Violations), SummarizeViolations(outcome.Violations))
	case VerdictInconclusive:
		// Deliberately not exit 1: a stage stopped waiting before the pipeline
		// caught up, so every shortfall below is as consistent with a slow
		// path as with a lost span. Raising -settle-timeout is the next step,
		// not opening a data-loss investigation.
		fmt.Fprintf(out.Err,
			"[benchmark] INCONCLUSIVE: a stage timed out waiting for the pipeline to catch up, "+
				"and the %d shortfall(s) below may be lag rather than loss. Re-run with a longer "+
				"-settle-timeout.\n%s\n",
			len(outcome.Violations), SummarizeViolations(outcome.Violations))
	default:
		fmt.Fprintln(out.Out, "[benchmark] all stages passed.")
	}
	return verdict.ExitCode()
}

// envOr returns the environment variable, or fallback when it is unset.
func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// valueOrEnv resolves a flag that carries a secret: the explicit flag wins, and
// the environment fills in when it was not given.
//
// The resolution happens AFTER parsing on purpose. Handing the environment
// value to `flags.String` as its default would put a credential in the flag's
// DefValue, and `flag.ContinueOnError` still runs the usage function when
// parsing fails — which prints every default. One mistyped flag would put the
// Postgres URL, the ClickHouse URL and every tenant's API key into a log the
// workflow captures and uploads.
func valueOrEnv(given, key string) string {
	if given != "" {
		return given
	}
	return os.Getenv(key)
}
