package visualdiff

import (
	"encoding/json"
	"errors"
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

// DoneDir holds the done ledger (README "Marking a section done"): one entry
// per section a person signed off, with its proof. A run skips every section
// it holds unless -include-done is given.
const DoneDir = "done"

// doneClasses are the only classes a section may be marked done with
// unless -force is given.
var doneClasses = map[Classification]bool{ClassNoise: true, ClassCopy: true, ClassIntendedRestore: true}

// DoneEntry is one section's meta.json: what was signed off, when, and on
// which commits. Key is its directory under .visualdiff/done.
type DoneEntry struct {
	Key             string           `json:"key"`
	Edition         Edition          `json:"edition"`
	Kind            string           `json:"kind"`
	Section         string           `json:"section"`
	RunID           string           `json:"runId"`
	BaseCommit      string           `json:"baseCommit,omitempty"`
	CandidateCommit string           `json:"candidateCommit,omitempty"`
	Date            time.Time        `json:"date"`
	Note            string           `json:"note"`
	Classes         []Classification `json:"classes"`
	Forced          bool             `json:"forced,omitempty"`
	// Proof are the flow's expects that held on both sides (FlowProof).
	Proof []string `json:"proof,omitempty"`
}

// DoneLedger is every entry under .visualdiff/done.
type DoneLedger []DoneEntry

// DoneKey names a section's directory: route paths are escaped whole, so
// "/a-b" and "/a/b" never share one.
func DoneKey(edition Edition, kind, section string) string {
	return string(edition) + "/" + kind + "-" + url.PathEscape(section)
}

func doneRoot(root string) string { return filepath.Join(root, ".visualdiff", DoneDir) }

// LoadDoneLedger reads every entry's meta.json; no ledger is an empty one.
func LoadDoneLedger(root string) (DoneLedger, error) {
	var ledger DoneLedger
	matches, err := filepath.Glob(filepath.Join(doneRoot(root), "*", "*", BaselineMetaFile))
	if err != nil {
		return nil, err
	}
	for _, path := range matches {
		if strings.HasSuffix(filepath.Dir(path), ".partial") {
			continue
		}
		content, err := os.ReadFile(path) // #nosec G304 -- inside the tool's own done ledger.
		if err != nil {
			return nil, err
		}
		var entry DoneEntry
		if err := json.Unmarshal(content, &entry); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		ledger = append(ledger, entry)
	}
	sort.Slice(ledger, func(i, j int) bool { return ledger[i].Key < ledger[j].Key })
	return ledger, nil
}

func (ledger DoneLedger) holds(edition Edition, kind, section string) bool {
	for index := range ledger {
		entry := ledger[index]
		if entry.Edition == edition && entry.Kind == kind && entry.Section == section {
			return true
		}
	}
	return false
}

// Scope is the one place a run's routes and flows are narrowed: a copy of
// config without the edition's done sections, and those sections' keys.
// Coverage reads the unscoped config, so a skipped section is never uncovered.
func (ledger DoneLedger) Scope(config *Config, edition Edition) (*Config, []string) {
	if len(ledger) == 0 {
		return config, nil
	}
	scoped := *config
	scoped.Routes, scoped.Flows = nil, nil
	var skipped []string
	for _, route := range config.Routes {
		if ledger.holds(edition, "route", route) {
			skipped = append(skipped, DoneKey(edition, "route", route))
			continue
		}
		scoped.Routes = append(scoped.Routes, route)
	}
	for _, flow := range config.Flows {
		if ledger.holds(edition, "flow", flow.ID) {
			skipped = append(skipped, DoneKey(edition, "flow", flow.ID))
			continue
		}
		scoped.Flows = append(scoped.Flows, flow)
	}
	return &scoped, skipped
}

// writeSkips says how many done sections a run skips, and which.
func (ledger DoneLedger) writeSkips(out io.Writer, config *Config, editions []Edition) {
	var skipped []string
	for _, edition := range editions {
		_, keys := ledger.Scope(config, edition)
		skipped = append(skipped, keys...)
	}
	if len(skipped) == 0 {
		return
	}
	fmt.Fprintf(out, "  done      skipped %d (-include-done captures them): %s\n", len(skipped), strings.Join(skipped, ", "))
}

// DoneRequest is one `visualdiff done -run` invocation.
type DoneRequest struct {
	Root    string
	RunID   string
	Edition Edition
	Kind    string
	Section string
	Note    string
	Force   bool
	Now     time.Time
}

// MarkDone copies a section's proof out of a finished run into the ledger.
// It refuses a section the run never captured, and one with any class but
// noise, copy or intended-restore unless Force is set.
func MarkDone(request DoneRequest) (DoneEntry, error) {
	if strings.TrimSpace(request.Note) == "" {
		return DoneEntry{}, errors.New("done: -note is required")
	}
	runDir := filepath.Join(request.Root, ".visualdiff", request.RunID)
	report, err := readReport(filepath.Join(runDir, "report", string(request.Edition), "findings.json"))
	if err != nil {
		return DoneEntry{}, fmt.Errorf("done: %w", err)
	}
	rows := sectionRows(report.Rows, request.Kind, request.Section)
	if len(rows) == 0 {
		return DoneEntry{}, fmt.Errorf("done: run %s has no %s %s in the %s edition", request.RunID, request.Kind, request.Section, request.Edition)
	}
	entry := DoneEntry{
		Key: DoneKey(request.Edition, request.Kind, request.Section), Edition: request.Edition, Kind: request.Kind,
		Section: request.Section, RunID: request.RunID, BaseCommit: report.Meta.BaseCommit,
		CandidateCommit: report.Meta.CandidateCommit, Date: request.Now.UTC(), Note: request.Note,
		Classes: rowClasses(rows), Forced: request.Force, Proof: FlowProof(rows),
	}
	if failing := failingClasses(entry.Classes); len(failing) > 0 && !request.Force {
		return DoneEntry{}, fmt.Errorf("done: %s %s has failing classes %v in run %s; fix it, or pass -force with a note", request.Kind, request.Section, failing, request.RunID)
	}
	return entry, writeDoneEntry(filepath.Join(doneRoot(request.Root), filepath.FromSlash(entry.Key)), entry, rows)
}

// doneReport is the part of report/<edition>/findings.json the ledger reads.
type doneReport struct {
	Meta ReportMeta `json:"meta"`
	Rows []Row      `json:"rows"`
}

func readReport(path string) (doneReport, error) {
	var report doneReport
	content, err := os.ReadFile(path) // #nosec G304 -- this operator's own run directory, named by -run.
	if err != nil {
		return report, err
	}
	err = json.Unmarshal(content, &report)
	return report, err
}

func sectionRows(rows []Row, kind, section string) []Row {
	var matched []Row
	for index := range rows {
		if rows[index].Kind == kind && rows[index].Key == section {
			matched = append(matched, rows[index])
		}
	}
	return matched
}

func rowClasses(rows []Row) []Classification {
	seen := map[Classification]bool{}
	var classes []Classification
	for index := range rows {
		if class := rows[index].Class; !seen[class] {
			seen[class] = true
			classes = append(classes, class)
		}
	}
	return classes
}

func failingClasses(classes []Classification) []Classification {
	var failing []Classification
	for _, class := range classes {
		if !doneClasses[class] {
			failing = append(failing, class)
		}
	}
	return failing
}

// writeDoneEntry writes the proof beside the slot and renames it into place,
// as SaveBaseline does: the screenshots, rows.json (aria snapshots, console
// errors and failed requests per side) and meta.json.
func writeDoneEntry(dir string, entry DoneEntry, rows []Row) error {
	staging := dir + ".partial"
	_ = os.RemoveAll(staging)
	if err := os.MkdirAll(staging, 0o750); err != nil {
		return err
	}
	for index := range rows {
		if err := copyRowImages(staging, rows[index]); err != nil {
			return err
		}
	}
	if err := writeJSON(filepath.Join(staging, "rows.json"), rows); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(staging, BaselineMetaFile), entry); err != nil {
		return err
	}
	_ = os.RemoveAll(dir)
	return os.Rename(staging, dir)
}

func copyRowImages(dir string, row Row) error {
	images := map[string]string{"diff": row.DiffFile}
	if row.Base != nil {
		images["base"] = row.Base.Screenshot
	}
	if row.Candidate != nil {
		images["candidate"] = row.Candidate.Screenshot
	}
	for side, source := range images {
		if source == "" {
			continue
		}
		if err := copyIfPresent(source, filepath.Join(dir, fmt.Sprintf("%02d-%s.png", row.Index, side))); err != nil {
			return err
		}
	}
	return nil
}

func writeJSON(path string, value any) error {
	encoded, err := json.MarshalIndent(value, "", " ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, encoded, 0o600)
}

// UndoDone removes one entry by the key `done -list` prints.
func UndoDone(root, key string) error {
	base := doneRoot(root)
	dir := filepath.Join(base, filepath.FromSlash(key))
	relative, err := filepath.Rel(base, dir)
	if err != nil || strings.HasPrefix(relative, "..") || strings.Count(relative, string(filepath.Separator)) != 1 {
		return fmt.Errorf("done: %q is not a ledger key (see done -list)", key)
	}
	if _, err := os.Stat(filepath.Join(dir, BaselineMetaFile)); errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("done: no entry %q (see done -list)", key)
	}
	return os.RemoveAll(dir)
}

// WriteDoneList prints the ledger, one entry a line.
func WriteDoneList(out io.Writer, ledger DoneLedger) {
	if len(ledger) == 0 {
		fmt.Fprintln(out, "done: the ledger is empty")
		return
	}
	for index := range ledger {
		entry := ledger[index]
		fmt.Fprintf(out, "%s  %s  %s  %s\n", entry.Key, short(entry.CandidateCommit), entry.Date.Format("2006-01-02"), entry.Note)
	}
}
