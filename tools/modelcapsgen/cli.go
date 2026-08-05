package modelcapsgen

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Run is the modelcapsgen CLI: it reads the model registry's endpoint-scoped
// reasoning capabilities and writes the Go table nlpgo enforces at dispatch.
// It returns the process exit code — 0 when the file is written (or already
// current under -check), 1 when -check finds it stale, 2 when the registry
// could not be read or holds a contradictory declaration.
func Run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("modelcapsgen", flag.ContinueOnError)
	flags.SetOutput(stderr)
	root := flags.String("root", ".", "repository root")
	registry := flags.String("registry", DefaultRegistry, "model registry, relative to the root")
	out := flags.String("out", DefaultOut, "generated file, relative to the root")
	check := flags.Bool("check", false, "fail instead of writing when the generated file is stale")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	capabilities, err := ReadCapabilities(filepath.Join(*root, *registry))
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	generated, err := Render(capabilities)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	target := filepath.Join(*root, *out)

	if *check {
		return runCheck(stdout, stderr, checkTarget{
			path:      target,
			name:      *out,
			generated: generated,
			count:     len(capabilities),
		})
	}

	// No MkdirAll: the destination is a package that already exists, so a
	// path that is not there is a wrong -out, and creating the tree would
	// hide it.
	if err := writeAtomic(target, generated); err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	fmt.Fprintf(stdout, "Wrote %s to %s.\n", countCapabilities(len(capabilities)), *out)
	return 0
}

// checkTarget is what the drift check compares: the file on disk at path
// (called name in messages, since that is the repo-relative spelling a
// reader recognizes) against the bytes just generated.
type checkTarget struct {
	path      string
	name      string
	generated []byte
	count     int
}

func runCheck(stdout, stderr io.Writer, target checkTarget) int {
	onDisk, err := os.ReadFile(target.path)
	if err != nil {
		fmt.Fprintf(stderr, "%s cannot be read: %v\nRun `make modelcapsgen` to generate it.\n", target.name, err)
		return 1
	}
	if bytes.Equal(onDisk, target.generated) {
		fmt.Fprintf(stdout, "%s is up to date (%s).\n", target.name, countCapabilities(target.count))
		return 0
	}
	fmt.Fprintf(stderr, "%s is stale — the model registry's reasoning capabilities have moved on.\n", target.name)
	fmt.Fprintf(stderr, "Run `make modelcapsgen` and commit the result.\n")
	return 1
}

// writeAtomic replaces target in one step. os.WriteFile truncates first, so
// an interrupted run leaves a half-written generated file behind — which
// then fails the Go build for a reason that has nothing to do with model
// capabilities. The temp file is written alongside the target so the rename
// stays on one filesystem.
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
	// CreateTemp opens at 0600; the artifact is generated source,
	// world-readable like the rest of the tree.
	if err := os.Chmod(name, 0o644); err != nil { //nolint:gosec // generated source
		return err
	}
	return os.Rename(name, target)
}

func countCapabilities(count int) string {
	if count == 1 {
		return "1 model capability"
	}
	return fmt.Sprintf("%d model capabilities", count)
}
