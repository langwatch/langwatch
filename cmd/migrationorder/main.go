// Command migrationorder fails when a branch adds a migration numbered below one
// that is already on the base branch.
//
// Usage: migrationorder [-base origin/main] [-root .] [-json]
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/langwatch/langwatch/pkg/migrationorder"
)

func main() {
	baseRef := flag.String("base", "origin/main", "ref to check the migrations against")
	root := flag.String("root", ".", "repository root")
	asJSON := flag.Bool("json", false, "write the findings to stdout as JSON and always exit 0")
	flag.Parse()

	inputs, err := migrationorder.Repo{Root: *root}.Inputs(*baseRef)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}

	findings := []migrationorder.Finding{}
	for _, input := range inputs {
		findings = append(findings, migrationorder.Check(input)...)
	}

	if *asJSON {
		if err := json.NewEncoder(os.Stdout).Encode(findings); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		return
	}

	if len(findings) == 0 {
		fmt.Printf("Migrations are in order against %s.\n", *baseRef)
		return
	}

	fmt.Fprintf(os.Stderr, "Migrations are out of order against %s.\n", *baseRef)
	for _, finding := range findings {
		fmt.Fprintf(os.Stderr, "\n%s: %s %s\n", finding.Set, finding.Entry, finding.Problem)
		if finding.Fix != "" {
			fmt.Fprintf(os.Stderr, "  fix: %s\n", finding.Fix)
		}
	}
	os.Exit(1)
}
