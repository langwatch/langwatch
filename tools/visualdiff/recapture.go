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
	Root    string
	RunID   string
	Routes  []string
	Flows   []string
	Edition Edition
	Deps    Deps
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
	if len(request.Routes) == 0 && len(request.Flows) == 0 {
		return RecaptureResult{}, fmt.Errorf("recapture: -routes or -flows is required")
	}
	if request.Edition == "" {
		request.Edition = EditionEnterprise
	}
	runDir := filepath.Join(request.Root, ".visualdiff", request.RunID)
	planPath := filepath.Join(runDir, "shots", string(request.Edition), "plan.json")
	plan, err := loadRunnerPlan(planPath)
	if err != nil {
		return RecaptureResult{}, fmt.Errorf("recapture: read %s: %w", planPath, err)
	}
	plan.Routes = request.Routes
	plan.Flows = selectFlows(plan.Flows, request.Flows)
	plan.FailFast = false
	if len(plan.Stacks) > 0 {
		if err := newEditionSwitch(request.Deps.Run, request.Deps.Environ, "").Set(ctx, request.Edition, plan.Stacks); err != nil {
			return RecaptureResult{}, fmt.Errorf("recapture: %w", err)
		}
	}
	fmt.Fprintf(streams.Err, "recapture: %d route(s), %d flow(s) against run %s (%s)\n", len(plan.Routes), len(plan.Flows), request.RunID, request.Edition)
	findingsPath := filepath.Join(runDir, FindingsFile)
	stream, err := runWithFindings(ctx, findingsRunInputs{
		Deps: request.Deps, Plan: plan, Options: CaptureOptions{Root: request.Root, Stderr: streams.Err},
		FindingsPath: findingsPath, CatalogueRoot: request.Root, Edition: request.Edition,
	})
	if err != nil {
		return RecaptureResult{}, fmt.Errorf("recapture: %w", err)
	}
	rows := BuildRows(stream.Captures, stream.Diffs)
	result := RecaptureResult{Findings: CountFindings(rows), FindingsPath: findingsPath}
	fmt.Fprintf(streams.Out, "recapture: routes=%d flows=%d findings=%d findings_file=%s\n", len(plan.Routes), len(plan.Flows), result.Findings, findingsPath)
	return result, nil
}

// selectFlows keeps the run's own flows whose ids were asked for.
func selectFlows(flows []Flow, ids []string) []Flow {
	wanted := map[string]bool{}
	for _, id := range ids {
		wanted[id] = true
	}
	selected := []Flow{}
	for _, flow := range flows {
		if wanted[flow.ID] {
			selected = append(selected, flow)
		}
	}
	return selected
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
