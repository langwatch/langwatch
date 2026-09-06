package herrgen

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
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
	// there and exiting 0 is how a mistyped root deletes every code — and the
	// artifact has two halves, so guarding only the Go one let a run that found
	// no node codes write `nodeErrorCodes = {}` and exit 0. The drift check
	// would then demand the emptied file be committed.
	if empty := emptyHalves(entries, nodeCodes); empty != "" {
		fmt.Fprintf(stderr,
			"no %s found under %s — is -root the repository root?\nIt must be the directory whose go.mod covers the Go services.\n",
			empty, *root)
		return 2
	}
	// Both halves land in one file and the client presentation registry is
	// keyed by the code string alone, so a string declared on both sides is one
	// error identity with one entry. It used to render twice, with two doc
	// blocks and a warning per code on every run; MergeNodeCodes folds it into
	// the Go half instead, which is what the registry's union type was already
	// doing. The shared codes are still reported, as information rather than a
	// complaint — a code appearing on both transports is worth knowing about
	// when you go to write its copy.
	if shared := sharedCodes(entries, nodeCodes); len(shared) > 0 {
		fmt.Fprintf(stderr,
			"note: %s declared as both a herr code and a NodeError type; each renders once, in goErrorCodes, with its node sites listed.\n",
			strings.Join(shared, ", "))
	}
	entries, nodeCodes = MergeNodeCodes(entries, nodeCodes)
	generated := append(Render(entries), RenderNodeCodes(nodeCodes)...)
	target := filepath.Join(*root, *out)

	if *check {
		onDisk, err := os.ReadFile(target)
		if err != nil {
			fmt.Fprintf(stderr, "%s cannot be read: %v\nRun `make herrgen` to generate it.\n", *out, err)
			return 1
		}
		if bytes.Equal(onDisk, generated) {
			fmt.Fprintf(stdout, "%s is up to date (%s).\n", *out, codeCounts(len(entries), len(nodeCodes)))
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
	fmt.Fprintf(stdout, "Wrote %s to %s.\n", codeCounts(len(entries), len(nodeCodes)), *out)
	return 0
}

// emptyHalves names the half (or halves) of the artifact that came back empty,
// or "" when both hold something. Either one being empty is the same mistake
// with the same consequence: a generated file that silently drops live codes.
func emptyHalves(entries []Entry, nodeCodes []NodeCode) string {
	switch {
	case len(entries) == 0 && len(nodeCodes) == 0:
		return "herr codes or workflow node codes"
	case len(entries) == 0:
		return "herr codes"
	case len(nodeCodes) == 0:
		return "workflow node codes"
	}
	return ""
}

// sharedCodes lists, sorted, every string declared as both a herr code and a
// workflow NodeError type.
func sharedCodes(entries []Entry, nodeCodes []NodeCode) []string {
	goCodes := make(map[string]bool, len(entries))
	for _, entry := range entries {
		goCodes[entry.Code] = true
	}
	var shared []string
	for _, node := range nodeCodes {
		if goCodes[node.Code] {
			shared = append(shared, node.Code)
		}
	}
	slices.Sort(shared)
	return slices.Compact(shared)
}

// MergeNodeCodes folds the codes declared on BOTH sides into the Go half and
// drops them from the node half, returning both lists.
//
// A handful of engine failures are declared twice: `invalid_dataset` is a
// `herr.Code` in nlpgo's domain package AND a `NodeError.Type` in its engine,
// because the same failure travels as an HTTP error response on one path and as
// a node error event on the other. That is one error identity, not two, which
// is why the presentation registry has always had a single entry for it — the
// registry is keyed by the code string and its type is a UNION of the two
// halves, so a duplicate key collapses.
//
// It just did not collapse in the generated file, where the string appeared in
// both objects with two unrelated doc blocks and a warning on every run telling
// the reader that this was nobody's intention. Folding is the honest version of
// what the type system was already doing. Nothing is lost: the surviving entry
// is the richer one (a real Go doc comment, and an HTTP status), and the node
// sites it also occupies are carried across as NodeSources so the generated
// file still names every file the code is written in.
func MergeNodeCodes(entries []Entry, nodeCodes []NodeCode) ([]Entry, []NodeCode) {
	byCode := make(map[string][]string, len(nodeCodes))
	for _, node := range nodeCodes {
		byCode[node.Code] = node.Sources
	}

	merged := make([]Entry, 0, len(entries))
	for _, entry := range entries {
		if sources, ok := byCode[entry.Code]; ok {
			entry.NodeSources = sources
		}
		merged = append(merged, entry)
	}

	goCodes := make(map[string]bool, len(entries))
	for _, entry := range entries {
		goCodes[entry.Code] = true
	}
	remaining := make([]NodeCode, 0, len(nodeCodes))
	for _, node := range nodeCodes {
		if !goCodes[node.Code] {
			remaining = append(remaining, node)
		}
	}
	return merged, remaining
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

// codeCounts reports both halves of the artifact. Counting only the Go entries
// understated what was written by however many node codes the same file
// carries, which reads as a generator that lost some.
func codeCounts(entries, nodeCodes int) string {
	return fmt.Sprintf("%s and %s", plural(entries, "service code"), plural(nodeCodes, "node code"))
}

func plural(count int, noun string) string {
	if count == 1 {
		return "1 " + noun
	}
	return fmt.Sprintf("%d %ss", count, noun)
}
