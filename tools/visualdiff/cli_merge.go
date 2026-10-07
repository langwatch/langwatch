package visualdiff

import (
	"errors"
	"flag"
	"fmt"
	"path/filepath"
)

// mergeCommand combines a sharded run's shards into one run directory, which
// publish then shows on the pull request. Exit 0 no findings, 1 findings, 2
// a shard broke or none left a report.
func mergeCommand(args []string, streams Streams) int {
	flags := flag.NewFlagSet("merge", flag.ContinueOnError)
	flags.SetOutput(streams.Err)
	runDir := flags.String("run-dir", "", "the merged run's directory; the shards are under <run-dir>/"+ShardsDir+"/<name>")
	shards := flags.Int("shards", 0, "how many shards the run was split into; fewer found marks the merge partial")
	baseRef := flags.String("base", "origin/main", "the run's base ref")
	candidateRef := flags.String("candidate", "HEAD", "the run's candidate ref")
	if err := flags.Parse(args); err != nil {
		return ExitOperational
	}
	if *runDir == "" {
		fmt.Fprintln(streams.Err, "visualdiff:", errors.New("merge: -run-dir is required"))
		return ExitOperational
	}
	absoluteRunDir, err := filepath.Abs(*runDir)
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", err)
		return ExitOperational
	}
	result, err := Merge(MergeRequest{RunDir: absoluteRunDir, Shards: *shards, BaseRef: *baseRef, CandidateRef: *candidateRef})
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff: merge:", err)
		return ExitOperational
	}
	for _, reason := range result.Broken {
		fmt.Fprintln(streams.Err, "merge:", reason)
	}
	fmt.Fprintf(streams.Out, "merged %d rows, %d findings, %d partial reasons\n", len(result.Rows), result.Findings, len(result.Partial))
	return result.ExitCode()
}
