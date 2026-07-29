package migrationorder

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
)

// Run is the migrationorder CLI: it checks every migration set against the
// base ref and renders the findings. It returns the process exit code — 0 when
// the migrations are in order, 1 when they are not, 2 when the repository
// could not be read.
func Run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("migrationorder", flag.ContinueOnError)
	flags.SetOutput(stderr)
	baseRef := flags.String("base", "origin/main", "ref to check the migrations against")
	root := flags.String("root", ".", "repository root")
	asJSON := flags.Bool("json", false, "write the findings to stdout as JSON and always exit 0")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	inputs, err := Repo{Root: *root}.Inputs(context.Background(), *baseRef)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}

	// Non-nil so -json renders no findings as [] rather than null; the workflow
	// script indexes findings.length.
	findings := []Finding{}
	for i := range inputs {
		findings = append(findings, Check(inputs[i])...)
	}

	if *asJSON {
		if err := json.NewEncoder(stdout).Encode(findings); err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
		return 0
	}

	if len(findings) == 0 {
		fmt.Fprintf(stdout, "Migrations are in order against %s.\n", *baseRef)
		return 0
	}

	fmt.Fprintf(stderr, "Migrations are out of order against %s.\n", *baseRef)
	for _, finding := range findings {
		fmt.Fprintf(stderr, "\n%s: %s %s\n", finding.Set, finding.Entry, finding.Problem)
		if finding.Fix != "" {
			fmt.Fprintf(stderr, "  fix: %s\n", finding.Fix)
		}
	}
	return 1
}
