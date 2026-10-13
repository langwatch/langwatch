package cell

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// PhaseChange is what the api answered from AtMs on (down, holding:<phase>, ready).
type PhaseChange struct {
	Phase string `json:"phase"`
	AtMs  int64  `json:"atMs"`
}

var holdingPhase = regexp.MustCompile(`Phase: <strong>([^<]+)</strong>`)

// PhaseOf reads one probe: no answer is down, /readyz 200 is ready, else the holding page's phase.
func PhaseOf(ready int, page string, reached bool) string {
	switch {
	case !reached:
		return "down"
	case ready == http.StatusOK:
		return "ready"
	}
	if match := holdingPhase.FindStringSubmatch(page); match != nil {
		return "holding:" + match[1]
	}
	return "not-ready"
}

// Poller records the api's phase every Every from the switch on.
type Poller struct {
	URL    string
	Origin time.Time
	Every  time.Duration

	Notify    chan string // each new phase, for whoever screenshots it; a full channel drops it
	PhaseFile string      // when set, each new phase is written here for the browser walker

	mu      sync.Mutex
	changes []PhaseChange
}

// Run polls until ctx ends.
func (poller *Poller) Run(ctx context.Context) {
	client := &http.Client{Timeout: 5 * time.Second}
	ticker := time.NewTicker(poller.Every)
	defer ticker.Stop()
	for {
		poller.observe(PhaseOf(probe(ctx, client, poller.URL)))
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func probe(ctx context.Context, client *http.Client, base string) (int, string, bool) {
	ready, _, err := get(ctx, client, base+"/readyz")
	if err != nil {
		return 0, "", false
	}
	_, page, _ := get(ctx, client, base+"/")
	return ready, page, true
}

// get asks as a browser does (Accept: text/html), so a holding api answers its page.
func get(ctx context.Context, client *http.Client, target string) (int, string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, http.NoBody)
	if err != nil {
		return 0, "", err
	}
	request.Header.Set("Accept", "text/html")
	response, err := client.Do(request)
	if err != nil {
		return 0, "", err
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	return response.StatusCode, string(body), err
}

func (poller *Poller) observe(phase string) {
	poller.mu.Lock()
	defer poller.mu.Unlock()
	if n := len(poller.changes); n > 0 && poller.changes[n-1].Phase == phase {
		return
	}
	poller.changes = append(poller.changes, PhaseChange{Phase: phase, AtMs: time.Since(poller.Origin).Milliseconds()})
	if poller.PhaseFile != "" {
		_ = os.WriteFile(poller.PhaseFile, []byte(phase), 0o600)
	}
	select {
	case poller.Notify <- phase:
	default:
	}
}

// Timeline is every change so far.
func (poller *Poller) Timeline() []PhaseChange {
	poller.mu.Lock()
	defer poller.mu.Unlock()
	return append([]PhaseChange(nil), poller.changes...)
}

// FirstAt is when phase was first seen (prefix match), or -1.
func FirstAt(timeline []PhaseChange, phase string) int64 {
	for _, change := range timeline {
		if strings.HasPrefix(change.Phase, phase) {
			return change.AtMs
		}
	}
	return -1
}

// PhaseAt is the phase in force at atMs; before the first change it is "main".
func PhaseAt(timeline []PhaseChange, atMs int64) string {
	phase := "main"
	for _, change := range timeline {
		if change.AtMs > atMs {
			break
		}
		phase = change.Phase
	}
	return phase
}

// QueueSample is one reading of the group queues' waiting jobs.
type QueueSample struct {
	AtMs   int64 `json:"atMs"`
	Depth  int   `json:"depth"`            // jobs due now
	NotDue int   `json:"notDue,omitempty"` // jobs scheduled later, left out of Depth
}

type queueKind struct {
	jobs, groups     int
	earliest, latest float64
}

func groupQueueKinds(out string, nowMs int64) string {
	kinds := map[string]*queueKind{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 4 {
			continue
		}
		parts := strings.Split(strings.TrimSuffix(fields[0][strings.Index(fields[0], ":gq:group:")+len(":gq:group:"):], ":jobs"), "/")
		if len(parts) < 3 {
			continue
		}
		name := strings.Join(parts[1:len(parts)-1], "/")
		jobs, _ := strconv.Atoi(fields[1])
		first, _ := strconv.ParseFloat(fields[2], 64)
		last, _ := strconv.ParseFloat(fields[3], 64)
		kind := kinds[name]
		if kind == nil {
			kind = &queueKind{earliest: first, latest: last}
			kinds[name] = kind
		}
		kind.jobs, kind.groups = kind.jobs+jobs, kind.groups+1
		kind.earliest, kind.latest = min(kind.earliest, first), max(kind.latest, last)
	}
	names := make([]string, 0, len(kinds))
	for name := range kinds {
		names = append(names, name)
	}
	sort.Slice(names, func(a, b int) bool { return kinds[names[a]].jobs > kinds[names[b]].jobs })
	rows := []string{}
	for _, name := range names {
		kind := kinds[name]
		rows = append(rows, fmt.Sprintf("%s: %d jobs in %d groups, due %+.0f s to %+.0f s", name, kind.jobs, kind.groups,
			(kind.earliest-float64(nowMs))/1000, (kind.latest-float64(nowMs))/1000))
	}
	return strings.Join(rows, "\n")
}

// clickhouseQuery posts one statement to a server or database URL and answers its TSV.
func clickhouseQuery(ctx context.Context, target, statement string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target, strings.NewReader(statement))
	if err != nil {
		return "", err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("clickhouse: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("clickhouse %.60s answered %d: %.300s", statement, response.StatusCode, body)
	}
	return string(body), nil
}

func clickhouseExec(ctx context.Context, server, statement string) error {
	_, err := clickhouseQuery(ctx, server+"/", statement)
	return err
}

// StoredIDs answers which of the ids each ingest kind wrote are on one ClickHouse target for the project.
func StoredIDs(ctx context.Context, stores Stores, label, project string) (map[string]map[string]bool, error) {
	queries := map[string]string{
		"spans":   "SELECT DISTINCT TraceId FROM stored_spans WHERE TenantId = '%s' FORMAT TSV",
		"logs":    "SELECT DISTINCT WireTraceId FROM log_records WHERE TenantId = '%s' FORMAT TSV",
		"metrics": "SELECT DISTINCT MetricName FROM metric_data_points WHERE TenantId = '%s' FORMAT TSV",
	}
	found := map[string]map[string]bool{}
	for name, query := range queries {
		out, err := clickhouseQuery(ctx, stores.queryURL(label), fmt.Sprintf(query, strings.ReplaceAll(project, "'", "")))
		if err != nil {
			return nil, err
		}
		found[name] = map[string]bool{}
		for _, line := range strings.Fields(out) {
			found[name][line] = true
		}
	}
	return found, nil
}

// storedTable is where an ingest kind's id lands.
var storedTable = map[string]string{"otlp-trace": "spans", "collector": "spans", "collector-eval": "spans", "otlp-log": "logs", "otlp-metric": "metrics"}

// LedgerRow is one step of the upgrade ledger, as far as the invariants read it.
type LedgerRow struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Mode     string `json:"mode"`
	Status   string `json:"status"`
	Attempt  int    `json:"attempt"`
	Finished string `json:"finished_at"`
	Started  string `json:"started_at"`
	// Report is the step's own JSON report; F1 reads the row counts a data step names there.
	Report json.RawMessage `json:"report,omitempty"`
}

// Ledger reads every step row; a missing ledger schema is an empty ledger.
func Ledger(ctx context.Context, stores Stores) ([]LedgerRow, error) {
	out, err := psql(ctx, stores.psqlURL(), `SELECT coalesce(json_agg(json_build_object('id', id, 'kind', kind, 'mode', mode, 'status', status, 'attempt', attempt, 'finished_at', finished_at::text, 'started_at', started_at::text, 'report', report) ORDER BY id), '[]') FROM mydb_upgrade_ledger._langwatch_upgrade_step`)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return nil, nil
		}
		return nil, err
	}
	var rows []LedgerRow
	err = json.Unmarshal([]byte(out), &rows)
	return rows, err
}

// Outstanding is every step not done or not-needed, operator steps aside (an operator starts those).
func Outstanding(rows []LedgerRow) []LedgerRow {
	var left []LedgerRow
	for i := range rows {
		row := &rows[i]
		if row.Status != "done" && row.Status != "not-needed" && row.Mode != "operator" {
			left = append(left, *row)
		}
	}
	return left
}

// Reopened is every step done in before that is not done, or ran again, in after.
func Reopened(before, after []LedgerRow) []string {
	index := map[string]LedgerRow{}
	for i := range after {
		row := &after[i]
		index[row.ID] = *row
	}
	var reopened []string
	for i := range before {
		row := &before[i]
		now, ok := index[row.ID]
		if row.Status == "done" && (!ok || now.Status != "done" || now.Attempt != row.Attempt || now.Finished != row.Finished) {
			reopened = append(reopened, fmt.Sprintf("%s %s/%d -> %s/%d", row.ID, row.Status, row.Attempt, now.Status, now.Attempt))
		}
	}
	return reopened
}

//go:embed walk.mjs
var walkScript []byte

// Walker is the browser walk (walk.mjs) running beside the cell until Stop.
type Walker struct {
	command *exec.Cmd
	stop    string
	done    chan struct{}
}

// WalkSpec is what the walk needs: head's apps/ui as Dir, the balancer as URL, the seed account.
type WalkSpec struct {
	Dir, RunDir, URL, Email, Password string
	Origin                            time.Time
	Every                             time.Duration
}

// StartWalker writes walk.mjs into the run dir and starts it; a start error is the caller's note, not a failure.
func StartWalker(ctx context.Context, spec WalkSpec) (*Walker, error) {
	script := filepath.Join(spec.RunDir, "walk.mjs")
	if err := os.WriteFile(script, walkScript, 0o600); err != nil {
		return nil, err
	}
	if spec.Every <= 0 {
		spec.Every = 10 * time.Second
	}
	args, _ := json.Marshal(map[string]any{"url": spec.URL, "email": spec.Email, "password": spec.Password, "runDir": spec.RunDir, "originMs": spec.Origin.UnixMilli(), "every": spec.Every.Milliseconds()})
	command := exec.CommandContext(ctx, "node", script, string(args)) // #nosec G204 -- harness-written script.
	command.Dir = spec.Dir
	if err := command.Start(); err != nil {
		return nil, fmt.Errorf("start walk: %w", err)
	}
	walker := &Walker{command: command, stop: filepath.Join(spec.RunDir, "walk.stop"), done: make(chan struct{})}
	go func() {
		_ = command.Wait()
		close(walker.done)
	}()
	return walker, nil
}

// Stop asks the walk to finish its round and waits up to grace before killing it.
func (walker *Walker) Stop(grace time.Duration) {
	_ = os.WriteFile(walker.stop, nil, 0o600)
	select {
	case <-walker.done:
	case <-time.After(grace):
		_ = walker.command.Process.Kill()
		<-walker.done
	}
}

// BrowserRecord is one line of browser.jsonl.
type BrowserRecord struct {
	AtMs   int64  `json:"atMs"`
	Phase  string `json:"phase"`
	Kind   string `json:"kind"`
	Step   string `json:"step"`
	URL    string `json:"url"`
	Status int    `json:"status"`
	Text   string `json:"text"`
	// RetryAfter is the response's Retry-After header, empty when absent.
	RetryAfter string `json:"retryAfter"`
}

// expectedWhileStepsRun: a 503 upgrade_in_progress with Retry-After between the switch and ready (ms from start).
func expectedWhileStepsRun(record BrowserRecord, switched, ready int64) bool {
	return record.Kind == "http" && record.Status == http.StatusServiceUnavailable && record.RetryAfter != "" &&
		strings.Contains(record.Text, "upgrade_in_progress") && switched >= 0 && ready >= 0 && record.AtMs >= switched && record.AtMs <= ready
}

// unreadBody prefixes a walk record's text when the page navigated before its body could be read (walk.mjs).
const unreadBody = "body unread"

// unreadUpgrade503: a 503 with Retry-After in the window whose body was gone, on a path that answered a
// readable upgrade_in_progress in the same window: the same answer, read too late.
func unreadUpgrade503(record BrowserRecord, switched, ready int64, upgrading map[string]bool) bool {
	return record.Kind == "http" && record.Status == http.StatusServiceUnavailable && record.RetryAfter != "" &&
		strings.HasPrefix(record.Text, unreadBody) && switched >= 0 && ready >= 0 && record.AtMs >= switched &&
		record.AtMs <= ready && upgrading[pathOf(record.URL)]
}

func pathOf(raw string) string {
	path, _, _ := strings.Cut(raw, "?")
	return path
}

// consoleTwinOf503: the console line Chromium writes for a failed load names no url or code, so it is
// matched by status and window only, and capped at the number of expected 503s it echoes.
func consoleTwinOf503(record BrowserRecord, switched, ready int64) bool {
	return record.Kind == "console" && strings.Contains(record.Text, "status of 503") && switched >= 0 && ready >= 0 &&
		record.AtMs >= switched && record.AtMs <= ready
}

// stopStartDowntime: a stop-start install serves nothing between the old release stopping and head's api
// answering (the walker's "down" phase), so the balancer's 502s and the loads they abort are expected there.
func stopStartDowntime(record BrowserRecord, stopStart bool) bool {
	return stopStart && record.Phase == "down" && slices.Contains([]string{"console", "http", "requestfailed"}, record.Kind)
}

// mainTabAcrossSwitch: main's UI, loaded before the switch, reconnects its tRPC WebSocket to head, which
// serves none and whose UI opens none; tolerated for a minute after the switch, a finding after that.
func mainTabAcrossSwitch(record BrowserRecord, switched int64) bool {
	return record.Kind == "console" && strings.Contains(record.Text, "/api/trpc-ws") && switched >= 0 &&
		record.AtMs >= switched && record.AtMs <= switched+60_000
}

// mainPageAcrossSwitch: main's page, fetched just before the switch, loads its hashed assets from head,
// which never built them (ADR-086's rolling-deploy skew; the lab has no LANGWATCH_ASSET_BASE). The
// console line names no url, so only its 404 is matched; the http record beside it carries the path.
// A stylesheet's 404 (text/plain) shows instead as a MIME refusal naming the asset.
func mainPageAcrossSwitch(record BrowserRecord, switched int64) bool {
	asset := strings.Contains(record.URL, "/assets/") &&
		(record.Kind == "http" && record.Status == http.StatusNotFound || record.Kind == "requestfailed")
	missing := record.Kind == "console" && strings.Contains(record.Text, "status of 404")
	style := record.Kind == "console" && strings.HasPrefix(record.Text, "Refused to apply style from ") && strings.Contains(record.Text, "/assets/")
	return (asset || missing || style) && switched >= 0 && record.AtMs >= switched && record.AtMs <= switched+60_000
}

// mainClientOutdated: main's page, fetched just before the switch, sends head its old enveloped tRPC input
// (`{"json": ...}`) and head answers 400 client_outdated, as packages/api/src/trpc/client-outdated.ts means
// it to; its console line names no url. The WebSocket's own 404 is the http twin of mainTabAcrossSwitch.
func mainClientOutdated(record BrowserRecord, switched int64) bool {
	decoded, _ := url.QueryUnescape(record.URL)
	enveloped := record.Kind == "http" && record.Status == http.StatusBadRequest && strings.Contains(record.URL, "/api/trpc/") &&
		strings.Contains(decoded, `"json":`)
	socket := record.Kind == "http" && record.Status == http.StatusNotFound && strings.Contains(record.URL, "/api/trpc-ws")
	refused := record.Kind == "console" && strings.Contains(record.Text, "status of 400")
	told := record.Kind == "http" && record.Status == http.StatusBadRequest && strings.Contains(record.Text, "client_outdated")
	logged := record.Kind == "console" && strings.HasPrefix(record.Text, "<< ") // main's tRPC logger echoing those refusals
	return (enveloped || socket || refused || told || logged) && switched >= 0 && record.AtMs >= switched && record.AtMs <= switched+60_000
}

// browserNoise is a console error or failed request the lab tolerates: every Match substring in the
// record's url or text. Reason is printed in the report; they are counted apart from findings.
type browserNoise struct {
	Match  []string
	Reason string
}

var acceptedBrowserNoise = []browserNoise{
	{[]string{"static.hotjar.com"}, "third-party analytics, same on main"},
	{[]string{"static.reo.dev", "ERR_BLOCKED_BY_ORB"}, "third-party analytics, same on main"},
	{[]string{"/api/trpc/", "?input=", "net::ERR_ABORTED"}, "a tRPC read the page cancelled itself (navigation or a re-keyed query); its answer is judged by N2 and the api log"},
	{[]string{"/api/health", "net::ERR_ABORTED"}, "the boot screen's health probe, cancelled when the walk moves to the next page"},
}

// BrowserFindings reads browser.jsonl: the walks completed and every error outside the accepted list.
func BrowserFindings(path string, switched, ready int64, stopStart bool) (walks, expected int, tolerated map[string]int, findings []BrowserRecord, err error) {
	data, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return 0, 0, nil, nil, err
	}
	tolerated = map[string]int{}
	var records []BrowserRecord
	upgrading := map[string]bool{} // paths that answered a readable upgrade_in_progress in the window
	twins := 0                     // the browser echoes each failed load as a console line naming no url: one per expected 503
	for _, line := range strings.Split(string(data), "\n") {
		var record BrowserRecord
		if strings.TrimSpace(line) == "" || json.Unmarshal([]byte(line), &record) != nil {
			continue
		}
		records = append(records, record)
		if expectedWhileStepsRun(record, switched, ready) {
			twins++
			upgrading[pathOf(record.URL)] = true
		}
	}
	for _, record := range records {
		if unreadUpgrade503(record, switched, ready, upgrading) {
			twins++
		}
	}
	for _, record := range records {
		switch {
		case record.Kind == "walk":
			walks++
		case expectedWhileStepsRun(record, switched, ready), unreadUpgrade503(record, switched, ready, upgrading):
			expected++
		case twins > 0 && consoleTwinOf503(record, switched, ready):
			twins--
			tolerated["console 'status of 503' (the browser's echo of an expected upgrade_in_progress 503)"]++
		case record.Kind == "walkerror":
		case record.Kind == "navigated":
			tolerated["the open tab navigated on its own between walks (told to reload)"]++
		case stopStartDowntime(record, stopStart):
			tolerated["502 or aborted load while no release serves (self-hosted stop-start downtime, T4-F3)"]++
		case mainTabAcrossSwitch(record, switched):
			tolerated["/api/trpc-ws (main's tab, open across the switch, reconnecting)"]++
		case mainPageAcrossSwitch(record, switched):
			tolerated["/assets/* 404 (main's page, fetched across the switch, ADR-086)"]++
		case mainClientOutdated(record, switched):
			tolerated["/api/trpc 400 client_outdated (main's page, fetched across the switch, told to reload)"]++
		default:
			if noise, ok := accepted(record); ok {
				tolerated[noise.Match[0]+" ("+noise.Reason+")"]++
				continue
			}
			findings = append(findings, record)
		}
	}
	return walks, expected, tolerated, findings, nil
}

func accepted(record BrowserRecord) (browserNoise, bool) {
	for _, noise := range acceptedBrowserNoise {
		if slices.ContainsFunc(noise.Match, func(part string) bool {
			return !strings.Contains(record.URL, part) && !strings.Contains(record.Text, part)
		}) {
			continue
		}
		return noise, true
	}
	return browserNoise{}, false
}
