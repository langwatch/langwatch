package importext

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Streams are the CLI's output sinks.
type Streams struct {
	Out io.Writer
	Err io.Writer
}

// Options is one parsed importext command line.
type Options struct {
	Roots      []string
	Root       string
	DryRun     bool
	OnlyClean  bool
	ReportPath string
}

const usage = `importext — rewrite relative import specifiers to name the file on disk

  importext -roots apps/api,packages [-dry-run] [-only-clean=false]
            [-report FILE] [-root DIR]
`

// Run is the importext CLI. It returns the process exit code.
func Run(args []string, streams Streams) int {
	options, err := parseFlags(args, streams.Err)
	if err != nil {
		return 2
	}
	report, err := Execute(options)
	if err != nil {
		fmt.Fprintln(streams.Err, "importext:", err)
		return 2
	}
	printSummary(streams.Out, report)
	if options.ReportPath != "" {
		if err := writeReport(options.ReportPath, report); err != nil {
			fmt.Fprintln(streams.Err, "importext:", err)
			return 2
		}
	}
	return 0
}

func parseFlags(args []string, errOut io.Writer) (Options, error) {
	options := Options{}
	roots := ""
	set := flag.NewFlagSet("importext", flag.ContinueOnError)
	set.SetOutput(errOut)
	set.Usage = func() { fmt.Fprint(errOut, usage) }
	set.StringVar(&roots, "roots", "", "comma separated list of directories to walk")
	set.StringVar(&options.Root, "root", ".", "repository root the roots are relative to")
	set.BoolVar(&options.DryRun, "dry-run", false, "print the plan and write nothing")
	set.BoolVar(&options.OnlyClean, "only-clean", true, "skip files git reports as dirty")
	set.StringVar(&options.ReportPath, "report", "", "write the JSON report to this file")
	if err := set.Parse(args); err != nil {
		return options, err
	}
	for _, root := range strings.Split(roots, ",") {
		if trimmed := strings.TrimSpace(root); trimmed != "" {
			options.Roots = append(options.Roots, trimmed)
		}
	}
	if len(options.Roots) == 0 {
		fmt.Fprint(errOut, usage)
		return options, flag.ErrHelp
	}
	return options, nil
}

func printSummary(out io.Writer, report *Report) {
	mode := "applied"
	if report.DryRun {
		mode = "dry run"
	}
	fmt.Fprintf(out, "importext (%s)\n", mode)
	fmt.Fprintf(out, "  files scanned:        %d\n", report.FilesScanned)
	fmt.Fprintf(out, "  files rewritten:      %d\n", report.FilesRewritten)
	fmt.Fprintf(out, "  specifiers rewritten: %d\n", report.SpecifiersRewritten)
	fmt.Fprintf(out, "  skipped dirty:        %d\n", len(report.SkippedDirty))
	fmt.Fprintf(out, "  unresolved:           %d\n", len(report.Unresolved))
	fmt.Fprintf(out, "  json imports:         %d\n", len(report.JSONImports))
	fmt.Fprintf(out, "  alias imports:        %d\n", len(report.AliasImports))
}

func writeReport(path string, report *Report) error {
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if directory := filepath.Dir(path); directory != "" {
		if err := os.MkdirAll(directory, 0o750); err != nil {
			return err
		}
	}
	return os.WriteFile(path, append(encoded, '\n'), 0o600)
}
