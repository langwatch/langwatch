package fuzz

import (
	"bytes"
	"context"
	"os/exec"
	"strings"

	"github.com/langwatch/langwatch/tools/diffkit"
	"github.com/langwatch/langwatch/tools/havenrun"
)

// logSignatures reads the shared stack's api lane log and returns the count of
// each error/fatal signature, keyed and normalised the diffkit way. It is
// best-effort: without haven, or on any read error, it returns nil.
func logSignatures(ctx context.Context, slug string) map[string]int {
	if slug == "" || !havenrun.OnPath() {
		return nil
	}
	var out bytes.Buffer
	command := exec.CommandContext(ctx, havenrun.Command, havenrun.LogArgs(havenrun.BackendLane, slug)...) // #nosec G204 -- fixed haven log args.
	command.Stdout = &out
	if command.Run() != nil {
		return nil
	}
	counts := map[string]int{}
	for _, line := range strings.Split(out.String(), "\n") {
		level, message := diffkit.LogLevelMessage(line)
		if level != "error" && level != "fatal" {
			continue
		}
		counts[level+" :: "+diffkit.NormaliseSignature(message)]++
	}
	return counts
}

// newLogSignatures are the error/fatal signatures whose count rose during the
// run: the log-signature oracle. Deterministic given the two snapshots.
func newLogSignatures(before, after map[string]int) []Hit {
	hits := make([]Hit, 0)
	for signature, count := range after {
		if count > before[signature] {
			hits = append(hits, Hit{Oracle: "log-signature", Message: signature})
		}
	}
	return hits
}
