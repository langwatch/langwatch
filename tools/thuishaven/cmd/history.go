package cmd

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/fileregistry"
)

// `haven machine history add` records Nx task rows that dev/nx/haven-plugin.mjs
// pipes in after a run, into nx-history.jsonl in haven's home. That file is
// apart from run-history.jsonl, so no wait estimate reads Nx rows
// (specs/setup/haven-nx.feature).

// nxTaskRow is one Nx task as the plugin writes it.
type nxTaskRow struct {
	Kind       string    `json:"kind"`
	Project    string    `json:"project"`
	Target     string    `json:"target"`
	Status     string    `json:"status"`
	ExitCode   int       `json:"exitCode"`
	StartedAt  time.Time `json:"startedAt"`
	DurationMs int64     `json:"durationMs"`
	CacheHit   bool      `json:"cacheHit"`
	RunID      string    `json:"runId"`
	Worktree   string    `json:"worktree"`
}

func runHistory(_ context.Context, _ deps, inv invocation) error {
	if len(inv.args) != 1 || inv.args[0] != "add" {
		return errors.New("usage: haven machine history add < rows.jsonl (one Nx task row per line)")
	}
	rows, err := readNxTaskRows(os.Stdin)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	return fileregistry.New(havenHome()).AppendNxHistory(rows)
}

// readNxTaskRows checks every line is a task row with a project and target,
// and returns each re-encoded on one line. One bad line refuses the batch.
func readNxTaskRows(r io.Reader) ([]string, error) {
	var out []string
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for n := 1; scanner.Scan(); n++ {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var row nxTaskRow
		if err := json.Unmarshal(line, &row); err != nil {
			return nil, fmt.Errorf("history add: line %d is not a task row: %w", n, err)
		}
		if row.Project == "" || row.Target == "" {
			return nil, fmt.Errorf("history add: line %d has no project or target", n)
		}
		b, err := json.Marshal(row)
		if err != nil {
			return nil, err
		}
		out = append(out, string(b))
	}
	return out, scanner.Err()
}
