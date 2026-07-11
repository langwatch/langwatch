// Command migrationorder fails when a pull request adds a migration that sorts
// at or before a migration already on the base branch.
//
// Usage: migrationorder [baseRef] [repoRoot]
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/langwatch/langwatch/pkg/migrationorder"
)

func main() {
	baseRef := flag.String("base", "origin/main", "ref to check the migrations against")
	root := flag.String("root", ".", "repository root")
	flag.Parse()

	if err := run(*baseRef, *root); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(baseRef, root string) error {
	inputs, err := migrationorder.Repo{Root: root}.Inputs(baseRef)
	if err != nil {
		return err
	}

	var errs []string
	for _, input := range inputs {
		errs = append(errs, migrationorder.Check(input)...)
	}

	if len(errs) > 0 {
		fmt.Fprintf(os.Stderr, "Migration ordering check failed against %s:\n", baseRef)
		for _, err := range errs {
			fmt.Fprintf(os.Stderr, "- %s\n", err)
		}
		return fmt.Errorf("\nMigrations run in key order, so a migration that sorts before something already merged " +
			"would be skipped on any database that is already up to date. Rebase on the base branch and renumber your migrations.")
	}

	fmt.Printf("Migration ordering check passed against %s\n", baseRef)
	return nil
}
