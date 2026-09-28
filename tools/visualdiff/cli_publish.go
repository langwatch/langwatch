package visualdiff

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// publishFlags is one parsed `visualdiff publish` command line.
type publishFlags struct {
	root         string
	runDir       string
	baseRef      string
	candidateRef string
	pr           string
	link         string
	config       *Config
}

// publishCommand shows a finished run's screens on a pull request after the
// run itself: CI runs with -no-publish, uploads the report, then publishes
// with the PR and the report's address. Exit 0 published, 1 skipped, 2 failed.
func publishCommand(ctx context.Context, args []string, streams Streams) int {
	parsed, err := parsePublishFlags(args, streams)
	if err != nil {
		if !errors.Is(err, errFlagsReported) {
			fmt.Fprintln(streams.Err, "visualdiff:", err)
		}
		return ExitOperational
	}
	rows, err := ReadReportRows(parsed.runDir)
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", err)
		return ExitOperational
	}
	url, err := Publish(ctx, PublishRequest{
		Run: execRunner, Root: parsed.root, RunDir: parsed.runDir, BaseRef: parsed.baseRef,
		CandidateRef: parsed.candidateRef, Rows: rows, Findings: CountFindings(rows),
		Config: parsed.config.Publish, Stderr: streams.Err, PR: parsed.pr, Link: parsed.link,
	})
	if err != nil {
		fmt.Fprintln(streams.Err, err)
		return ExitOperational
	}
	if url == "" {
		return ExitFindings
	}
	fmt.Fprintln(streams.Out, url)
	return ExitClean
}

func parsePublishFlags(args []string, streams Streams) (*publishFlags, error) {
	flags := flag.NewFlagSet("publish", flag.ContinueOnError)
	flags.SetOutput(streams.Err)
	root := flags.String("root", ".", "repository root")
	runDir := flags.String("run-dir", "", "the finished run's directory")
	baseRef := flags.String("base", "origin/main", "the run's base ref")
	candidateRef := flags.String("candidate", "HEAD", "the run's candidate ref")
	pr := flags.String("pr", "", "pull request number (default: the open PR of the checked-out branch)")
	link := flags.String("link", "", "address of the run's full report, shown in the comment")
	configPath := flags.String("config", "", "configuration file (default <root>/"+ConfigFile+")")
	if err := flags.Parse(args); err != nil {
		return nil, errFlagsReported
	}
	if *runDir == "" {
		return nil, errors.New("publish: -run-dir is required")
	}
	absoluteRoot, err := filepath.Abs(*root)
	if err != nil {
		return nil, err
	}
	absoluteRunDir, err := filepath.Abs(*runDir)
	if err != nil {
		return nil, err
	}
	path := *configPath
	if path == "" {
		path = filepath.Join(absoluteRoot, ConfigFile)
	}
	config, err := LoadConfig(path)
	if err != nil {
		return nil, err
	}
	return &publishFlags{
		root: absoluteRoot, runDir: absoluteRunDir, baseRef: *baseRef, candidateRef: *candidateRef,
		pr: *pr, link: *link, config: config,
	}, nil
}

// ReadReportRows reads back every edition's rows from the findings.json a run
// wrote under <run-dir>/report, editions in name order.
func ReadReportRows(runDir string) ([]Row, error) {
	paths, err := filepath.Glob(filepath.Join(runDir, "report", "*", "findings.json"))
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return nil, fmt.Errorf("publish: %s holds no report/<edition>/findings.json", runDir)
	}
	sort.Strings(paths)
	var rows []Row
	for _, path := range paths {
		encoded, err := os.ReadFile(path) // #nosec G304 -- a report this tool wrote under the named run directory.
		if err != nil {
			return nil, err
		}
		var document struct {
			Rows []Row `json:"rows"`
		}
		if err := json.Unmarshal(encoded, &document); err != nil {
			return nil, fmt.Errorf("publish: %s: %w", path, err)
		}
		rows = append(rows, document.Rows...)
	}
	return rows, nil
}
