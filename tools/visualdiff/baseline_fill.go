package visualdiff

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// fillBaseline renders on the live base only what a partial slot lacks, adds
// it to the slot, and returns the slot to replay. When it cannot, the edition
// captures the base live in full and caches nothing (a zero Baseline).
func (run *session) fillBaseline(ctx context.Context, edition Edition, baseline Baseline) Baseline {
	options, deps := run.request.Options, run.request.Deps
	config, _ := run.request.Done.Scope(run.request.Config, edition)
	plan := run.plan
	runnerPlan := RunnerPlan{
		Viewport: options.Viewport, Settle: config.Settle,
		Sides: []RunnerSide{{
			Name: "base", BaseURL: plan.Base.URL(), MailURL: plan.Base.MailURL(), Fixtures: run.sideFixtures[plan.Base.Name],
			StaticDir: run.staticDirs[plan.Base.Name],
		}},
		OutDir: filepath.Join(options.RunDir, "shots", string(edition), "base-fill"),
		Slug:   options.Identity.Slug, Routes: baseline.MissingRoutes, Flows: selectFlows(config.Flows, baseline.MissingFlows),
		Credential: options.Identity, FrozenTime: deps.Now().UnixMilli(), Fixtures: config.Fixtures,
		Concurrency: run.concurrency(config), Edition: edition, Stacks: run.editionStacks(),
	}
	fmt.Fprintf(run.streams.Err, "main: %s renders %d route(s) and %d flow(s) live to top up %s\n",
		edition, len(runnerPlan.Routes), len(runnerPlan.Flows), baseline.Dir)
	started := time.Now()
	stream, err := deps.Capture(ctx, runnerPlan, CaptureOptions{Root: options.Root, Stderr: run.streams.Err})
	run.phases.recordRunnerPhases(string(edition)+" main top-up", stream.Phases)
	run.phases.since(string(edition)+" main top-up", started)
	if err == nil {
		err = run.cacheRefusal(stream.Captures)
	}
	if err == nil {
		err = MergeBaseline(baseline, stream.Captures)
	}
	if err != nil {
		fmt.Fprintf(run.streams.Err, "main: %s not topped up, the base is captured live in full: %v\n", edition, err)
		return Baseline{}
	}
	baseline.Cached, baseline.MissingRoutes, baseline.MissingFlows = true, nil, nil
	return baseline
}

// MergeBaseline adds a top-up's base captures to a present slot: a screen the
// top-up took replaces the slot's, and the meta grows by what was filled.
func MergeBaseline(baseline Baseline, added []Capture) error {
	held, err := readBaselineCaptures(baseline.CapturesPath())
	if err != nil {
		return err
	}
	fresh := map[[2]string]bool{}
	for _, capture := range added {
		fresh[[2]string{capture.Kind, capture.Key}] = true
	}
	merged := make([]Capture, 0, len(held)+len(added))
	for _, capture := range held {
		if !fresh[[2]string{capture.Kind, capture.Key}] {
			merged = append(merged, capture)
		}
	}
	merged = append(merged, added...)
	meta := readBaselineMeta(baseline.Dir)
	meta.Routes = append(meta.Routes, baseline.MissingRoutes...)
	if meta.Flows == nil {
		meta.Flows = map[string]string{}
	}
	for _, id := range baseline.MissingFlows {
		meta.Flows[id] = baseline.Meta.Flows[id]
	}
	baseline.Meta = meta
	return SaveBaseline(baseline, merged)
}

// readBaselineCaptures reads a slot's captures as the base side's.
func readBaselineCaptures(path string) ([]Capture, error) {
	file, err := os.Open(path) // #nosec G304 -- the tool's own baseline cache.
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var captures []Capture
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 1<<20), 64<<20)
	for scanner.Scan() {
		var capture Capture
		if err := json.Unmarshal(scanner.Bytes(), &capture); err != nil {
			return nil, fmt.Errorf("baseline %s: %w", path, err)
		}
		capture.Side = "base"
		captures = append(captures, capture)
	}
	return captures, scanner.Err()
}
