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

	entries, nodeCodes, err := Parse(*root, stderr)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	// The repository has more than one go.mod, so -root can point somewhere
	// plausible that holds none of the services. Writing the empty artifact
	// there and exiting 0 is how a mistyped root deletes every code.
	if len(entries) == 0 {
		fmt.Fprintf(stderr,
			"no herr codes found under %s — is -root the repository root?\nIt must be the directory whose go.mod covers the Go services.\n",
			*root)
		return 2
	}
	generated := append(Render(entries), RenderNodeCodes(nodeCodes)...)
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

	// No MkdirAll: the destination is a package that already exists, so a path
	// that is not there is a wrong -out, and creating the tree would hide it.
	if err := writeAtomic(target, generated); err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	fmt.Fprintf(stdout, "Wrote %s to %s.\n", codeCount(len(entries)), *out)
	return 0
}

// writeAtomic replaces target in one step.
//
// os.WriteFile truncates first, so an interrupted run leaves a half-written
// generated file behind — which then fails the TypeScript build for a reason
// that has nothing to do with error codes. The temp file is written alongside
// the target so the rename stays on one filesystem.
func writeAtomic(target string, data []byte) error {
	temp, err := os.CreateTemp(filepath.Dir(target), "."+filepath.Base(target)+".*")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer func() { _ = os.Remove(name) }()

	if _, err := temp.Write(data); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	// CreateTemp opens at 0600; the artifact is generated source, world-readable
	// like the rest of the tree.
	if err := os.Chmod(name, 0o644); err != nil { //nolint:gosec // generated source
		return err
	}
	return os.Rename(name, target)
}

func codeCount(count int) string {
	if count == 1 {
		return "1 code"
	}
	return fmt.Sprintf("%d codes", count)
}
