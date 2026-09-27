package visualdiff

import (
	"context"
	"flag"
	"fmt"
	"path/filepath"
)

// coverageCommand prints the coverage verdict between two refs and exits 1
// when any declared route is uncovered.
func coverageCommand(ctx context.Context, args []string, streams Streams) int {
	flags := flag.NewFlagSet("coverage", flag.ContinueOnError)
	flags.SetOutput(streams.Err)
	baseRef := flags.String("base", "origin/main", "ref whose pages are the parity target")
	candidateRef := flags.String("candidate", "HEAD", "ref whose screen declarations are checked")
	root := flags.String("root", ".", "repository root")
	configPath := flags.String("config", "", "configuration file (default <root>/"+ConfigFile+")")
	if err := flags.Parse(args); err != nil {
		return ExitOperational
	}
	absoluteRoot, err := filepath.Abs(*root)
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", err)
		return ExitOperational
	}
	path := *configPath
	if path == "" {
		path = filepath.Join(absoluteRoot, ConfigFile)
	}
	config, err := LoadConfig(path)
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", err)
		return ExitOperational
	}
	coverage, err := ResolveCoverage(ctx, coverageRequest{
		run: execRunner, root: absoluteRoot, baseRef: *baseRef, candidateRef: *candidateRef, config: config,
	})
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff: coverage:", err)
		return ExitOperational
	}
	WriteCoverage(streams.Out, coverage)
	if len(coverage.Uncovered()) > 0 {
		return ExitFindings
	}
	return ExitClean
}

// gcCommand removes what dead runs left behind.
func gcCommand(ctx context.Context, args []string, streams Streams) int {
	flags := flag.NewFlagSet("gc", flag.ContinueOnError)
	flags.SetOutput(streams.Err)
	root := flags.String("root", ".", "repository root")
	kept := flags.Bool("kept", false, "also remove -keep runs and their running stacks")
	noHaven := flags.Bool("no-haven", false, "leave haven stacks alone")
	if err := flags.Parse(args); err != nil {
		return ExitOperational
	}
	absoluteRoot, err := filepath.Abs(*root)
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", err)
		return ExitOperational
	}
	err = CollectGarbage(ctx, GCRequest{
		Root: absoluteRoot, IncludeKept: *kept, UseHaven: havenSelected(havenOnPath(), *noHaven), Out: streams.Out,
	})
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", err)
		return ExitOperational
	}
	return ExitClean
}
