package visualdiff

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// phaseClock keeps the wall time of each phase of a run, in the order they
// ended, and says each on the run log as it ends.
type phaseClock struct {
	mutex   sync.Mutex
	stderr  io.Writer
	entries []phaseEntry
}

type phaseEntry struct {
	name string
	took time.Duration
}

// since records a phase that started at started and ends now.
func (clock *phaseClock) since(name string, started time.Time) {
	clock.add(name, time.Since(started))
}

// add records a phase that took took.
func (clock *phaseClock) add(name string, took time.Duration) {
	if clock == nil {
		return
	}
	took = took.Round(100 * time.Millisecond)
	clock.mutex.Lock()
	defer clock.mutex.Unlock()
	clock.entries = append(clock.entries, phaseEntry{name: name, took: took})
	if clock.stderr != nil {
		fmt.Fprintf(clock.stderr, "phase: %s %s\n", name, took)
	}
}

// Table renders every phase one line each, for summary.txt.
func (clock *phaseClock) Table() string {
	clock.mutex.Lock()
	defer clock.mutex.Unlock()
	if len(clock.entries) == 0 {
		return ""
	}
	var out strings.Builder
	out.WriteString("\nphases (wall time)\n")
	for _, entry := range clock.entries {
		fmt.Fprintf(&out, "  %-34s %s\n", entry.name, entry.took)
	}
	return out.String()
}

// appendPhases adds the phase table to a written summary.txt.
func appendPhases(runDir string, clock *phaseClock) error {
	table := clock.Table()
	path := filepath.Join(runDir, SummaryFile)
	if table == "" || !fileExists(path) {
		return nil
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o600) // #nosec G304 -- this run's own summary.
	if err != nil {
		return err
	}
	if _, err := file.WriteString(table); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

// recordRunnerPhases records what the runner reported for one pass.
func (clock *phaseClock) recordRunnerPhases(prefix string, phases []RunnerPhase) {
	for _, phase := range phases {
		clock.add(fmt.Sprintf("%s %s %s", prefix, phase.Side, phase.Name), time.Duration(phase.Millis)*time.Millisecond)
	}
}

// prepareStepName names a prepare command's phase: the install, or the rest.
func prepareStepName(spec commandSpec) string {
	for _, arg := range spec.args {
		if arg == "install" {
			return "install"
		}
	}
	return "prepare"
}
