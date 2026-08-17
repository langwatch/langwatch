package ingestionbench

// The run's outputs: results.json, samples.json, summary.md, and the GitHub job
// summary.

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// writeArtifacts writes results.json, samples.json, and summary.md, and
// appends the summary to the GitHub job summary when running in Actions.
//
// results.json is the baseline the NEXT run compares against, so it is written
// even when the run failed — a failed run's numbers are still the most recent
// reading at this scale on this runner.
func writeArtifacts(args RunArgs, plan BenchmarkPlan, results []StageResult) error {
	if err := writeJSONFile(filepath.Join(args.Out, "results.json"), map[string]any{
		"plan":    plan,
		"results": results,
	}); err != nil {
		return err
	}

	if err := writeJSONFile(filepath.Join(args.Out, "samples.json"), stampedSamples(results)); err != nil {
		return err
	}

	summary := RenderJobSummary(RenderJobSummaryOptions{
		Results:               results,
		Scale:                 plan.Scale,
		ProjectedPayloadBytes: int64(plan.ProjectedPayloadBytes),
		RunnerLabel:           args.RunnerLabel,
	})
	if err := os.WriteFile(filepath.Join(args.Out, "summary.md"), []byte(summary), artifactFileMode); err != nil {
		return err
	}

	return appendJobSummary(summary)
}

// artifactFileMode is world-readable on purpose: these are CI artifacts, meant
// to be collected by the runner and attached to the job.
const artifactFileMode = 0o644

// writeJSONFile writes value as indented JSON.
func writeJSONFile(path string, value any) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, payload, artifactFileMode)
}

// stampedSample is a resource sample tagged with the stage it was taken during,
// since samples.json is flat and a sample means little without its stage.
type stampedSample struct {
	Stage StageName `json:"stage"`
	ResourceSample
}

// stampedSamples flattens every stage's samples into one stamped list.
func stampedSamples(results []StageResult) []stampedSample {
	var flattened []stampedSample
	for _, result := range results {
		for _, sample := range result.Samples {
			flattened = append(flattened, stampedSample{Stage: result.Stage, ResourceSample: sample})
		}
	}
	return flattened
}

// appendJobSummary appends the summary to the GitHub job summary, when running
// somewhere that has one.
//
// The close error is returned rather than deferred away. This handle is open
// for writing, so a failure to flush would otherwise be reported as a
// successful run that quietly published a truncated summary.
func appendJobSummary(summary string) (err error) {
	path := os.Getenv("GITHUB_STEP_SUMMARY")
	if path == "" {
		return nil
	}

	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, artifactFileMode)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil && err == nil {
			err = closeErr
		}
	}()

	_, err = file.WriteString(summary)
	return err
}
