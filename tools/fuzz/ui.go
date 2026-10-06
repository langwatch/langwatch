package fuzz

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
)

// DefaultUIWorkers is how many pages the UI monkey drives at once.
const DefaultUIWorkers = 16

// DefaultReloadEvery is the UI runner's full-load cadence: one load, then four in-app visits.
const DefaultReloadEvery = 5

// DefaultUIMaxErrors is how many visits in a row that error or stay loading stop a UI run.
const DefaultUIMaxErrors = 10

// DefaultActionsPerRoute is how long the UI runner stays on one route.
const DefaultActionsPerRoute = 40

// uiPlan is what the Go side writes to plan.json for the TypeScript runner; the
// two halves agree on this shape by file (README.md "UI protocol").
type uiPlan struct {
	RunID           string          `json:"runId"`
	URL             string          `json:"url"`
	Seed            int64           `json:"seed"`
	Workers         int             `json:"workers"`
	DurationMs      int64           `json:"durationMs"`
	ActionsPerRoute int             `json:"actionsPerRoute"`
	ReloadEvery     int             `json:"reloadEvery"`
	Only            string          `json:"only"`
	MaxErrors       int             `json:"maxConsecutiveErrors"`
	Org             diffkit.ToolOrg `json:"org"`
	Credential      uiCredential    `json:"credential"`
}

type uiCredential struct {
	Email          string   `json:"email"`
	Password       string   `json:"password"`
	FallbackEmails []string `json:"fallbackEmails,omitempty"`
}

// fuzzUIEmail is the seeded account the UI fuzzer browses as (apps/tasks storage-seed). The
// admin's session list, passkey offer and password are state other tools read, so the fuzzer
// gets an account of its own and falls back to the admin only where the seed predates it.
const fuzzUIEmail = "fuzz-ui@mail.langwatch.localhost"

// runUI seeds the fuzzer org (so its account and credentials exist), writes
// plan.json, and execs the TypeScript runner another lane owns under
// tools/fuzz/runner. Absent that runner it is a stub: it writes the plan and
// says so, leaving findings.jsonl for the runner to fill.
func runUI(ctx context.Context, streams Streams, options Options) error {
	options.uiDefaults()
	appURL, err := uiAppURL(ctx, options)
	if err != nil {
		return diffkit.SetupFailed(err)
	}
	runID := time.Now().Format("20060102-150405")
	runDir := filepath.Join(options.Root, ".fuzz", runID)
	if err := os.MkdirAll(runDir, 0o750); err != nil {
		return diffkit.SetupFailed(err)
	}
	org, err := diffkit.SeedToolOrg(ctx, diffkit.SeedOptions{
		BaseURL: appURL, Tool: "fuzzer", Projects: 1, Dir: filepath.Dir(runDir),
		Progress: func(line string) { fmt.Fprintln(streams.Err, line) },
	})
	if err != nil {
		return diffkit.SetupFailed(fmt.Errorf("seed fuzzer org: %w", err))
	}
	plan := uiPlan{
		RunID: runID, URL: appURL, Seed: options.Seed, Workers: options.Workers,
		DurationMs: options.Duration.Milliseconds(), ActionsPerRoute: options.ActionsPerRoute, ReloadEvery: options.ReloadEvery, Only: options.Only, MaxErrors: options.errorLimit(DefaultUIMaxErrors), Org: org,
		Credential: uiCredential{Email: fuzzUIEmail, Password: diffkit.CeremonyPassword, FallbackEmails: []string{diffkit.CeremonyEmail("fuzzer")}},
	}
	planPath := filepath.Join(runDir, "plan.json")
	if err := writeJSON(planPath, plan); err != nil {
		return err
	}
	fmt.Fprintf(streams.Err, "fuzz ui: wrote %s\n", planPath)

	return runUIRunner(ctx, streams, uiRunnerPaths{root: options.Root, plan: planPath, out: runDir})
}

// uiRunnerPaths are the repository root, the plan the runner reads and the
// directory it writes to.
type uiRunnerPaths struct {
	root, plan, out string
}

// runUIRunner runs the Node UI runner over the plan, when it is present.
func runUIRunner(ctx context.Context, streams Streams, paths uiRunnerPaths) error {
	planPath, runDir := paths.plan, paths.out
	runner := filepath.Join(paths.root, "tools", "fuzz", "runner")
	if _, err := os.Stat(filepath.Join(runner, "package.json")); err != nil {
		fmt.Fprintln(streams.Err, "fuzz ui: runner not present yet (tools/fuzz/runner); plan.json written for it to build against")
		return nil
	}
	command := exec.CommandContext(ctx, "pnpm", "--dir", runner, "start", "--", "--plan", planPath, "--out", runDir)
	command.Stdout, command.Stderr = streams.Out, streams.Err
	err := command.Run()
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == diffkit.ExitStopped {
		return &diffkit.Stopped{} // the runner printed why
	}
	return err
}

// uiDefaults fills the UI run's unset knobs.
func (options *Options) uiDefaults() {
	if options.Workers <= 0 {
		options.Workers = DefaultUIWorkers
	}
	if options.ActionsPerRoute <= 0 {
		options.ActionsPerRoute = DefaultActionsPerRoute
	}
	if options.ReloadEvery <= 0 {
		options.ReloadEvery = DefaultReloadEvery
	}
}

// uiAppURL is -url, else diffsuite's branch stack.
func uiAppURL(ctx context.Context, options Options) (string, error) {
	if options.URL != "" {
		return options.URL, nil
	}
	stack, err := diffkit.BranchStack(ctx)
	if err != nil {
		return "", err
	}
	return stack.AppURL, nil
}

func writeJSON(path string, value any) error {
	encoded, err := json.MarshalIndent(value, "", " ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, encoded, 0o600)
}
