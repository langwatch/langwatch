package visualdiff

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// A batch is a sealed, self-contained slice of a run an agent reviews while the
// run goes on: <out>/batches/NNNN-<phase>/ with batch.json, REVIEW.md, its own
// screenshots, and READY written last. <out>/batches.jsonl indexes every batch.
const (
	BatchesDir       = "batches"
	BatchesIndex     = "batches.jsonl"
	BatchFile        = "batch.json"
	BatchReviewFile  = "REVIEW.md"
	BatchReadyFile   = "READY"
	DefaultBatchSize = 20
)

// Batch is one sealed batch's batch.json.
type Batch struct {
	Number   int         `json:"batch"`
	Phase    string      `json:"phase"`
	Edition  Edition     `json:"edition,omitempty"`
	SealedAt string      `json:"sealedAt"`
	Flagged  int         `json:"flagged"`
	Items    []BatchItem `json:"items"`
}

// BatchItem is one route or flow: its verdict and every screen it captured.
type BatchItem struct {
	Kind    string        `json:"kind"`
	Key     string        `json:"key"`
	Verdict string        `json:"verdict"`
	Flagged bool          `json:"flagged"`
	Failing *BatchFailure `json:"failing,omitempty"`
	Expects int           `json:"expects,omitempty"`
	Screens []BatchScreen `json:"screens"`
}

// BatchFailure is an item's first failing step on the candidate.
type BatchFailure struct {
	Index int    `json:"index"`
	Label string `json:"label"`
	Error string `json:"error"`
}

// BatchScreen is one screen's class and evidence; image paths are relative to the batch.
type BatchScreen struct {
	Index     int            `json:"index"`
	Label     string         `json:"label"`
	Class     Classification `json:"class"`
	Why       string         `json:"why"`
	Ratio     float64        `json:"ratio"`
	Diff      string         `json:"diff,omitempty"`
	Base      *BatchSide     `json:"base,omitempty"`
	Candidate *BatchSide     `json:"candidate,omitempty"`
}

// BatchSide is what one side captured of a screen.
type BatchSide struct {
	URL            string   `json:"url"`
	Screenshot     string   `json:"screenshot,omitempty"`
	DurationMS     int      `json:"durationMs"`
	ConsoleErrors  []string `json:"consoleErrors,omitempty"`
	FailedRequests []string `json:"failedRequests,omitempty"`
	Error          string   `json:"error,omitempty"`
}

// BatchIndexLine is one line of batches.jsonl.
type BatchIndexLine struct {
	Number   int     `json:"batch"`
	Phase    string  `json:"phase"`
	Edition  Edition `json:"edition,omitempty"`
	Dir      string  `json:"dir"`
	Items    int     `json:"items"`
	Flagged  int     `json:"flagged"`
	SealedAt string  `json:"sealedAt"`
}

// batcherInputs groups newBatcher's arguments.
type batcherInputs struct {
	OutDir string
	Size   int
	Plan   RunnerPlan
	Out    io.Writer
	Now    func() time.Time
}

// batcher groups a run's streamed captures into items and seals a batch every
// size ready items and at each phase boundary. It only writes; verdicts stay the run's.
type batcher struct {
	mutex   sync.Mutex
	outDir  string
	size    int
	check   bool
	edition Edition
	live    []string
	out     io.Writer
	now     func() time.Time
	next    int
	items   map[itemKey]*batchEntry
	order   []itemKey
	open    map[string]itemKey
	err     error
}

type itemKey struct{ kind, key string }

type batchEntry struct {
	captures []Capture
	diffs    []Diff
	closed   map[string]bool
	sealed   bool
}

// newBatcher is nil when size is not positive: -batch-size 0 turns batching off.
func newBatcher(inputs batcherInputs) *batcher {
	if inputs.Size <= 0 {
		return nil
	}
	now := inputs.Now
	if now == nil {
		now = time.Now
	}
	batches := &batcher{
		outDir: inputs.OutDir, size: inputs.Size, check: inputs.Plan.Check, edition: inputs.Plan.Edition,
		out: inputs.Out, now: now, next: lastBatch(filepath.Join(inputs.OutDir, BatchesDir)) + 1,
		items: map[itemKey]*batchEntry{}, open: map[string]itemKey{},
	}
	for _, side := range inputs.Plan.Sides {
		if side.Replay == "" {
			batches.live = append(batches.live, side.Name)
		}
	}
	return batches
}

// resetBatches forgets an earlier check's batches, since check reuses its out dir.
func resetBatches(outDir string) {
	_ = os.RemoveAll(filepath.Join(outDir, BatchesDir))
	_ = os.Remove(filepath.Join(outDir, BatchesIndex))
}

// wrap chains the batcher after options' own hooks.
func (batches *batcher) wrap(options CaptureOptions) CaptureOptions {
	if batches == nil {
		return options
	}
	onCapture, onDiff, onPhase := options.OnCapture, options.OnDiff, options.OnPhase
	options.OnCapture = func(capture Capture) {
		if onCapture != nil {
			onCapture(capture)
		}
		batches.onCapture(capture)
	}
	options.OnDiff = func(diff Diff) {
		if onDiff != nil {
			onDiff(diff)
		}
		batches.onDiff(diff)
	}
	options.OnPhase = func(phase RunnerPhase) {
		if onPhase != nil {
			onPhase(phase)
		}
		batches.onPhase(phase)
	}
	return options
}

func (batches *batcher) entry(kind, key string) *batchEntry {
	identity := itemKey{kind, key}
	entry, ok := batches.items[identity]
	if !ok {
		entry = &batchEntry{closed: map[string]bool{}}
		batches.items[identity] = entry
		batches.order = append(batches.order, identity)
	}
	return entry
}

// onCapture adds a capture. A flow's captures on one side arrive together, so
// the side's next message closes it; a route is one capture and closes at once.
func (batches *batcher) onCapture(capture Capture) {
	batches.mutex.Lock()
	defer batches.mutex.Unlock()
	identity := itemKey{capture.Kind, capture.Key}
	entry := batches.entry(capture.Kind, capture.Key)
	entry.captures = append(entry.captures, capture)
	if slices.Contains(batches.live, capture.Side) {
		batches.closeOpen(capture.Side, identity)
		if capture.Kind == "flow" {
			batches.open[capture.Side] = identity
		} else {
			entry.closed[capture.Side] = true
		}
	}
	batches.sealFull(false)
}

func (batches *batcher) onDiff(diff Diff) {
	batches.mutex.Lock()
	defer batches.mutex.Unlock()
	entry := batches.entry(diff.Kind, diff.Key)
	entry.diffs = append(entry.diffs, diff)
	batches.sealFull(false)
}

// onPhase closes the side's open flow; the end of a side's routes or flows is a
// phase boundary, which seals every ready item however few.
func (batches *batcher) onPhase(phase RunnerPhase) {
	batches.mutex.Lock()
	defer batches.mutex.Unlock()
	batches.closeOpen(phase.Side, itemKey{})
	batches.sealFull(phase.Name == "capture" || phase.Name == "flows")
}

func (batches *batcher) closeOpen(side string, unless itemKey) {
	if open, ok := batches.open[side]; ok && open != unless {
		batches.items[open].closed[side] = true
		delete(batches.open, side)
	}
}

// close seals everything left, ready or not, once the runner has exited.
func (batches *batcher) close() error {
	if batches == nil {
		return nil
	}
	batches.mutex.Lock()
	defer batches.mutex.Unlock()
	for _, phase := range []string{"routes", "flows"} {
		pending := batches.pending(phase, func(*batchEntry) bool { return true })
		for len(pending) > 0 {
			take := min(batches.size, len(pending))
			batches.seal(phase, pending[:take])
			pending = pending[take:]
		}
	}
	return batches.err
}

// sealFull seals each phase's ready items size at a time, and the rest too at a boundary.
func (batches *batcher) sealFull(boundary bool) {
	for _, phase := range []string{"routes", "flows"} {
		ready := batches.pending(phase, batches.ready)
		for len(ready) >= batches.size || (boundary && len(ready) > 0) {
			take := min(batches.size, len(ready))
			batches.seal(phase, ready[:take])
			ready = ready[take:]
		}
	}
}

func (batches *batcher) pending(phase string, accept func(*batchEntry) bool) []itemKey {
	var out []itemKey
	for _, identity := range batches.order {
		entry := batches.items[identity]
		if !entry.sealed && identity.kind+"s" == phase && accept(entry) {
			out = append(out, identity)
		}
	}
	return out
}

// ready is every live side closed and a diff in for each screen both sides photographed.
func (batches *batcher) ready(entry *batchEntry) bool {
	for _, side := range batches.live {
		if !entry.closed[side] {
			return false
		}
	}
	shot := map[int]int{}
	for _, capture := range entry.captures {
		if capture.Screenshot != "" {
			shot[capture.Index]++
		}
	}
	for index, sides := range shot {
		if sides > 1 && !slices.ContainsFunc(entry.diffs, func(diff Diff) bool { return diff.Index == index }) {
			return false
		}
	}
	return true
}

func (batches *batcher) seal(phase string, identities []itemKey) {
	number := batches.next
	batches.next++
	dir := filepath.Join(batches.outDir, BatchesDir, fmt.Sprintf("%04d-%s", number, phase))
	batch := Batch{Number: number, Phase: phase, Edition: batches.edition, SealedAt: batches.now().UTC().Format(time.RFC3339)}
	for position, identity := range identities {
		entry := batches.items[identity]
		entry.sealed = true
		item := batches.item(identity, entry, itemFiles{dir: dir, position: position + 1})
		if item.Flagged {
			batch.Flagged++
		}
		batch.Items = append(batch.Items, item)
	}
	if err := writeBatch(dir, batch); err != nil {
		if batches.err == nil {
			batches.err = err
		}
		return
	}
	line := BatchIndexLine{Number: number, Phase: phase, Edition: batches.edition, Dir: dir, Items: len(batch.Items), Flagged: batch.Flagged, SealedAt: batch.SealedAt}
	if err := appendBatchIndex(filepath.Join(batches.outDir, BatchesIndex), line); err != nil && batches.err == nil {
		batches.err = err
	}
	if batches.out != nil {
		fmt.Fprintf(batches.out, "visualdiff: batch %04d ready (%d items, %d flagged) %s\n", number, len(batch.Items), batch.Flagged, dir)
	}
}

// item reads one route or flow as check or run would: check's flows by their
// expects, everything else by the classifier. Flagged is anything but a clean pass.
func (batches *batcher) item(identity itemKey, entry *batchEntry, files itemFiles) BatchItem {
	item := BatchItem{Kind: identity.kind, Key: identity.key}
	tallyCandidate(&item, entry.captures)
	rows := BuildRows(entry.captures, entry.diffs)
	slices.SortStableFunc(rows, func(a, b Row) int { return a.Index - b.Index })
	finding := false
	for index := range rows {
		finding = finding || batches.finding(rows[index])
		item.Screens = append(item.Screens, files.screen(rows[index]))
	}
	checkFlow := batches.check && identity.kind == "flow"
	item.Verdict = itemVerdict(item, checkFlow, finding)
	item.Flagged = item.Verdict != "pass" || finding
	return item
}

// tallyCandidate records the candidate side's first failure and its held
// expects on item.
func tallyCandidate(item *BatchItem, captures []Capture) {
	for _, capture := range captures {
		switch {
		case capture.Side != "candidate":
		case capture.Error != "" && item.Failing == nil:
			item.Failing = &BatchFailure{Index: capture.Index, Label: capture.Label, Error: capture.Error}
		case capture.Error == "" && capture.Expect != "":
			item.Expects++
		}
	}
}

// itemVerdict is fail, unproven or pass: a checked flow by its own failure
// and expects, anything else by whether it differs from main.
func itemVerdict(item BatchItem, checkFlow, finding bool) string {
	switch {
	case checkFlow && item.Failing != nil, !checkFlow && finding:
		return "fail"
	case checkFlow && item.Expects == 0:
		return "unproven"
	default:
		return "pass"
	}
}

// finding is Row.Finding, less what check calls unmatched: nothing of main's to compare.
func (batches *batcher) finding(row Row) bool {
	if batches.check && row.Base == nil && (row.Candidate == nil || row.Candidate.Error == "") {
		return false
	}
	return row.Finding()
}

// itemFiles places one item's images in its batch: shots/<position>-<index>-<side>.png.
type itemFiles struct {
	dir      string
	position int
}

func (files itemFiles) screen(row Row) BatchScreen {
	screen := BatchScreen{Index: row.Index, Label: row.Label, Class: row.Class, Why: row.Why, Ratio: row.Ratio}
	screen.Base = files.side(row.Base, row.Index, "base")
	screen.Candidate = files.side(row.Candidate, row.Index, "candidate")
	if row.Diffed {
		screen.Diff = files.place(row.DiffFile, row.Index, "diff")
	}
	return screen
}

func (files itemFiles) side(capture *Capture, index int, name string) *BatchSide {
	if capture == nil {
		return nil
	}
	return &BatchSide{
		URL: capture.URL, Screenshot: files.place(capture.Screenshot, index, name), DurationMS: capture.DurationMS,
		ConsoleErrors: capture.ConsoleErrors, FailedRequests: capture.FailedRequests, Error: capture.Error,
	}
}

// place hardlinks (or copies) an image into the batch, answering its batch-relative path.
func (files itemFiles) place(source string, index int, name string) string {
	if source == "" {
		return ""
	}
	relative := filepath.Join("shots", fmt.Sprintf("%02d-%d-%s.png", files.position, index, name))
	target := filepath.Join(files.dir, relative)
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return ""
	}
	if os.Link(source, target) != nil && copyFile(source, target) != nil {
		return ""
	}
	return filepath.ToSlash(relative)
}

func copyFile(source, target string) error {
	in, err := os.Open(source) // #nosec G304 -- the runner's own screenshot.
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(target) // #nosec G304 -- inside this run's batch.
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

// writeBatch writes batch.json and REVIEW.md, then READY through a rename, last.
func writeBatch(dir string, batch Batch) error {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(batch, "", " ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, BatchFile), encoded, 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, BatchReviewFile), []byte(batchReview(batch)), 0o600); err != nil {
		return err
	}
	staging := filepath.Join(dir, BatchReadyFile+".tmp")
	if err := os.WriteFile(staging, []byte(batch.SealedAt+"\n"), 0o600); err != nil {
		return err
	}
	return os.Rename(staging, filepath.Join(dir, BatchReadyFile))
}

func appendBatchIndex(path string, line BatchIndexLine) error {
	writer, err := OpenFindingsFile(path)
	if err != nil {
		return err
	}
	if err := writer.WriteLine(line); err != nil {
		_ = writer.Close()
		return err
	}
	return writer.Close()
}

// lastBatch is the highest batch number under dir, 0 when there is none.
func lastBatch(dir string) int {
	last := 0
	for _, number := range batchNumbers(dir) {
		last = max(last, number)
	}
	return last
}

// batchNumbers maps each batch directory under dir to its number.
func batchNumbers(dir string) map[string]int {
	entries, _ := os.ReadDir(dir)
	numbers := map[string]int{}
	for _, entry := range entries {
		prefix, _, found := strings.Cut(entry.Name(), "-")
		if number, err := strconv.Atoi(prefix); entry.IsDir() && found && err == nil {
			numbers[entry.Name()] = number
		}
	}
	return numbers
}

// batchReview is REVIEW.md: what to judge, the known noise, and every item's evidence.
func batchReview(batch Batch) string {
	var out strings.Builder
	fmt.Fprintf(&out, "# visualdiff batch %04d (%s", batch.Number, batch.Phase)
	if batch.Edition != "" {
		fmt.Fprintf(&out, ", %s", batch.Edition)
	}
	fmt.Fprintf(&out, ")\n\n%d items, %d flagged, sealed %s. Judge only this batch; the run may still be going.\n\n", len(batch.Items), batch.Flagged, batch.SealedAt)
	out.WriteString(reviewBrief)
	for position, item := range batch.Items {
		fmt.Fprintf(&out, "\n### %d. %s `%s`: %s", position+1, item.Kind, item.Key, item.Verdict)
		if item.Flagged {
			out.WriteString(" (flagged)")
		}
		out.WriteString("\n\n")
		if item.Failing != nil {
			fmt.Fprintf(&out, "Failing: step %d %s: %s\n\n", item.Failing.Index, item.Failing.Label, head(item.Failing.Error))
		}
		for _, screen := range item.Screens {
			writeReviewScreen(&out, screen)
		}
	}
	return out.String()
}

func writeReviewScreen(out *strings.Builder, screen BatchScreen) {
	fmt.Fprintf(out, "- step %d %s: `%s` %s (%.2f%%)\n", screen.Index, screen.Label, screen.Class, screen.Why, screen.Ratio*100)
	for _, side := range []struct {
		name    string
		capture *BatchSide
	}{{"base", screen.Base}, {"candidate", screen.Candidate}} {
		if side.capture == nil {
			fmt.Fprintf(out, "  - %s: not captured\n", side.name)
			continue
		}
		fmt.Fprintf(out, "  - %s: %s at %s (%dms)\n", side.name, orNone(side.capture.Screenshot), side.capture.URL, side.capture.DurationMS)
		for _, message := range side.capture.ConsoleErrors {
			fmt.Fprintf(out, "    - console: %s\n", head(message))
		}
	}
	if screen.Diff != "" {
		fmt.Fprintf(out, "  - diff: %s\n", screen.Diff)
	}
}

func orNone(path string) string {
	if path == "" {
		return "no screenshot"
	}
	return path
}

// reviewBrief is the judging instruction and the known-noise rules from README.md.
const reviewBrief = `## What to judge

For each flagged item, open the candidate screenshot beside the base (main's) and the
diff, and answer one line: a branch defect (what differs, at which step) or noise
(which rule below covers it). Unflagged items need a look only at a large diff ratio.
Verdicts are the run's own; this brief changes none of them.

## Known noise

- ` + "`noise`" + `: under 2% of pixels differ with nothing else wrong.
- ` + "`copy`, `changed` and `intended-restore`" + ` are informational and never fail a run.
- Dates, times, relative times, ids and digits are masked; a difference only there is noise.
- Telemetry (` + "`/api/rum/v1/traces`" + `) is ignored, and the join offer's 429 is noise.
- The passkey offer is declined before every screenshot; sign-in photographs it once as the ` + "`sign-in`" + ` flow.
- ` + "`capture-failed`" + ` is the tool's failure (the page's own modules did not load), not the screen's.

## Items
`
