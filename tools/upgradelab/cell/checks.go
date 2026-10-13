package cell

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/seed"

	"github.com/langwatch/langwatch/tools/upgradelab/snapshot"
)

const sigStop = syscall.SIGSTOP

func newHTTPClient() *http.Client { return &http.Client{Timeout: 30 * time.Second} }

// checks reads the settled stores and answers every invariant the cell can prove.
func (cell *run) checks(ctx context.Context) error {
	cell.report.Marks, cell.report.Phases = cell.marks, cell.poller.Timeline()
	final, err := Ledger(ctx, cell.stores)
	if err != nil {
		return err
	}
	visible, err := cell.visibleWrites(ctx)
	if err != nil {
		return err
	}
	cell.report.Traffic, cell.report.Timeline = Summarize(cell.allCalls(), ServedTimeline(cell.report.Phases, cell.marks["switched"]), visible)
	cell.report.Queue = cell.queueSummary(ctx)
	cell.report.Notes = append(cell.report.Notes, lostByPhase(cell.allCalls(), cell.report.Phases, visible)...)
	cell.report.Verdicts = append(cell.report.Verdicts,
		cell.holdingVerdict(), ledgerVerdict(final), reopenedVerdict(cell.atReady, final, cell.drills.retried), cell.rosterVerdict(ctx),
		cell.copyVerdict(ctx), cell.readBackVerdict(ctx), cell.secondRunVerdict(ctx, final), cell.logVerdict(),
		cell.apiEarlyVerdict(), cell.crashVerdict(), droppedVerdict(cell.report.Traffic, cell.downExcused()), ingestVerdict(cell.report.Traffic), unansweredVerdict(cell.allCalls()), lostVerdict(cell.report.Traffic), queueVerdict(cell.report.Queue), cell.opsVerdict(final))
	cell.report.Verdicts = append(cell.report.Verdicts, cell.hybridVerdicts(ctx)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.ssoVerdicts(ctx, final)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.legacyVerdicts(ctx, final)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.legacyOrgVerdict(ctx, final)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.licenseVerdict(ctx, final)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.licensedSSOVerdicts(ctx, final)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.scimVerdict(ctx, final)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.retentionVerdict(ctx)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.oddityVerdicts(ctx)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.heldTenantVerdicts(ctx)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.queuedJobsVerdict(ctx)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.damageVerdicts(ctx)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.signupVerdicts(ctx)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.drillVerdicts(final)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.readModelVerdict(ctx), cell.browserVerdict(), cell.storedEventsVerdict(ctx))
	cell.report.Verdicts = append(cell.report.Verdicts, cell.upcastVerdict(ctx, final)...) // after I7, which it reads
	for index := range cell.report.Verdicts {
		cell.report.Verdicts[index].Scenarios = scenarioIDs[cell.report.Verdicts[index].ID]
	}
	cell.report.Resources, _ = ResourcePeaks(filepath.Join(cell.options.RunDir, "resources.jsonl"))
	cell.report.Ribbon = Ribbon(cell.report, cell.origin, final)
	return nil
}

// crashVerdict: head's api, started before its worker, stays up until ready.
func (cell *run) crashVerdict() Verdict {
	first := ""
	if len(cell.apiCrashes) > 0 {
		first = "; first log " + cell.logPath("head-api-crash-1")
	}
	return verdict("N7", len(cell.apiCrashes) == 0, fmt.Sprintf("%d exits before ready, at ms %v%s", len(cell.apiCrashes), cell.apiCrashes, first))
}

// holdingVerdict: the api serves everything from boot while the upgrade runs (no request holds).
func (cell *run) holdingVerdict() Verdict {
	holding, ready := FirstAt(cell.report.Phases, "holding:"), FirstAt(cell.report.Phases, "ready")
	return verdict("I0", holding < 0, fmt.Sprintf("holding page first answered at %d ms (-1: never), ready at %d ms", holding, ready))
}

// ingestVerdict: ingest never sees a non-2xx, on any attempt.
func ingestVerdict(summaries []KindSummary) Verdict {
	var seen []string
	for i := range summaries {
		each := &summaries[i]
		if storedTable[each.Kind] != "" && each.NonOK > 0 {
			seen = append(seen, fmt.Sprintf("%s %d", each.Kind, each.NonOK))
		}
	}
	return verdict("N5", len(seen) == 0, fmt.Sprintf("non-2xx answers per ingest kind: %v", seen))
}

func ledgerVerdict(rows []LedgerRow) Verdict {
	left := Outstanding(rows)
	names := make([]string, 0, len(left))
	for i := range left {
		row := &left[i]
		names = append(names, row.ID+"="+row.Status)
	}
	return verdict("I2", len(rows) > 0 && len(left) == 0,
		fmt.Sprintf("%d steps, outstanding: %v", len(rows), names))
}

// reopenedVerdict leaves out the step the retry drill failed and retried on purpose (D3 judges it).
func reopenedVerdict(atReady, final []LedgerRow, drilled string) Verdict {
	reopened := slices.DeleteFunc(Reopened(atReady, final), func(each string) bool {
		return drilled != "" && strings.HasPrefix(each, drilled+" ")
	})
	note := ""
	if drilled != "" {
		note = fmt.Sprintf(" (the retry drill's own step %s left to D3)", drilled)
	}
	return verdict("I2b", len(reopened) == 0, fmt.Sprintf("%d steps done at ready; reopened: %v%s", countDone(atReady), reopened, note))
}

func countDone(rows []LedgerRow) int {
	done := 0
	for i := range rows {
		row := &rows[i]
		if row.Status == "done" {
			done++
		}
	}
	return done
}

func (cell *run) rosterVerdict(ctx context.Context) Verdict {
	out, err := psql(ctx, cell.stores.psqlURL(), `SELECT role || ':' || jsonb_array_length(steps) FROM mydb_upgrade_ledger._langwatch_serving_roster WHERE heartbeat_at > (now() AT TIME ZONE 'UTC') - interval '2 minutes' ORDER BY role`)
	if err != nil {
		return Verdict{ID: "I3", Name: "roster", Result: "inconclusive", Detail: err.Error()}
	}
	rows := strings.Fields(out)
	declares := len(rows) > 0 && !slices.ContainsFunc(rows, func(row string) bool { return strings.HasSuffix(row, ":0") })
	status, _, _ := get(ctx, httpClient, cell.url()+"/readyz")
	return verdict("I3", status == http.StatusOK && declares,
		fmt.Sprintf("/readyz %d; live rows role:steps %v", status, rows))
}

// copyVerdict: copy never move. Every table holds at least the rows it held at the cut.
func (cell *run) copyVerdict(ctx context.Context) Verdict {
	after, err := cell.fingerprint(ctx)
	if err != nil {
		return Verdict{ID: "I4", Name: "copy never move", Result: "inconclusive", Detail: err.Error()}
	}
	return judgeCopy(cell.before, after, cell.retentionAllowance())
}

// judgeCopy fails a table that lost rows, beyond what main's own retention TTL may expire (allowance, R1's slices).
func judgeCopy(before, after snapshot.Fingerprint, allowance map[string]map[string]int64) Verdict {
	var shrunk, expired []string
	for store, tables := range before {
		for table, was := range tables {
			now, ok := after[store][table]
			switch {
			case !ok || now.Count < was.Count-allowance[store][table]:
				shrunk = append(shrunk, fmt.Sprintf("%s.%s %d->%d", store, table, was.Count, now.Count))
			case now.Count < was.Count:
				expired = append(expired, fmt.Sprintf("%s.%s %d->%d (TTL may expire %d)", store, table, was.Count, now.Count, allowance[store][table]))
			}
		}
	}
	tables := make([]string, 0, len(before))
	for store, each := range before {
		tables = append(tables, fmt.Sprintf("%s %d tables", store, len(each)))
	}
	slices.Sort(tables)
	slices.Sort(shrunk)
	detail := fmt.Sprintf("every table counted at the cut and after (%s); shrunk: %v", strings.Join(tables, ", "), shrunk)
	if len(expired) > 0 {
		detail += fmt.Sprintf("; expired by main's own retention TTL only: %v", expired)
	}
	return verdict("I4", len(shrunk) == 0, detail)
}

func (cell *run) readBackVerdict(ctx context.Context) Verdict {
	cell.seeder.PlainWire = true // the reads go to head
	counts, readErr := cell.seeder.Count(ctx)
	err := seed.ExpectedKinds().Check(counts)
	return verdict("I6", err == nil && readErr == nil, fmt.Sprintf("counts %v; %s; refused reads: %.600s", counts, errText(err), errText(readErr)))
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// exitText names a command's outcome: "0" when it succeeded, else its error.
func exitText(err error) string {
	if err == nil {
		return "0"
	}
	return err.Error()
}

// secondRunVerdict: a second upgrade exits 0 and changes no ledger row.
func (cell *run) secondRunVerdict(ctx context.Context, final []LedgerRow) Verdict {
	command := exec.CommandContext(ctx, "node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "src/main.ts", "upgrade") // #nosec G204 -- fixed argv.
	command.Dir, command.Env = filepath.Join(cell.options.HeadDir, "apps", "tasks"), cell.envWith(nil)
	out, err := command.CombinedOutput()
	_ = os.WriteFile(cell.logPath("second-upgrade"), out, 0o600)
	again, ledgerErr := Ledger(ctx, cell.stores)
	changed := Reopened(final, again)
	return verdict("I8", err == nil && ledgerErr == nil && len(changed) == 0,
		fmt.Sprintf("exit %v; changed %v", exitText(err), changed))
}

// acceptedLog is an error signature the lab tolerates, with the reason printed in the report.
// Window limits it to the span between the switch and ready (needs the line's pino "time").
type acceptedLog struct {
	Signature, Reason string
	Window            bool
}

var acceptedLogs = []acceptedLog{
	{"TwilioTunnel: cloudflared exited", "no cloudflared in the lab", false},
	{"UpgradeInProgressError", "expected 503 upgrade_in_progress while steps run", true},
}

var logTime = regexp.MustCompile(`(?:"time":"?|^\[)(\d{13}|\d{4}-\d\d-\d\dT[0-9:.]+Z)`)

// lineEpochMs is a log line's pino time (epoch ms or ISO), and whether it had one.
func lineEpochMs(line string) (int64, bool) {
	match := logTime.FindStringSubmatch(line)
	if match == nil {
		return 0, false
	}
	if epoch, err := strconv.ParseInt(match[1], 10, 64); err == nil {
		return epoch, true
	}
	at, err := time.Parse(time.RFC3339Nano, match[1])
	return at.UnixMilli(), err == nil
}

// accepts answers the accepted entry that covers line, if any; atMs bounds are ms from origin.
func accepts(line string, switched, ready int64, origin time.Time) (acceptedLog, bool) {
	for _, each := range acceptedLogs {
		if !strings.Contains(line, each.Signature) {
			continue
		}
		if !each.Window {
			return each, true
		}
		if epoch, ok := lineEpochMs(line); ok && switched >= 0 && ready >= 0 {
			if at := epoch - origin.UnixMilli(); at >= switched && at <= ready {
				return each, true
			}
		}
	}
	return acceptedLog{}, false
}

// downSignatures: what a line says when it met the private target H8's gate held closed.
var downSignatures = []string{"ClickHouseUnavailableError", "clickhouse_unavailable", "Cannot connect to ClickHouse at", "[@clickhouse/client][Connection]", "read ECONNRESET"}

// downWindowGrace: a query held at the closed gate fails as it reopens, so its line lands just after upAt.
const downWindowGrace = int64(5_000)

// inDownWindow: a ClickHouse-unavailable error line logged while H8's gate held the private target closed (as N2 does).
func inDownWindow(line string, downAt, upAt int64, origin time.Time) bool {
	if upAt <= 0 || !slices.ContainsFunc(downSignatures, func(each string) bool { return strings.Contains(line, each) }) {
		return false
	}
	epoch, ok := lineEpochMs(line)
	return ok && epoch-origin.UnixMilli() >= downAt && epoch-origin.UnixMilli() <= upAt+downWindowGrace
}

// logVerdict counts error lines in head's logs: new ones fail I9, accepted ones are counted apart with their reason.
func (cell *run) logVerdict() Verdict {
	counts, accepted := map[string]int{}, map[string]int{}
	var first []string
	switched, ready := cell.marks["switched"], FirstAt(cell.report.Phases, "ready")
	for _, name := range []string{"head-api", "head-worker"} {
		file, err := os.Open(cell.logPath(name))
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 1<<20), 1<<20)
		for scanner.Scan() {
			line := scanner.Text()
			if !isErrorLine(line) {
				continue
			}
			if each, ok := accepts(line, switched, ready, cell.origin); ok {
				accepted[each.Signature+" ("+each.Reason+")"]++
				continue
			}
			if cell.overlay(OverlayOperatorDamage) && refusalLine(line, ready, cell.origin) {
				accepted["the upgrade refused on planted operator damage (judged by D1 to D3)"]++
				continue
			}
			if inDownWindow(line, cell.down.downAtMs, cell.down.upAtMs, cell.origin) {
				accepted["ClickHouseUnavailableError (the private target H8 closed on purpose; judged by H8)"]++
				continue
			}
			counts[name]++
			first = appendDistinct(first, fmt.Sprintf("%s: %.160s", name, line))
		}
		_ = file.Close()
	}
	return verdict("I9", len(counts) == 0, fmt.Sprintf("new %v; first: %v; accepted: %v", counts, first, accepted))
}

func isErrorLine(line string) bool {
	return strings.Contains(line, `"level":"error"`) || strings.Contains(line, `"level":50`) || strings.Contains(line, "ERROR")
}

func appendDistinct(lines []string, line string) []string {
	if len(lines) >= 5 || slices.Contains(lines, line) {
		return lines
	}
	return append(lines, line)
}

// apiEarlyVerdict: head's api answers before the upgrade is done (before ready), so it is up as soon as it can be.
func (cell *run) apiEarlyVerdict() Verdict {
	started, ready := cell.marks["headApiStarted"], FirstAt(cell.report.Phases, "ready")
	answered := int64(-1)
	for _, change := range cell.report.Phases {
		if change.Phase != "down" {
			answered = change.AtMs
			break
		}
	}
	return verdict("N1", answered >= 0 && answered < ready,
		fmt.Sprintf("head api started %d ms, first answered %d ms, ready (upgrade done) %d ms, balancer switched %d ms, old release stopped %d ms",
			started, answered, ready, cell.marks["switched"], cell.marks["fromStopped"]))
}

// unansweredVerdict: no call met a closed door (refused, reset, or no release behind the balancer).
func unansweredVerdict(calls []Call) Verdict {
	unanswered := map[string]int{}
	for index := range calls {
		if calls[index].Status == 0 {
			unanswered[calls[index].Kind]++
		}
	}
	return verdict("N6", len(unanswered) == 0, fmt.Sprintf("unanswered per kind: %v", unanswered))
}

// droppedVerdict (N2) leaves out the down organization's failed calls inside the H8 window: H8 judges those.
func droppedVerdict(summaries []KindSummary, excused int) Verdict {
	failed, sent, retries, window := 0, 0, 0, int64(0)
	var detail []string
	for i := range summaries {
		each := &summaries[i]
		failed += each.Failed
		sent += each.Sent
		retries += each.Retries
		window = max(window, each.MaxRetryWindowMs)
		if each.Failed > 0 {
			detail = append(detail, fmt.Sprintf("%s %d/%d", each.Kind, each.Failed, each.Sent))
		}
	}
	return verdict("N2", failed-excused <= 0, fmt.Sprintf("%d of %d failed: %v, of them %d the down organization's inside the H8 window (left to H8); %d upgrade_in_progress retries, longest retry window %d ms", failed, sent, detail, excused, retries, window))
}

// lostByPhase notes, per kind, which api phase each lost write was sent in, and its first and last ms.
func lostByPhase(calls []Call, phases []PhaseChange, visible map[string]bool) []string {
	type span struct {
		phases      map[string]int
		first, last int64
	}
	lost := map[string]*span{}
	for i := range calls {
		call := &calls[i]
		if !call.Write || !call.ok() || visible[call.Kind+"/"+call.ID] {
			continue
		}
		each := lost[call.Kind]
		if each == nil {
			each = &span{phases: map[string]int{}, first: call.AtMs}
			lost[call.Kind] = each
		}
		each.phases[PhaseAt(phases, call.AtMs)]++
		each.first, each.last = min(each.first, call.AtMs), max(each.last, call.AtMs)
	}
	var notes []string
	for _, kind := range slices.Sorted(maps.Keys(lost)) {
		notes = append(notes, fmt.Sprintf("lost %s by phase sent %v, sent from %d to %d ms", kind, lost[kind].phases, lost[kind].first, lost[kind].last))
	}
	return notes
}

func lostVerdict(summaries []KindSummary) Verdict {
	lost := 0
	var detail []string
	for i := range summaries {
		each := &summaries[i]
		lost += each.Lost
		if each.Lost > 0 {
			detail = append(detail, fmt.Sprintf("%s %d", each.Kind, each.Lost))
		}
	}
	return verdict("N3", lost == 0, fmt.Sprintf("%d lost: %v", lost, detail))
}

func (cell *run) queueSummary(ctx context.Context) QueueSummary {
	cell.queueMu.Lock()
	samples, reads := append([]QueueSample(nil), cell.queue...), cell.queueReads
	cell.queueMu.Unlock()
	summary := summariseQueue(samples, cell.marks["headWorkerStarted"])
	summary.AtCut, summary.ReadErrors, summary.FirstError = cell.cutDepth, reads.failed, reads.first
	summary.ByQueue = QueueBreakdown(ctx, cell.stores.RedisPort)
	byKind, stop := context.WithTimeout(ctx, 2*time.Minute) // one SCAN of the group keys, bounded at a deep backlog
	defer stop()
	summary.ByKind = QueueByKind(byKind, cell.stores.RedisPort)
	return summary
}

// queueReads counts failed depth reads and keeps the first, so a blind probe cannot read as an empty queue.
type queueReads struct {
	failed int
	first  string
}

func (reads *queueReads) fail(err error) {
	if reads.failed++; reads.first == "" {
		reads.first = err.Error()
	}
}

// queueSlack is the backlog live traffic keeps on top of the baseline. The baseline is 0: the depth
// before the cut is the restored backlog itself, so it says nothing about the steady state.
const (
	queueSlack  = 100
	queueBase   = 0
	slopeWindow = int64(10 * 60 * 1000)
)

func drainLimit(baseline int) int { return baseline + queueSlack }

// queueSlope is the change in jobs per minute over the last ten minutes of readings.
func queueSlope(samples []QueueSample) float64 {
	if len(samples) < 2 {
		return 0
	}
	last := samples[len(samples)-1]
	first := last
	for _, sample := range samples {
		if sample.AtMs >= last.AtMs-slopeWindow {
			first = sample
			break
		}
	}
	if last.AtMs == first.AtMs {
		return 0
	}
	return float64(last.Depth-first.Depth) / (float64(last.AtMs-first.AtMs) / 60000)
}

// summariseQueue finds the peak and when, after head's worker started, the depth fell within the
// limit and stayed there to the last reading (-1: never, or it grew again).
func summariseQueue(samples []QueueSample, workerAt int64) QueueSummary {
	summary := QueueSummary{Samples: samples, Baseline: queueBase, DrainedMs: -1, Final: -1, SlopePerMin: queueSlope(samples)}
	summary.Limit = drainLimit(summary.Baseline)
	for _, sample := range samples {
		if sample.Depth > summary.Peak {
			summary.Peak, summary.PeakAtMs = sample.Depth, sample.AtMs
		}
		switch {
		case workerAt <= 0 || sample.AtMs < workerAt:
		case sample.Depth > summary.Limit:
			summary.DrainedMs = -1
		case summary.DrainedMs < 0:
			summary.DrainedMs = sample.AtMs - workerAt
		}
	}
	if len(samples) > 0 {
		summary.Final, summary.FinalNotDue = samples[len(samples)-1].Depth, samples[len(samples)-1].NotDue
	}
	return summary
}

// queueVerdict: the jobs present at the cut were handled, so the depth fell within the slack of the
// baseline after head's worker started and stayed there to the end.
func queueVerdict(queue QueueSummary) Verdict {
	drained := queue.DrainedMs >= 0 && queue.Final >= 0 && queue.Final <= queue.Limit
	return verdict("N4", drained,
		fmt.Sprintf("group-queue jobs: baseline %d (limit %d), %d at the cut (-1: unread), peak %d at %d ms, at baseline and staying there %d ms after head's worker started (-1: never), %d due at the end (-1: no reading; %d more scheduled later, not counted), slope over the last 10 min %.1f jobs/min; %d of %d reads failed%s",
			queue.Baseline, queue.Limit, queue.AtCut, queue.Peak, queue.PeakAtMs, queue.DrainedMs, queue.Final, queue.FinalNotDue, queue.SlopePerMin, queue.ReadErrors, queue.ReadErrors+len(queue.Samples), errSuffix(queue.FirstError)))
}

// opsVerdict: the Upgrades page answered a state, and after settle a finished one.
// opsVerdict: the settled page agrees with the ledger, "Finishing in background" while steps remain.
func (cell *run) opsVerdict(final []LedgerRow) Verdict {
	if !cell.options.Shots {
		return Verdict{ID: "O1", Name: "Ops > Upgrades shows the right state", Result: "inconclusive", Detail: "-shots off"}
	}
	cell.shoot(context.Background(), "settled")
	states := map[string]string{}
	for _, shot := range cell.report.Shots {
		states[shot.Phase] = shot.State + errSuffix(shot.Error)
	}
	want := "Up to date"
	if len(Outstanding(final)) > 0 {
		want = "Finishing in background"
	} else if (cell.overlay(OverlayTenantOddities) || cell.overlay(OverlayHeldTenants)) && cell.odd.err == nil {
		want = "Needs attention" // the planted held organization (A1)
	}
	return verdict("O1", states["settled"] == want, fmt.Sprintf("want %q settled; state by phase: %v", want, states))
}

func errSuffix(err string) string {
	if err == "" || err == "<nil>" {
		return ""
	}
	return " (" + err + ")"
}

// visibleWrites asks the stores and head's API which write ids exist after settle.
func (cell *run) visibleWrites(ctx context.Context) (map[string]bool, error) {
	stored, err := StoredIDs(ctx, cell.stores, "", cell.client.Project)
	if err != nil {
		return nil, err
	}
	privateStored := map[string]map[string]bool{}
	if cell.privateTraffic != nil {
		private, err := StoredIDs(ctx, cell.stores, cell.privateLabel, cell.privateTraffic.Client.Project)
		if err != nil {
			return nil, err
		}
		privateStored = private
	}
	otherStored := map[string]map[string]bool{}
	if cell.otherPrivate != nil {
		if otherStored, err = StoredIDs(ctx, cell.stores, cell.otherPrivateLabel, cell.otherPrivate.Client.Project); err != nil {
			return nil, err
		}
	}
	visible := map[string]bool{}
	seen := evidence{stored: stored, versions: cell.promptVersions(ctx)}
	callsRange := cell.allCalls()
	for i := range callsRange {
		call := &callsRange[i]
		if !call.Write || !call.ok() {
			continue
		}
		if strings.HasPrefix(call.Kind, otherPrivatePrefix) {
			visible[call.Kind+"/"+call.ID] = otherStored[storedTable[strings.TrimPrefix(call.Kind, otherPrivatePrefix)]][call.ID]
			continue
		}
		if strings.HasPrefix(call.Kind, privatePrefix) {
			visible[call.Kind+"/"+call.ID] = cell.privateVisible(ctx, *call, privateStored)
			continue
		}
		visible[call.Kind+"/"+call.ID] = cell.isVisible(ctx, *call, seen)
	}
	return visible, nil
}

// evidence is what settle left: ClickHouse ids per table, and the base prompt's versions.
type evidence struct {
	stored   map[string]map[string]bool
	versions string
}

func (cell *run) isVisible(ctx context.Context, call Call, seen evidence) bool {
	if table := storedTable[call.Kind]; table != "" {
		return seen.stored[table][call.ID]
	}
	switch call.Kind {
	case "prompt-update":
		return strings.Contains(seen.versions, call.ID)
	case "prompt-create":
		return cell.found(ctx, "/api/prompts/"+call.ID)
	case "dataset-create":
		return cell.found(ctx, "/api/dataset/"+call.ID)
	}
	return false
}

func (cell *run) promptVersions(ctx context.Context) string {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, cell.url()+"/api/prompts/"+cell.client.BasePrompt+"/versions", http.NoBody)
	if err != nil {
		return ""
	}
	request.Header.Set("X-Auth-Token", cell.client.APIKey)
	response, err := httpClient.Do(request)
	if err != nil {
		return ""
	}
	defer func() { _ = response.Body.Close() }()
	var body strings.Builder
	_, _ = bufio.NewReader(response.Body).WriteTo(&body)
	return body.String()
}

func (cell *run) found(ctx context.Context, path string) bool {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, cell.url()+path, http.NoBody)
	if err != nil {
		return false
	}
	request.Header.Set("X-Auth-Token", cell.client.APIKey)
	response, err := httpClient.Do(request)
	if err != nil {
		return false
	}
	_ = response.Body.Close()
	return response.StatusCode == http.StatusOK
}

// hybridVerdicts: each tenant's telemetry lands only on its own target, and the upgrade applied every target.
func (cell *run) hybridVerdicts(ctx context.Context) []Verdict {
	if len(cell.private) == 0 {
		return nil
	}
	verdicts := append(cell.placementVerdicts(ctx), cell.targetsVerdict(ctx))
	verdicts = append(verdicts, cell.isolationVerdicts(ctx)...)
	if cell.drill(DrillRouteBroken) {
		verdicts = append(verdicts, cell.routeVerdict())
	}
	if cell.drill(DrillPrivateDown) {
		verdicts = append(verdicts, cell.downVerdict(ctx))
	}
	return append(verdicts, cell.dataplanesVerdict(ctx))
}

// homes maps each private organization and its projects to its target label; an absent tenant is shared ("").
func (cell *run) homes() map[string]string {
	home := map[string]string{}
	for label, organization := range cell.private {
		home[organization] = label // organization-level events (event_log) carry the organization as tenant
		for _, project := range cell.tenancy.ProjectsOf(organization) {
			home[project] = label
		}
	}
	return home
}

func (cell *run) targetsVerdict(ctx context.Context) Verdict {
	out, err := psql(ctx, cell.stores.psqlURL(), `SELECT target || ':' || count(*) FILTER (WHERE status NOT IN ('done', 'not-needed')) || '/' || count(*) FROM mydb_upgrade_ledger._langwatch_upgrade_target GROUP BY target ORDER BY target`)
	if err != nil {
		return Verdict{ID: "H2", Name: "the upgrade applied every ClickHouse target", Result: "inconclusive", Detail: err.Error()}
	}
	rows := strings.Fields(out)
	open := slices.ContainsFunc(rows, func(row string) bool { return !strings.Contains(row, ":0/") })
	return verdict("H2", len(rows) == 1+len(cell.private) && !open,
		fmt.Sprintf("target:open/steps %v, want %d targets", rows, 1+len(cell.private)))
}

// browserVerdict: the signed-in walk saw no console error and no failed request outside the accepted list.
func (cell *run) browserVerdict() Verdict {
	// upgrade_in_progress stays expected after ready while H8's private target catches up (T7-F18).
	stepsRunUntil := max(FirstAt(cell.report.Phases, "ready"), cell.down.caughtMs)
	walks, expected, tolerated, findings, err := BrowserFindings(filepath.Join(cell.options.RunDir, "browser.jsonl"), cell.marks["switched"], stepsRunUntil, cell.profile.StopStart)
	if err != nil || walks == 0 {
		return Verdict{ID: "B1", Name: invariantNames["B1"], Result: "inconclusive", Detail: fmt.Sprintf("%d completed walks; %s", walks, errText(err))}
	}
	var first []string
	for _, each := range findings[:min(len(findings), 3)] {
		first = append(first, fmt.Sprintf("%s %s %d %.120s at %s (%d ms, %s)", each.Kind, each.URL, each.Status, each.Text, each.Step, each.AtMs, PhaseAt(cell.report.Phases, each.AtMs)))
	}
	return verdict("B1", len(findings) == 0, fmt.Sprintf("%d walks, %d findings (see browser.jsonl); first: %v; accepted: %d 503 upgrade_in_progress with Retry-After (expected while steps run or a private target catches up), other %v", walks, len(findings), first, expected, tolerated))
}

// readModelVerdict (I5): the projections an upgrade must leave filled. Any failed part fails it; a part
// that cannot be judged makes it inconclusive, never a pass.
func (cell *run) readModelVerdict(ctx context.Context) Verdict {
	parts := []Verdict{cell.traceMeterPart(ctx), cell.openSuitesPart(ctx)}
	result, detail := "pass", []string{}
	for _, part := range parts {
		detail = append(detail, part.Name+": "+part.Result+" ("+part.Detail+")")
		if part.Result == "fail" || (part.Result == "inconclusive" && result == "pass") {
			result = part.Result
		}
	}
	return Verdict{ID: "I5", Name: invariantNames["I5"], Result: result, Detail: strings.Join(detail, "; ")}
}

// traceMeterPart compares distinct traces per tenant in usage_trace_meter and trace_summaries on every target.
// Per tenant, not per month: the meter counts the month a span arrived, a snapshot's traces keep older dates.
func (cell *run) traceMeterPart(ctx context.Context) Verdict {
	part := Verdict{Name: "trace meter", Result: "pass"}
	var mismatched []string
	traces := 0
	for _, label := range append([]string{""}, cell.stores.Private...) {
		meter, err1 := tenantTraceCounts(ctx, cell.stores.queryURL(label), monthMeterQuery)
		summaries, err2 := tenantTraceCounts(ctx, cell.stores.queryURL(label), monthTracesQuery)
		if err1 != nil || err2 != nil {
			return Verdict{Name: part.Name, Result: "inconclusive", Detail: errText(err1) + " " + errText(err2)}
		}
		for tenant, count := range summaries {
			if cell.agedOnly(tenant) {
				continue
			}
			traces += count
			if meter[tenant] != count {
				mismatched = append(mismatched, fmt.Sprintf("%s %q meter %d, traces %d", label, tenant, meter[tenant], count))
			}
		}
		for tenant, count := range meter {
			if _, ok := summaries[tenant]; !ok && !cell.agedOnly(tenant) {
				mismatched = append(mismatched, fmt.Sprintf("%s %q meter %d, traces 0", label, tenant, count))
			}
		}
	}
	part.Detail = fmt.Sprintf("%d traces first stored this month; mismatched: %v", traces, mismatched)
	if traces == 0 {
		part.Result, part.Detail = "inconclusive", "no trace on any target to count"
	} else if len(mismatched) > 0 {
		part.Result = "fail"
	}
	return part
}

// The meter holds one row per project, UTC month and trace; a trace counts in the month it was first stored.
const (
	monthMeterQuery  = "SELECT TenantId, uniqExact(TraceId) FROM usage_trace_meter WHERE Month = toStartOfMonth(now('UTC')) GROUP BY TenantId FORMAT TSV"
	monthTracesQuery = "SELECT TenantId, count() FROM (SELECT TenantId, TraceId FROM trace_summaries GROUP BY TenantId, TraceId HAVING min(CreatedAt) >= toStartOfMonth(now('UTC'))) GROUP BY TenantId FORMAT TSV"
)

func tenantTraceCounts(ctx context.Context, target, query string) (map[string]int, error) {
	out, err := clickhouseQuery(ctx, target, query)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if tenant, count, found := strings.Cut(line, "\t"); found {
			counts[tenant], _ = strconv.Atoi(count)
		}
	}
	return counts, nil
}

// openSuitesPart reports the suite runs by status. The cell starts no suite run on main yet, so there is no
// expected count to compare: inconclusive until traffic does (plan 8.1, workerrun stream).
func (cell *run) openSuitesPart(ctx context.Context) Verdict {
	out, err := clickhouseQuery(ctx, cell.stores.queryURL(""), "SELECT Status, count() FROM suite_runs FINAL GROUP BY Status ORDER BY Status FORMAT TSV")
	if err != nil {
		return Verdict{Name: "open suite runs", Result: "inconclusive", Detail: err.Error()}
	}
	return Verdict{Name: "open suite runs", Result: "inconclusive", Detail: fmt.Sprintf("by status %q; no started-run count to compare yet", strings.ReplaceAll(strings.TrimSpace(out), "\n", ", "))}
}

// storedEventsVerdict (I7): head's worker parses every stored event on every ClickHouse target under
// its schemas and upcasts (apps/worker/src/__tests__/stored-events-parse.integration.test.ts).
func (cell *run) storedEventsVerdict(ctx context.Context) Verdict {
	var urls []string
	for _, label := range append([]string{""}, cell.stores.Private...) {
		urls = append(urls, cell.stores.ClickHouseURL(label))
	}
	reportPath := filepath.Join(cell.options.RunDir, "stored-events.json")
	_ = os.Remove(reportPath)
	command := exec.CommandContext(ctx, "pnpm", "--filter", "@langwatch/worker", "test:integration", "src/__tests__/stored-events-parse.integration.test.ts") // #nosec G204 -- fixed argv.
	command.Dir = cell.options.HeadDir
	command.Env = cell.envWith(map[string]string{
		"STORED_EVENTS_CLICKHOUSE_URLS": strings.Join(urls, ","),
		"STORED_EVENTS_REPORT":          reportPath,
		"VITEST_MAX_WORKERS":            "2",
		"NX_DAEMON":                     "false", // the suite's setup builds through nx; a daemon would outlive the cell
	})
	out, runErr := command.CombinedOutput()
	_ = os.WriteFile(cell.logPath("stored-events"), out, 0o600)
	report, readErr := os.ReadFile(reportPath) // #nosec G304 -- the cell's own run directory.
	if readErr != nil {
		report = nil
	}
	return storedEventsJudgement(report, runErr)
}

// storedEventsJudgement reads the parse report: zero refused groups pass, any fail by name, and a
// run that wrote no readable report is inconclusive.
func storedEventsJudgement(report []byte, runErr error) Verdict {
	const name = "every stored event parses under head's schemas and upcasts"
	var parsed struct {
		Targets int `json:"targets"`
		Refused []struct {
			Target, AggregateType, EventType, EventVersion, Reason, ExampleEventID string
			Refused, Sampled, Stored                                               int
		} `json:"refused"`
	}
	if report == nil || json.Unmarshal(report, &parsed) != nil {
		return Verdict{ID: "I7", Name: name, Result: "inconclusive", Detail: "no parse report (see stored-events.log): " + errText(runErr)}
	}
	var groups []string
	for _, each := range parsed.Refused {
		groups = append(groups, fmt.Sprintf("%s %s/%s@%s %s %d/%d (stored %d, e.g. %s)", each.Target, each.AggregateType, each.EventType, each.EventVersion, each.Reason, each.Refused, each.Sampled, each.Stored, each.ExampleEventID))
	}
	result := verdict("I7", len(groups) == 0, fmt.Sprintf("%d targets; refused groups: %v", parsed.Targets, groups))
	if len(groups) == 0 && runErr != nil {
		result = Verdict{ID: "I7", Result: "inconclusive", Detail: "report has no refusal but the run failed (see stored-events.log): " + errText(runErr)}
	}
	result.Name = name
	return result
}
