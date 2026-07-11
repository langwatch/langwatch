// Command migrationorder reports migrations that sort at or before a migration
// already on the base branch.
//
// It is advisory: findings never fail the run, they are surfaced as a comment on
// the pull request. A non-zero exit means the check itself broke, not that the
// migrations are wrong.
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
	asJSON := flag.Bool("json", false, "emit findings as JSON on stdout")
	flag.Parse()

	findings, err := findings(*baseRef, *root)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	if *asJSON {
		if err := json.NewEncoder(os.Stdout).Encode(findings); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	if len(findings) == 0 {
		fmt.Printf("No migration ordering problems against %s\n", *baseRef)
		return
	}

	fmt.Printf("Migration ordering findings against %s:\n", *baseRef)
	for _, finding := range findings {
		fmt.Printf("- %s\n", finding)
	}
}

func findings(baseRef, root string) ([]string, error) {
	inputs, err := migrationorder.Repo{Root: root}.Inputs(baseRef)
	if err != nil {
		return nil, err
	}

	findings := []string{}
	for _, input := range inputs {
		findings = append(findings, migrationorder.Check(input)...)
	}
	return findings, nil
}
