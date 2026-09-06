package docscheck

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"

	"github.com/langwatch/langwatch/pkg/docsscan"
)

// Run is the docscheck CLI. It returns the process exit code — 0 when the docs
// site is structurally sound, 1 when it is not, 2 when the inputs could not be
// read.
func Run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("docscheck", flag.ContinueOnError)
	flags.SetOutput(stderr)
	root := flags.String("root", ".", "repository root")
	docsDir := flags.String("docs", "docs", "docs site directory, relative to root")
	chart := flags.String(
		"chart",
		"charts/langwatch/Chart.yaml",
		"chart whose appVersion the docs should name, relative to root",
	)
	asJSON := flags.Bool("json", false, "write the findings to stdout as JSON and always exit 0")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	inputs, err := Load(*root, *docsDir, *chart)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}

	// Non-nil so -json renders no findings as [] rather than null.
	findings := docsscan.Check(inputs)
	if findings == nil {
		findings = []docsscan.Finding{}
	}

	if *asJSON {
		if err := json.NewEncoder(stdout).Encode(findings); err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
		return 0
	}

	if len(findings) == 0 {
		fmt.Fprintf(
			stdout,
			"%s is sound: %d pages, %d navigation entries, %d redirects, release %s.\n",
			*docsDir,
			len(inputs.ContentPages),
			len(inputs.NavPages),
			len(inputs.Redirects),
			inputs.ChartVersion,
		)
		return 0
	}

	noun := "problems"
	if len(findings) == 1 {
		noun = "problem"
	}
	fmt.Fprintf(stderr, "%s has %d %s.\n", *docsDir, len(findings), noun)
	for _, finding := range findings {
		fmt.Fprintf(stderr, "\n%s: %s\n  %s\n", finding.Kind, finding.Where, finding.Problem)
		fmt.Fprintf(stderr, "  fix: %s\n", finding.Fix)
	}
	return 1
}
