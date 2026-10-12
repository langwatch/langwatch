package visualdiff

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// OutcomeFile records what a run set out to capture and how it ended, so a
// merge (merge.go) can tell a finished shard from one that was cut short.
// It is written as the run starts and again as it finishes.
const OutcomeFile = "outcome.json"

// ExitCodeFile is where CI writes a run's exit status beside its report.
const ExitCodeFile = "exit_code"

// Outcome is outcome.json.
type Outcome struct {
	// RunDir is the run directory as the run saw it: its report's image paths start there.
	RunDir   string `json:"runDir"`
	Shard    string `json:"shard,omitempty"`
	Routes   int    `json:"routes"`
	Flows    int    `json:"flows"`
	Finished bool   `json:"finished"`
	// Partial says why the run captured less than it planned; empty when it did not.
	Partial  []string  `json:"partial,omitempty"`
	Coverage *Coverage `json:"coverage,omitempty"`
}

// plannedOutcome is the outcome a run records before it boots anything.
func plannedOutcome(plan Plan, shard Shard) Outcome {
	return Outcome{RunDir: absolute(plan.RunDir), Shard: shard.String(), Routes: plan.RouteCount, Flows: len(plan.FlowIDs)}
}

// finishedOutcome is the outcome a run records once its summary is written.
func finishedOutcome(plan Plan, shard Shard, result Result) Outcome {
	outcome := plannedOutcome(plan, shard)
	outcome.Finished, outcome.Partial, outcome.Coverage = true, nonEmpty(result.Partial), result.Coverage
	return outcome
}

// WriteOutcome writes outcome.json into the run directory.
func WriteOutcome(runDir string, outcome Outcome) error {
	if err := os.MkdirAll(runDir, 0o750); err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(outcome, "", " ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(runDir, OutcomeFile), encoded, 0o600)
}

// ReadOutcome reads a run directory's outcome.json; found is false when it has none.
func ReadOutcome(runDir string) (outcome Outcome, found bool, err error) {
	encoded, err := os.ReadFile(filepath.Join(runDir, OutcomeFile)) // #nosec G304 -- a file this tool wrote under the named run directory.
	if errors.Is(err, fs.ErrNotExist) {
		return Outcome{}, false, nil
	}
	if err != nil {
		return Outcome{}, false, err
	}
	if err := json.Unmarshal(encoded, &outcome); err != nil {
		return Outcome{}, false, fmt.Errorf("%s: %w", OutcomeFile, err)
	}
	return outcome, true, nil
}

func absolute(path string) string {
	if resolved, err := filepath.Abs(path); err == nil {
		return resolved
	}
	return path
}

func nonEmpty(values ...string) []string {
	var kept []string
	for _, value := range values {
		if value != "" {
			kept = append(kept, value)
		}
	}
	return kept
}
