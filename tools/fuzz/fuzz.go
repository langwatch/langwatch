// Package fuzz is a generic, non-AI, highly parallel fuzzer for the LangWatch
// API and UI. See README.md for the oracles and the UI protocol.
package fuzz

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
)

// Streams are the fuzzer's output sinks.
type Streams struct {
	Out io.Writer
	Err io.Writer
}

// Options is one fuzz run's configuration, parsed from the CLI.
type Options struct {
	Mode     string // api | ui | all
	Seed     int64
	Workers  int
	Duration time.Duration
	Only     string
	// ReloadEvery makes every Nth UI visit a full page load; the rest navigate in-app.
	ReloadEvery int
	// ActionsPerRoute is how many random actions a UI visit makes before moving on.
	ActionsPerRoute int
	URL             string // app origin; empty resolves the shared stack via haven
	// MaxConsecutiveErrors stops the run after this many harness errors in a row; 0 never, negative the mode's default.
	MaxConsecutiveErrors int
	Root                 string // repository root, for .fuzz output and the UI runner
}

// Main parses args and runs the fuzzer, returning a process exit code.
func Main(ctx context.Context, args []string, streams Streams, root string) int {
	if len(args) == 0 {
		fmt.Fprintln(streams.Err, "usage: fuzz api|ui|all [-seed N] [-workers N] [-duration D] [-only AREA] [-reload-every N] [-actions N] [-max-consecutive-errors N] [-url URL]")
		return 2
	}
	options := Options{Mode: args[0], Root: root}
	flags := flag.NewFlagSet("fuzz", flag.ContinueOnError)
	flags.SetOutput(streams.Err)
	flags.Int64Var(&options.Seed, "seed", 1, "deterministic seed")
	flags.IntVar(&options.Workers, "workers", 0, "worker count (default 64 api, 16 ui)")
	flags.DurationVar(&options.Duration, "duration", 2*time.Minute, "wall-clock budget")
	flags.StringVar(&options.Only, "only", "", "restrict to operations/routes whose path contains this")
	flags.IntVar(&options.ReloadEvery, "reload-every", DefaultReloadEvery, "ui: full page load every Nth visit, in-app navigation between (1 = always load)")
	flags.IntVar(&options.ActionsPerRoute, "actions", DefaultActionsPerRoute, "ui: random actions per visited route")
	flags.IntVar(&options.MaxConsecutiveErrors, "max-consecutive-errors", -1, "stop after this many harness errors in a row: api transport errors (default 200), ui visits that errored or stayed loading (default 10); 0 never stops")
	flags.StringVar(&options.URL, "url", "", "app origin; default is diffsuite's branch stack, else the shared stack")
	if err := flags.Parse(args[1:]); err != nil {
		return 2
	}
	switch options.Mode {
	case "api":
		return runOrReport(ctx, streams, options, runAPI)
	case "ui":
		return runOrReport(ctx, streams, options, runUI)
	case "all":
		if code := runOrReport(ctx, streams, options, runAPI); code != 0 {
			return code
		}
		return runOrReport(ctx, streams, options, runUI)
	default:
		fmt.Fprintf(streams.Err, "unknown mode %q; want api, ui or all\n", options.Mode)
		return 2
	}
}

func runOrReport(ctx context.Context, streams Streams, options Options, run func(context.Context, Streams, Options) error) int {
	err := run(ctx, streams, options)
	var stopped *diffkit.Stopped
	if errors.As(err, &stopped) {
		if stopped.Reason != "" {
			fmt.Fprintf(streams.Err, "fuzz %s: %s\n", options.Mode, stopped.Reason)
		}
		return diffkit.ExitStopped
	}
	if err != nil {
		fmt.Fprintf(streams.Err, "fuzz %s: %v\n", options.Mode, err)
		return 1
	}
	return 0
}

// errorLimit is the consecutive-error limit: the flag's, or the mode's default when unset.
func (options Options) errorLimit(fallback int) int {
	if options.MaxConsecutiveErrors < 0 {
		return fallback
	}
	return options.MaxConsecutiveErrors
}
