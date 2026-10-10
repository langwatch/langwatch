package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/crypto/bcrypt"

	"github.com/langwatch/langwatch/tools/seedgen"
)

// runOptions are run-only flags: they pick the route and the run directory, never the plan, so
// they stay out of the run id.
type runOptions struct {
	executor, app, runDir string
	resume                bool
}

// parseRunOptions takes the run-only flags out of args and leaves the plan flags.
func parseRunOptions(args []string) (runOptions, []string, error) {
	options := runOptions{executor: "task", app: os.Getenv("BASE_HOST"), runDir: filepath.Join(os.TempDir(), "seedgen")}
	values := map[string]*string{"executor": &options.executor, "app": &options.app, "run-dir": &options.runDir}
	var rest []string
	for i := 0; i < len(args); i++ {
		name, value, hasValue := strings.Cut(strings.TrimLeft(args[i], "-"), "=")
		target, ok := values[name]
		switch {
		case !strings.HasPrefix(args[i], "-"):
			rest = append(rest, args[i])
		case name == "resume":
			options.resume = true
		case !ok:
			rest = append(rest, args[i])
		case hasValue:
			*target = value
		case i+1 < len(args):
			i++
			*target = args[i]
		default:
			return options, nil, fmt.Errorf("--%s needs a value", name)
		}
	}
	return options, rest, options.validate()
}

func (options runOptions) validate() error {
	if options.executor != "task" && options.executor != "door" {
		return &seedgen.FlagError{Flag: "executor", Value: options.executor, Accepts: "task or door"}
	}
	return nil
}

// resumedFlags reads the flags of the run the directory holds, so the run id matches its checkpoint.
func resumedFlags(runDir string) (seedgen.Flags, error) {
	data, err := os.ReadFile(filepath.Join(runDir, "manifest.json"))
	if err != nil {
		return seedgen.Flags{}, fmt.Errorf("--resume: no run to resume in %s: %w", runDir, err)
	}
	var manifest seedgen.Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return seedgen.Flags{}, err
	}
	return manifest.Flags, nil
}

// streams are the run's output and its log.
type streams struct{ stdout, stderr io.Writer }

func runSeed(options runOptions, plan *seedgen.Plan, out streams) int {
	stdout, stderr := out.stdout, out.stderr
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	failure := filepath.Join(options.runDir, seedgen.FailureFile)
	_ = os.Remove(failure)
	fail := func(code int, err error) int {
		_, _ = fmt.Fprintf(stderr, "seedgen run: %v\n", err)
		_ = os.WriteFile(failure, []byte(err.Error()+"\n"), 0o600) //nolint:gosec // seedgen's own --run-dir; haven ends its last line with it
		return code
	}
	checkpointPath := filepath.Join(options.runDir, "run.json")
	checkpoint, err := openCheckpoint(ctx, options, plan)
	if err != nil {
		return fail(2, err)
	}
	if plan.Flags.Into != "" {
		seedgen.BindInto(plan, checkpoint, plan.Flags.Into)
	}
	runnerArgs, err := handDownPasswordHash(options.runDir)
	if err != nil {
		return fail(2, err)
	}
	executor, err := newExecutor(ctx, options, stderr, runnerArgs)
	if err != nil {
		return fail(1, err)
	}
	config := seedgen.RunConfig{Plan: plan, Executor: executor, Checkpoint: checkpoint,
		Path: checkpointPath, Sensors: seedgen.StackSensors(options.app), Log: stderr, Drain: options.app != ""}
	if redis := os.Getenv("REDIS_URL"); redis != "" {
		config.Backlog = seedgen.QueueBacklog(redis)
	}
	result, err := seedgen.Run(ctx, config)
	_ = executor.Close()
	printResult(stdout, result)
	printSeeded(stdout, checkpoint)
	var stall *seedgen.StallError
	if errors.As(err, &stall) {
		return fail(4, err)
	}
	if err != nil {
		return fail(1, err)
	}
	if result.IdentityRefused > 0 {
		return fail(1, fmt.Errorf("%d identity steps were refused; the counts above are what exists", result.IdentityRefused))
	}
	return 0
}

// handDownPasswordHash hashes the one dev password every seeded login shares into a 0600 file in
// the run directory and names it to the runner, so the password never reaches it; with no
// password set, seeded users get none.
func handDownPasswordHash(runDir string) ([]string, error) {
	password := os.Getenv("LANGWATCH_ADMIN_PASSWORD")
	if password == "" {
		return nil, nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		return nil, err
	}
	path := filepath.Join(runDir, "password.hash")
	if err := os.WriteFile(path, hash, 0o600); err != nil {
		return nil, err
	}
	return []string{"--password-hash-file", path}, nil
}

// printSeeded is what exists after the run, counted from acks only, never from the plan.
func printSeeded(w io.Writer, checkpoint *seedgen.Checkpoint) {
	counts := checkpoint.Counters
	_, _ = fmt.Fprintf(w, "seeded: %d orgs, %d users, %d projects, %d members\n", counts[seedgen.KindOrgCreate],
		counts[seedgen.KindUserCreate], counts[seedgen.KindProjectCreate], counts[seedgen.KindMemberAdd])
}

// openCheckpoint loads the run's checkpoint on --resume; otherwise it runs the preflight (exit 2,
// nothing written) and writes the run's manifest.
func openCheckpoint(ctx context.Context, options runOptions, plan *seedgen.Plan) (*seedgen.Checkpoint, error) {
	if options.resume {
		return seedgen.LoadCheckpoint(filepath.Join(options.runDir, "run.json"), plan.Run)
	}
	if err := os.MkdirAll(options.runDir, 0o750); err != nil {
		return nil, err
	}
	free, err := seedgen.FreeDisk(options.runDir)
	if err != nil {
		return nil, err
	}
	capacity := seedgen.Capacity{FreeDisk: free, ClickHouseCap: seedgen.ClickHouseCap(ctx)}
	if err := seedgen.Preflight(plan.Estimate(), plan.Flags.Size, capacity); err != nil {
		return nil, err
	}
	return seedgen.NewCheckpoint(plan.Run, nil), seedgen.NewManifest(plan).Write(options.runDir)
}

func newExecutor(ctx context.Context, options runOptions, log io.Writer, runnerArgs []string) (seedgen.Executor, error) {
	if options.executor == "door" {
		if options.app == "" {
			return nil, errors.New("the door executor needs --app (the haven route) or BASE_HOST")
		}
		return &seedgen.Door{App: options.app, Key: os.Getenv("LANGWATCH_API_KEY")}, nil
	}
	repo, err := repoRoot()
	if err != nil {
		return nil, err
	}
	return seedgen.StartTaskPipe(ctx, repo, log, runnerArgs...)
}

// repoRoot is the nearest directory up from here holding pnpm-workspace.yaml.
func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "pnpm-workspace.yaml")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("not inside the LangWatch checkout: no pnpm-workspace.yaml above here")
		}
		dir = parent
	}
}

func printResult(w io.Writer, result seedgen.Result) {
	_, _ = fmt.Fprintf(w, "sent %d actions and %d cells (%d spans, %d logs, %d metric points) in %s; drained in %s\n",
		result.Actions, result.Cells, result.Spans, result.Logs, result.MetricPoints, result.Sent.Round(1e6),
		result.Drained.Round(1e6))
	if result.SkippedCells > 0 {
		_, _ = fmt.Fprintf(w, "skipped %d cells: their projects were made, and filled, by an earlier run\n", result.SkippedCells)
	}
	if result.Deferred > 0 {
		_, _ = fmt.Fprintf(w, "%d of the seed's jobs are deferred past %s (trace origin's fallback); they run later\n",
			result.Deferred, seedgen.DrainHorizon)
	}
	if total := (result.Sent + result.Drained).Seconds(); total > 0 {
		_, _ = fmt.Fprintf(w, "rate: %.0f spans/s sent, %.0f spans/s sent and drained, %.1f actions/s\n",
			float64(result.Spans)/result.Sent.Seconds(), float64(result.Spans)/total, float64(result.Actions)/result.Sent.Seconds())
	}
	for code, n := range result.Refusals {
		_, _ = fmt.Fprintf(w, "refused %s: %d\n", code, n)
	}
}
