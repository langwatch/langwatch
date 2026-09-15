package visualdiff

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// RecaptureRequest is one `visualdiff recapture` invocation: which run's
// stacks to hit again, and which routes to recapture against them.
type RecaptureRequest struct {
	Root   string
	RunID  string
	Routes []string
	Deps   Deps
}

// RecaptureResult is what a recapture found.
type RecaptureResult struct {
	Findings     int
	FindingsPath string
}

// Recapture re-runs the capture step for a subset of routes against a run's
// already-up stacks - the ones a `run -keep` left running under their own
// haven slugs - and appends its findings to the same findings.jsonl that run
// wrote. It reads the plan the run's own capture step persisted
// (<rundir>/shots/plan.json), so it never has to re-derive the stacks'
// URLs, and it never checks out a worktree, never runs haven up, and never
// tears anything down: a triage loop owns that lifecycle itself, starting
// with -keep and tearing down with the ordinary teardown path when it is
// done recapturing (see README "A triage loop").
func Recapture(ctx context.Context, request RecaptureRequest, streams Streams) (RecaptureResult, error) {
	request.Deps.fill()
	if request.RunID == "" {
		return RecaptureResult{}, fmt.Errorf("recapture: -run is required")
	}
	if len(request.Routes) == 0 {
		return RecaptureResult{}, fmt.Errorf("recapture: -routes is required")
	}
	runDir := filepath.Join(request.Root, ".visualdiff", request.RunID)
	planPath := filepath.Join(runDir, "shots", "plan.json")
	plan, err := loadRunnerPlan(planPath)
	if err != nil {
		return RecaptureResult{}, fmt.Errorf("recapture: read %s: %w", planPath, err)
	}
	plan.Routes = request.Routes
	plan.Flows = nil
	fmt.Fprintf(streams.Err, "recapture: %d route(s) against run %s\n", len(plan.Routes), request.RunID)
	findingsPath := filepath.Join(runDir, FindingsFile)
	stream, err := runWithFindings(ctx, findingsRunInputs{
		Deps: request.Deps, Plan: plan, Options: CaptureOptions{Root: request.Root, Stderr: streams.Err},
		FindingsPath: findingsPath, CatalogueRoot: request.Root,
	})
	if err != nil {
		return RecaptureResult{}, fmt.Errorf("recapture: %w", err)
	}
	rows := BuildRows(stream.Captures, stream.Diffs)
	result := RecaptureResult{Findings: CountFindings(rows), FindingsPath: findingsPath}
	fmt.Fprintf(streams.Out, "recapture: routes=%d findings=%d findings_file=%s\n", len(plan.Routes), result.Findings, findingsPath)
	return result, nil
}

// loadRunnerPlan reads the plan a run's own capture step wrote to
// <rundir>/shots/plan.json - the two stacks' URLs, the viewport, the settle
// window and the identity the runner signed in with.
func loadRunnerPlan(path string) (RunnerPlan, error) {
	data, err := os.ReadFile(path) // #nosec G304 -- path is this operator's own run directory, named by -run.
	if err != nil {
		return RunnerPlan{}, err
	}
	var plan RunnerPlan
	if err := json.Unmarshal(data, &plan); err != nil {
		return RunnerPlan{}, err
	}
	return plan, nil
}
