package herrgen

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// defaultOut is where the control plane reads the codes from.
const defaultOut = "packages/handled-error/src/codes.generated.ts"

// Run is the herrgen CLI: it parses the Go tree's herr codes and writes the
// TypeScript the control plane type-checks against. It returns the process exit
// code — 0 when the file is written (or already current under -check), 1 when
// -check finds it stale, 2 when the tree could not be read or two consts
// disagree on a status.
func Run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("herrgen", flag.ContinueOnError)
	flags.SetOutput(stderr)
	root := flags.String("root", ".", "repository root")
	out := flags.String("out", defaultOut, "generated file, relative to the root")
	check := flags.Bool("check", false, "fail instead of writing when the generated file is stale")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	entries, err := Parse(*root)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	generated := Render(entries)
	target := filepath.Join(*root, *out)

	if *check {
		onDisk, err := os.ReadFile(target)
		if err != nil {
			fmt.Fprintf(stderr, "%s cannot be read: %v\nRun `make herrgen` to generate it.\n", *out, err)
			return 1
		}
		if bytes.Equal(onDisk, generated) {
			fmt.Fprintf(stdout, "%s is up to date (%s).\n", *out, codeCount(len(entries)))
			return 0
		}
		fmt.Fprintf(stderr, "%s is stale — the Go error codes have moved on.\n\n", *out)
		fmt.Fprintf(stderr, "--- %s (on disk)\n+++ %s (generated)\n", *out, *out)
		for _, line := range Diff(string(onDisk), string(generated)) {
			fmt.Fprintln(stderr, line)
		}
		fmt.Fprintf(stderr, "\nRun `make herrgen` and commit the result.\n")
		return 1
	}

	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	if err := os.WriteFile(target, generated, 0o644); err != nil { //nolint:gosec // generated source, world-readable like the rest of the tree
		fmt.Fprintln(stderr, err)
		return 2
	}
	fmt.Fprintf(stdout, "Wrote %s to %s.\n", codeCount(len(entries)), *out)
	return 0
}

func codeCount(count int) string {
	if count == 1 {
		return "1 code"
	}
	return fmt.Sprintf("%d codes", count)
}
