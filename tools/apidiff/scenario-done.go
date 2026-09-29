package apidiff

import (
	"bufio"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// scenarioDoneDir holds the done ledger, shaped like visualdiff's: one
// meta.json per signed-off scenario with its proof. A run skips every
// scenario it holds unless -final is given.
const (
	scenarioDoneDir  = "done"
	scenarioDoneMeta = "meta.json"
)

// scenarioDoneEntry is one scenario's meta.json: what was signed off, when,
// in which run, and the steps that held.
type scenarioDoneEntry struct {
	Key     string    `json:"key"`
	Section string    `json:"section"`
	RunID   string    `json:"runId"`
	Date    time.Time `json:"date"`
	Note    string    `json:"note"`
	Verdict string    `json:"verdict"`
	Forced  bool      `json:"forced,omitempty"`
	Proof   []string  `json:"proof,omitempty"`
}

type scenarioDoneLedger []scenarioDoneEntry

func scenarioDoneKey(id string) string { return url.PathEscape(id) }

func scenarioDoneRoot(root string) string {
	return filepath.Join(root, ".apidiff", scenarioDoneDir)
}

// loadScenarioDone reads every entry's meta.json; no ledger is an empty one.
func loadScenarioDone(root string) (scenarioDoneLedger, error) {
	var ledger scenarioDoneLedger
	matches, err := filepath.Glob(filepath.Join(scenarioDoneRoot(root), "*", scenarioDoneMeta))
	if err != nil {
		return nil, err
	}
	for _, path := range matches {
		content, err := os.ReadFile(path) // #nosec G304 -- inside the tool's own done ledger.
		if err != nil {
			return nil, err
		}
		var entry scenarioDoneEntry
		if err := json.Unmarshal(content, &entry); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		ledger = append(ledger, entry)
	}
	sort.Slice(ledger, func(i, j int) bool { return ledger[i].Key < ledger[j].Key })
	return ledger, nil
}

func (ledger scenarioDoneLedger) holds(id string) bool {
	for index := range ledger {
		if ledger[index].Key == scenarioDoneKey(id) {
			return true
		}
	}
	return false
}

// scope drops the signed-off scenarios and answers their ids.
func (ledger scenarioDoneLedger) scope(items []scenario) ([]scenario, []string) {
	if len(ledger) == 0 {
		return items, nil
	}
	var kept []scenario
	var skipped []string
	for index := range items {
		if ledger.holds(items[index].ID) {
			skipped = append(skipped, items[index].ID)
			continue
		}
		kept = append(kept, items[index])
	}
	return kept, skipped
}

// markScenarioDone copies a scenario's proof out of a finished run into the
// ledger. It refuses a scenario that did not pass unless forced.
func markScenarioDone(root, runID, id, note string, force bool, now time.Time) (scenarioDoneEntry, error) {
	if strings.TrimSpace(note) == "" {
		return scenarioDoneEntry{}, errors.New("done: -note is required")
	}
	results, err := readRunResults(filepath.Join(root, ".apidiff", runID, "scenarios.jsonl"))
	if err != nil {
		return scenarioDoneEntry{}, fmt.Errorf("done: %w", err)
	}
	for index := range results {
		if results[index].ID != id {
			continue
		}
		if results[index].Verdict != verdictPass && !force {
			return scenarioDoneEntry{}, fmt.Errorf("done: scenario %s is %s in run %s; fix it, or pass -force with a note", id, results[index].Verdict, runID)
		}
		entry := scenarioDoneEntry{
			Key: scenarioDoneKey(id), Section: id, RunID: runID, Date: now.UTC(), Note: note,
			Verdict: results[index].Verdict, Forced: force, Proof: proofOf(&results[index]),
		}
		return entry, writeScenarioDone(root, entry)
	}
	return scenarioDoneEntry{}, fmt.Errorf("done: run %s has no scenario %s", runID, id)
}

func readRunResults(path string) ([]scenarioResult, error) {
	file, err := os.Open(path) // #nosec G304 -- this operator's own run directory, named by -run.
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }()
	var results []scenarioResult
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		var result scenarioResult
		if err := json.Unmarshal(scanner.Bytes(), &result); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		results = append(results, result)
	}
	return results, scanner.Err()
}

// proofOf is one line per request the scenario sent on the first side.
func proofOf(result *scenarioResult) []string {
	var proof []string
	for _, step := range result.Branch.Steps {
		proof = append(proof, fmt.Sprintf("%s %s %s -> %d", step.Step, step.Method, step.Path, step.Status))
	}
	return proof
}

func writeScenarioDone(root string, entry scenarioDoneEntry) error {
	dir := filepath.Join(scenarioDoneRoot(root), entry.Key)
	staging := dir + ".partial"
	_ = os.RemoveAll(staging)
	if err := os.MkdirAll(staging, 0o750); err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(entry, "", " ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(staging, scenarioDoneMeta), encoded, 0o600); err != nil {
		return err
	}
	_ = os.RemoveAll(dir)
	return os.Rename(staging, dir)
}

// undoScenarioDone removes one entry by the key `done -list` prints.
func undoScenarioDone(root, id string) error {
	dir := filepath.Join(scenarioDoneRoot(root), scenarioDoneKey(id))
	if _, err := os.Stat(filepath.Join(dir, scenarioDoneMeta)); errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("done: no entry %q (see done -list)", id)
	}
	return os.RemoveAll(dir)
}

func writeScenarioDoneList(out io.Writer, ledger scenarioDoneLedger) {
	if len(ledger) == 0 {
		fmt.Fprintln(out, "done: the ledger is empty")
		return
	}
	for index := range ledger {
		entry := ledger[index]
		fmt.Fprintf(out, "%s  %s  %s  %s\n", entry.Key, entry.RunID, entry.Date.Format("2006-01-02"), entry.Note)
	}
}

// doneScenariosSubcommand signs a scenario off, lists the ledger, or removes an entry.
func doneScenariosSubcommand(args []string, out streams) int {
	flags := flag.NewFlagSet("apidiff done", flag.ContinueOnError)
	flags.SetOutput(out.stderr)
	root := flags.String("root", ".", "repository root")
	runID := flags.String("run", "", "run id whose proof is kept (its .apidiff/<runID> directory)")
	id := flags.String("scenario", "", "scenario id to sign off")
	note := flags.String("note", "", "why the scenario is done")
	force := flags.Bool("force", false, "sign off a scenario that did not pass")
	list := flags.Bool("list", false, "print the ledger")
	undo := flags.String("undo", "", "remove the entry with this key (see -list)")
	if err := flags.Parse(args); err != nil {
		return exitError
	}
	if err := runScenarioDone(*root, doneInputsOf(*runID, *id, *note, *undo, *force, *list), out); err != nil {
		fmt.Fprintln(out.stderr, "apidiff:", err)
		return exitError
	}
	return exitEqual
}

type scenarioDoneInputs struct {
	runID, id, note, undo string
	force, list           bool
}

func doneInputsOf(runID, id, note, undo string, force, list bool) scenarioDoneInputs {
	return scenarioDoneInputs{runID: runID, id: id, note: note, undo: undo, force: force, list: list}
}

func runScenarioDone(root string, inputs scenarioDoneInputs, out streams) error {
	switch {
	case inputs.list:
		ledger, err := loadScenarioDone(root)
		if err == nil {
			writeScenarioDoneList(out.stdout, ledger)
		}
		return err
	case inputs.undo != "":
		if err := undoScenarioDone(root, inputs.undo); err != nil {
			return err
		}
		fmt.Fprintf(out.stdout, "done: removed %s\n", inputs.undo)
		return nil
	case inputs.runID == "" || inputs.id == "":
		return errors.New("done: want -run and -scenario, or -list, or -undo KEY")
	}
	entry, err := markScenarioDone(root, inputs.runID, inputs.id, inputs.note, inputs.force, time.Now())
	if err != nil {
		return err
	}
	fmt.Fprintf(out.stdout, "done: %s, %d steps of proof in %s\n", entry.Key, len(entry.Proof), filepath.Join(scenarioDoneRoot(root), entry.Key))
	return nil
}
