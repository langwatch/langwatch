package cell

import (
	"bufio"
	"context"
	"fmt"
	"maps"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/seed"
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
		cell.holdingVerdict(), ledgerVerdict(final), reopenedVerdict(cell.atReady, final), cell.rosterVerdict(ctx),
		cell.copyVerdict(ctx), cell.readBackVerdict(ctx), cell.secondRunVerdict(ctx, final), cell.logVerdict(),
		cell.apiEarlyVerdict(), cell.crashVerdict(), droppedVerdict(cell.report.Traffic), ingestVerdict(cell.report.Traffic), unansweredVerdict(cell.allCalls()), lostVerdict(cell.report.Traffic), cell.queueVerdict(), cell.opsVerdict(final))
	cell.report.Verdicts = append(cell.report.Verdicts, cell.hybridVerdicts(ctx)...)
	cell.report.Verdicts = append(cell.report.Verdicts, cell.drillVerdicts(final)...)
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
	for _, each := range summaries {
		if storedTable[each.Kind] != "" && each.NonOK > 0 {
			seen = append(seen, fmt.Sprintf("%s %d", each.Kind, each.NonOK))
		}
	}
	return verdict("N5", len(seen) == 0, fmt.Sprintf("non-2xx answers per ingest kind: %v", seen))
}

func ledgerVerdict(rows []LedgerRow) Verdict {
	left := Outstanding(rows)
	names := make([]string, 0, len(left))
	for _, row := range left {
		names = append(names, row.ID+"="+row.Status)
	}
	return verdict("I2", len(rows) > 0 && len(left) == 0,
		fmt.Sprintf("%d steps, outstanding: %v", len(rows), names))
}

func reopenedVerdict(atReady, final []LedgerRow) Verdict {
	reopened := Reopened(atReady, final)
	return verdict("I2b", len(reopened) == 0, fmt.Sprintf("%d steps done at ready; reopened: %v", countDone(atReady), reopened))
}

func countDone(rows []LedgerRow) int {
	done := 0
	for _, row := range rows {
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
	var shrunk []string
	for store, tables := range cell.before {
		for table, before := range tables {
			if now, ok := after[store][table]; !ok || now.Count < before.Count {
				shrunk = append(shrunk, fmt.Sprintf("%s.%s %d->%d", store, table, before.Count, now.Count))
			}
		}
	}
	return verdict("I4", len(shrunk) == 0, fmt.Sprintf("%d stores fingerprinted; shrunk: %v", len(cell.before), shrunk))
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

// secondRunVerdict: a second upgrade exits 0 and changes no ledger row.
func (cell *run) secondRunVerdict(ctx context.Context, final []LedgerRow) Verdict {
	command := exec.CommandContext(ctx, "node", "--experimental-transform-types", "src/main.ts", "upgrade") // #nosec G204 -- fixed argv.
	command.Dir, command.Env = filepath.Join(cell.options.HeadDir, "apps", "tasks"), cell.envWith(nil)
	out, err := command.CombinedOutput()
	_ = os.WriteFile(cell.logPath("second-upgrade"), out, 0o600)
	again, ledgerErr := Ledger(ctx, cell.stores)
	changed := Reopened(final, again)
	return verdict("I8", err == nil && ledgerErr == nil && len(changed) == 0,
		fmt.Sprintf("exit %v; changed %v", errText(err), changed))
}

// logVerdict counts error lines in head's logs; today's count is the baseline (accepted list: none yet).
func (cell *run) logVerdict() Verdict {
	counts := map[string]int{}
	var first []string
	for _, name := range []string{"head-api", "head-worker"} {
		file, err := os.Open(cell.logPath(name))
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 1<<20), 1<<20)
		for scanner.Scan() {
			if line := scanner.Text(); isErrorLine(line) {
				counts[name]++
				first = appendDistinct(first, fmt.Sprintf("%s: %.160s", name, line))
			}
		}
		_ = file.Close()
	}
	return verdict("I9", len(counts) == 0, fmt.Sprintf("%v; first: %v", counts, first))
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

func droppedVerdict(summaries []KindSummary) Verdict {
	failed, sent, retries, window := 0, 0, 0, int64(0)
	var detail []string
	for _, each := range summaries {
		failed += each.Failed
		sent += each.Sent
		retries += each.Retries
		window = max(window, each.MaxRetryWindowMs)
		if each.Failed > 0 {
			detail = append(detail, fmt.Sprintf("%s %d/%d", each.Kind, each.Failed, each.Sent))
		}
	}
	return verdict("N2", failed == 0, fmt.Sprintf("%d of %d failed: %v; %d upgrade_in_progress retries, longest retry window %d ms", failed, sent, detail, retries, window))
}

// lostByPhase notes, per kind, which api phase each lost write was sent in, and its first and last ms.
func lostByPhase(calls []Call, phases []PhaseChange, visible map[string]bool) []string {
	type span struct {
		phases      map[string]int
		first, last int64
	}
	lost := map[string]*span{}
	for _, call := range calls {
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
	for _, each := range summaries {
		lost += each.Lost
		if each.Lost > 0 {
			detail = append(detail, fmt.Sprintf("%s %d", each.Kind, each.Lost))
		}
	}
	return verdict("N3", lost == 0, fmt.Sprintf("%d lost: %v", lost, detail))
}

func (cell *run) queueSummary(ctx context.Context) QueueSummary {
	cell.queueMu.Lock()
	samples := append([]QueueSample(nil), cell.queue...)
	cell.queueMu.Unlock()
	summary := QueueSummary{Samples: samples, DrainedMs: -1, TopKeys: TopQueueKeys(ctx, cell.stores.RedisPort), ByKind: QueueByKind(ctx, cell.stores.RedisPort)}
	worker := cell.marks["headWorkerStarted"]
	for _, sample := range samples {
		if sample.AtMs < cell.marks["fromWorkerPaused"] {
			summary.Baseline = max(summary.Baseline, sample.Depth)
		}
		if sample.Depth > summary.Peak {
			summary.Peak, summary.PeakAtMs = sample.Depth, sample.AtMs
		}
		if summary.DrainedMs < 0 && sample.AtMs > max(worker, summary.PeakAtMs) && sample.Depth <= summary.Baseline {
			summary.DrainedMs = sample.AtMs - worker
		}
	}
	return summary
}

func (cell *run) queueVerdict() Verdict {
	queue := cell.report.Queue
	return verdict("N4", queue.DrainedMs >= 0,
		fmt.Sprintf("baseline %d, peak %d at %d ms, drained %d ms after the worker started", queue.Baseline, queue.Peak, queue.PeakAtMs, queue.DrainedMs))
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
	privateSpans := map[string]bool{}
	if cell.privateTraffic != nil {
		private, err := StoredIDs(ctx, cell.stores, cell.privateLabel, cell.privateTraffic.Client.Project)
		if err != nil {
			return nil, err
		}
		privateSpans = private["spans"]
	}
	visible := map[string]bool{}
	seen := evidence{stored: stored, versions: cell.promptVersions(ctx)}
	for _, call := range cell.allCalls() {
		if !call.Write || !call.ok() {
			continue
		}
		if strings.HasPrefix(call.Kind, privatePrefix) {
			visible[call.Kind+"/"+call.ID] = cell.privateVisible(ctx, call, privateSpans)
			continue
		}
		visible[call.Kind+"/"+call.ID] = cell.isVisible(ctx, call, seen)
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
	misplaced, err := cell.misplacedTenants(ctx)
	placement := verdict("H1", len(misplaced) == 0 && err == nil, fmt.Sprintf("misplaced: %v %s", misplaced, errText(err)))
	return append([]Verdict{placement, cell.targetsVerdict(ctx)}, cell.isolationVerdicts(ctx)...)
}

// misplacedTenants names every tenant found on a target other than its own.
func (cell *run) misplacedTenants(ctx context.Context) ([]string, error) {
	home := cell.homes()
	var misplaced []string
	for _, label := range append([]string{""}, cell.stores.Private...) {
		tenants, err := tenantsOn(ctx, cell.stores.queryURL(label))
		if err != nil {
			return misplaced, err
		}
		for tenant := range tenants {
			if home[tenant] != label {
				misplaced = append(misplaced, fmt.Sprintf("%s on %q, home %q", tenant, label, home[tenant]))
			}
		}
	}
	return misplaced, nil
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

// tenantsOn lists the TenantIds holding spans or events on one ClickHouse target.
func tenantsOn(ctx context.Context, target string) (map[string]bool, error) {
	out, err := clickhouseQuery(ctx, target, "SELECT DISTINCT TenantId FROM (SELECT TenantId FROM stored_spans UNION ALL SELECT TenantId FROM event_log) FORMAT TSV")
	tenants := map[string]bool{}
	for _, tenant := range strings.Fields(out) {
		tenants[tenant] = true
	}
	return tenants, err
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
