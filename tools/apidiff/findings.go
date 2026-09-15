package apidiff

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// StreamSurface names which API surface a streamed finding describes. REST is
// the only surface apidiff probes today; trpc is reserved for when the
// procedure-manifest seam closes (see README, "Not covered").
type StreamSurface string

// Findings stream surfaces.
const (
	StreamSurfaceREST StreamSurface = "rest"
	StreamSurfaceTRPC StreamSurface = "trpc"
)

// StreamKind classifies one operation's comparison outcome for the findings
// stream — a small, reader-facing taxonomy, coarser than the ledger's own
// classification enum (see ledger.go).
type StreamKind string

// Findings stream kinds.
const (
	StreamAbsentOnBranch StreamKind = "absent-on-branch"
	StreamStatusDiffers  StreamKind = "status-differs"
	StreamShapeDiffers   StreamKind = "shape-differs"
	StreamIdentical      StreamKind = "identical"
	StreamProbeFailed    StreamKind = "probe-failed"
)

// StreamEntry is one line of the findings stream: one operation's comparison
// outcome, written as it completes rather than batched at the end.
type StreamEntry struct {
	Surface    StreamSurface `json:"surface"`
	Name       string        `json:"name"`
	Kind       StreamKind    `json:"kind"`
	Module     string        `json:"module"`
	Detail     string        `json:"detail"`
	CapturedAt string        `json:"capturedAt"`
}

// runComplete is the findings stream's closing line: totals by kind.
type runComplete struct {
	Kind   string         `json:"kind"`
	Counts map[string]int `json:"counts"`
}

// FindingsStream appends one JSON line per entry to a writer — a real file
// under .apidiff/<runID>/findings.jsonl in production, an in-memory buffer in
// tests. Every Append is its own Write with nothing buffered across entries,
// so a reader tailing the file sees each one as it lands; a writer that can
// Sync (a real file) is synced too, so a line survives a crash before the
// next one.
type FindingsStream struct {
	w      io.Writer
	counts map[string]int
}

// NewFindingsStream opens (creating if needed) <runDir>/findings.jsonl for
// append and returns the stream plus its own close func.
func NewFindingsStream(runDir string) (*FindingsStream, func() error, error) {
	// #nosec G304 -- path is built from the run directory this tool created.
	file, err := os.OpenFile(filepath.Join(runDir, "findings.jsonl"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, nil, err
	}
	return newFindingsStream(file), file.Close, nil
}

// newFindingsStream wraps any writer — tests use an in-memory one — so the
// stream's shape is independent of its destination.
func newFindingsStream(w io.Writer) *FindingsStream {
	return &FindingsStream{w: w, counts: map[string]int{}}
}

// Append writes one entry as its own JSON line and flushes it (Sync, for a
// real file) before returning.
func (stream *FindingsStream) Append(entry StreamEntry) error {
	if entry.CapturedAt == "" {
		entry.CapturedAt = time.Now().UTC().Format(time.RFC3339)
	}
	stream.counts[string(entry.Kind)]++
	return stream.writeLine(entry)
}

// Close writes the run-complete line with the totals by kind.
func (stream *FindingsStream) Close() error {
	return stream.writeLine(runComplete{Kind: "run-complete", Counts: stream.counts})
}

func (stream *FindingsStream) writeLine(value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err := stream.w.Write(append(encoded, '\n')); err != nil {
		return err
	}
	if syncer, ok := stream.w.(interface{ Sync() error }); ok {
		return syncer.Sync()
	}
	return nil
}

// classifyOperation reduces one operation's probe outcome to the findings
// stream's small taxonomy plus a one-line detail. Missing-on-branch and probe
// failures win over a mere status or shape difference, since they say more
// about what could not be compared at all.
func classifyOperation(operation Operation, findings []Finding) (StreamKind, string) {
	if !operation.InA {
		return StreamAbsentOnBranch, "present on base only"
	}
	if finding, ok := firstOfKind(findings, FindingProbeFailed, FindingSkipped); ok {
		return StreamProbeFailed, detailFor(finding)
	}
	if finding, ok := firstOfKind(findings, FindingOperationMissing); ok {
		return StreamAbsentOnBranch, detailFor(finding)
	}
	if finding, ok := firstOfKind(findings, FindingStatusDiff); ok {
		return StreamStatusDiffers, detailFor(finding)
	}
	if len(findings) == 0 {
		return StreamIdentical, ""
	}
	return StreamShapeDiffers, detailFor(findings[0])
}

// firstOfKind returns the first finding whose Kind is one of kinds.
func firstOfKind(findings []Finding, kinds ...string) (Finding, bool) {
	for _, finding := range findings {
		for _, kind := range kinds {
			if finding.Kind == kind {
				return finding, true
			}
		}
	}
	return Finding{}, false
}

// detailFor renders one finding as the one line the stream carries: the
// reason it was not compared, the status pair, or the changed field pointers.
func detailFor(finding Finding) string {
	if finding.Reason != "" {
		return finding.Reason
	}
	if status, ok := finding.Fields["status"]; ok {
		return fmt.Sprintf("status %v -> %v", status[0], status[1])
	}
	if len(finding.Fields) == 0 {
		return finding.Kind
	}
	pointers := make([]string, 0, len(finding.Fields))
	for pointer := range finding.Fields {
		pointers = append(pointers, pointer)
	}
	sort.Strings(pointers)
	return strings.Join(pointers, ", ")
}

// findingsHook adapts a FindingsStream into the callback ProbeAll fires as
// each operation's comparison completes. Returns nil when stream is nil (the
// plain `probe` subcommand has no run directory to stream into), which
// ProbeOptions treats as no hook at all.
func findingsHook(stream *FindingsStream, repoRoot string, stderr io.Writer) func(Operation, []Finding) {
	if stream == nil {
		return nil
	}
	return func(operation Operation, findings []Finding) {
		kind, detail := classifyOperation(operation, findings)
		entry := StreamEntry{
			Surface: StreamSurfaceREST,
			Name:    operation.Method + " " + operation.Path,
			Kind:    kind,
			Module:  ModuleForPath(repoRoot, operation.Path),
			Detail:  detail,
		}
		if err := stream.Append(entry); err != nil {
			fmt.Fprintf(stderr, "findings stream: %v\n", err)
		}
	}
}

// ModuleForPath is a best-effort mapping from a REST path to the module that
// owns it: the first non-version, non-parameter path segment, matched (exact,
// or with a trailing "s" added or removed) against a directory name under
// modules/. Empty when nothing matches or repoRoot has no modules/ directory
// at all — most of the surface predates the module layout, so that is the
// common case, not a failure.
func ModuleForPath(repoRoot, path string) string {
	modules := moduleDirNames(repoRoot)
	if len(modules) == 0 {
		return ""
	}
	for _, segment := range pathSegments(path) {
		if name, ok := matchModule(segment, modules); ok {
			return name
		}
	}
	return ""
}

func pathSegments(path string) []string {
	trimmed := strings.Trim(path, "/")
	if trimmed == "" {
		return nil
	}
	var out []string
	for _, segment := range strings.Split(trimmed, "/") {
		switch {
		case segment == "api":
		case len(segment) >= 2 && segment[0] == 'v' && allDigits(segment[1:]):
		case strings.HasPrefix(segment, "{"):
		default:
			out = append(out, segment)
		}
	}
	return out
}

func matchModule(segment string, modules map[string]bool) (string, bool) {
	for _, candidate := range []string{segment, strings.TrimSuffix(segment, "s"), segment + "s"} {
		if modules[candidate] {
			return candidate, true
		}
	}
	return "", false
}

func moduleDirNames(repoRoot string) map[string]bool {
	if repoRoot == "" {
		return nil
	}
	entries, err := os.ReadDir(filepath.Join(repoRoot, "modules"))
	if err != nil {
		return nil
	}
	names := map[string]bool{}
	for _, entry := range entries {
		if entry.IsDir() {
			names[entry.Name()] = true
		}
	}
	return names
}
