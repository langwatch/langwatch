package visualdiff

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// RunLogFile is everything a run wrote to stderr, kept beside its report so
// a run that captured nothing still says why.
const RunLogFile = "run.log"

// openRunLog tees streams.Err into <run>/run.log and marks the run as live
// (gc.go). The returned function clears the mark and closes the log.
func openRunLog(options Options, streams *Streams) (func(), error) {
	if err := os.MkdirAll(options.RunDir, 0o750); err != nil {
		return func() {}, fmt.Errorf("run directory: %w", err)
	}
	logPath := filepath.Join(options.RunDir, RunLogFile)
	file, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600) // #nosec G304 -- this run's own log.
	if err != nil {
		return func() {}, fmt.Errorf("run log: %w", err)
	}
	streams.Err = io.MultiWriter(streams.Err, file)
	unmark, err := MarkRun(options.RunDir, options.Keep)
	if err != nil {
		_ = file.Close()
		return func() {}, fmt.Errorf("mark run: %w", err)
	}
	fmt.Fprintf(streams.Err, "run: %s (log %s)\n", options.RunDir, logPath)
	return func() {
		unmark()
		_ = file.Close()
	}, nil
}

// startRun opens the run log and collects what earlier runs left behind
// (not on a dry run), then warns about a dirty candidate. The returned
// function closes the log.
func startRun(ctx context.Context, request Request, streams *Streams) (func(), error) {
	options, deps := request.Options, request.Deps
	finish := func() {}
	if !options.DryRun {
		opened, err := openRunLog(options, streams)
		if err != nil {
			return finish, err
		}
		finish = opened
		err = CollectGarbage(ctx, GCRequest{
			Root: options.Root, Current: options.RunDir, UseHaven: options.UseHaven,
			Run: deps.Run, Environ: deps.Environ, Out: streams.Err,
		})
		if err != nil {
			fmt.Fprintln(streams.Err, err)
		}
	}
	warnDirtyCandidate(ctx, request, streams.Err)
	return finish, nil
}

// runCoverage is the run's coverage, or nil and a loud line when it cannot be read.
func runCoverage(ctx context.Context, request Request, stderr io.Writer) *Coverage {
	options := request.Options
	coverage, err := ResolveCoverage(ctx, coverageRequest{
		run: request.Deps.Run, root: options.Root, baseRef: options.BaseRef, candidateRef: options.CandidateRef, config: request.Config,
	})
	if err != nil {
		fmt.Fprintf(stderr, "coverage: unavailable, every declared route goes unchecked: %v\n", err)
		return nil
	}
	WriteCoverage(stderr, coverage)
	return &coverage
}

// warnDirtyCandidate says so when the candidate is HEAD and the tree has
// uncommitted changes: the candidate worktree renders the commit, not them.
func warnDirtyCandidate(ctx context.Context, request Request, stderr io.Writer) {
	options, deps := request.Options, request.Deps
	if options.CandidateRef != "HEAD" {
		return
	}
	var out bytes.Buffer
	spec := commandSpec{name: "git", args: []string{"status", "--porcelain", "--untracked-files=no"}, dir: options.Root}
	if err := deps.Run(ctx, spec, &out); err != nil {
		return
	}
	if changed := DirtyCount(out.String()); changed > 0 {
		fmt.Fprintf(stderr, "warning: the candidate is HEAD and %d tracked files have uncommitted changes; "+
			"the candidate worktree renders the last commit without them\n", changed)
	}
}

// DirtyCount counts `git status --porcelain` entries.
func DirtyCount(porcelain string) int {
	count := 0
	for _, line := range strings.Split(porcelain, "\n") {
		if strings.TrimSpace(line) != "" {
			count++
		}
	}
	return count
}

// appendUncovered records each uncovered route as a finding in findings.jsonl.
func appendUncovered(path string, uncovered []CoverageEntry, now time.Time) error {
	if len(uncovered) == 0 {
		return nil
	}
	writer, err := OpenFindingsFile(path)
	if err != nil {
		return err
	}
	defer writer.Close()
	for _, entry := range uncovered {
		finding := Finding{
			Route: entry.Pattern, Kind: ClassUncovered, Finding: true, CapturedAt: now.Format(time.RFC3339),
			Message: "declared by " + strings.Join(entry.Sources, "+") + ", neither rendered nor excluded in visualdiff.yaml",
		}
		if err := writer.WriteLine(finding); err != nil {
			return err
		}
	}
	return nil
}
