package cell

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

// queueDepthScript sums the waiting work in Redis: lists, sorted sets and streams, never a
// completed, failed or bookkeeping key (the gq ready index and stats, known pipelines). ponytail: KEYS over a test-sized db; SCAN if a tier grows.
const queueDepthScript = `local total = 0
for _, key in ipairs(redis.call('KEYS', '*')) do
  if not (string.find(key, ':completed$') or string.find(key, ':failed$') or string.find(key, ':events$') or string.find(key, ':meta$') or string.find(key, ':repeat$') or string.find(key, ':stalled') or string.find(key, 'dedup') or string.find(key, 'lock') or string.find(key, 'known%-pipelines') or string.find(key, ':gq:stats:') or string.find(key, ':gq:ready$')) then
    local kind = redis.call('TYPE', key).ok
    if kind == 'zset' then total = total + redis.call('ZCARD', key)
    elseif kind == 'list' then total = total + redis.call('LLEN', key)
    elseif kind == 'stream' then total = total + redis.call('XLEN', key) end
  end -- if
end -- for
return total`

// QueueSample is one reading of the waiting work.
type QueueSample struct {
	AtMs  int64 `json:"atMs"`
	Depth int   `json:"depth"`
	Left  int   `json:"cutJobsLeft"` // jobs present at the cut still waiting; -1 unread
}

// QueueDepth reads the cell's Redis once.
func QueueDepth(ctx context.Context, port string) (int, error) {
	out, err := exec.CommandContext(ctx, "redis-cli", "-p", port, "EVAL", queueDepthScript, "0").Output() // #nosec G204 -- fixed script.
	if err != nil {
		return 0, fmt.Errorf("redis-cli EVAL: %w", err)
	}
	return strconv.Atoi(strings.TrimSpace(string(out)))
}

// queueJobsScript is queueDepthScript's key filter, listing the waiting jobs where it counts them.
var queueJobsScript = strings.NewReplacer(
	"local total = 0", "local rows = {}",
	"total = total + redis.call('ZCARD', key)", "for _, m in ipairs(redis.call('ZRANGE', key, 0, -1)) do table.insert(rows, key .. ' ' .. m) end",
	"total = total + redis.call('LLEN', key)", "for i, m in ipairs(redis.call('LRANGE', key, 0, -1)) do table.insert(rows, key .. ' #' .. i .. m) end",
	"total = total + redis.call('XLEN', key)", "for _, m in ipairs(redis.call('XRANGE', key, '-', '+')) do table.insert(rows, key .. ' ' .. m[1]) end",
	"return total", "return rows",
).Replace(queueDepthScript)

// QueueJobs lists every waiting job as "key member", with the same exclusions as the depth.
func QueueJobs(ctx context.Context, port string) (map[string]struct{}, error) {
	out, err := exec.CommandContext(ctx, "redis-cli", "-p", port, "EVAL", queueJobsScript, "0").Output() // #nosec G204 -- fixed script.
	if err != nil {
		return nil, fmt.Errorf("redis-cli EVAL: %w", err)
	}
	jobs := map[string]struct{}{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line != "" {
			jobs[line] = struct{}{}
		}
	}
	return jobs, nil
}

// QueueLeft is the jobs of cut still waiting in now.
func QueueLeft(cut, now map[string]struct{}) []string {
	var left []string
	for job := range cut {
		if _, ok := now[job]; ok {
			left = append(left, job)
		}
	}
	return left
}

// LeftByKind counts leftover jobs per job kind: the group key without tenant and aggregate, else the key.
func LeftByKind(left []string) string {
	counts := map[string]int{}
	for _, job := range left {
		key, _, _ := strings.Cut(job, " ")
		if at := strings.Index(key, ":gq:group:"); at >= 0 {
			if parts := strings.Split(strings.TrimSuffix(key[at+len(":gq:group:"):], ":jobs"), "/"); len(parts) >= 3 {
				key = strings.Join(parts[1:len(parts)-1], "/")
			}
		}
		counts[key]++
	}
	rows := make([]string, 0, len(counts))
	for key, count := range counts {
		rows = append(rows, fmt.Sprintf("%s: %d", key, count))
	}
	slices.Sort(rows)
	return strings.Join(rows, "; ")
}

// TopQueueKeys names the longest keys, so a report reader can judge what the depth counted.
func TopQueueKeys(ctx context.Context, port string) string {
	script := `local rows = {}
for _, key in ipairs(redis.call('KEYS', '*')) do
  local kind = redis.call('TYPE', key).ok
  local size = 0
  if kind == 'zset' then size = redis.call('ZCARD', key) elseif kind == 'list' then size = redis.call('LLEN', key) elseif kind == 'stream' then size = redis.call('XLEN', key) end
  if size > 0 then table.insert(rows, key .. ' ' .. kind .. ' ' .. size) end -- if
end -- for
return rows`
	out, _ := exec.CommandContext(ctx, "redis-cli", "-p", port, "EVAL", script, "0").Output() // #nosec G204 -- fixed script.
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	return strings.Join(lines[:min(len(lines), 25)], "\n")
}

// QueueByKind groups the group-queue's waiting jobs by job kind (the group key without tenant and
// aggregate): jobs, groups and when the earliest and latest are due, from the zset scores (ms).
func QueueByKind(ctx context.Context, port string) string {
	script := `local rows = {}
for _, key in ipairs(redis.call('KEYS', '*:gq:group:*:jobs')) do
  local first = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local last = redis.call('ZRANGE', key, -1, -1, 'WITHSCORES')
  if first[2] then table.insert(rows, key .. ' ' .. redis.call('ZCARD', key) .. ' ' .. first[2] .. ' ' .. last[2]) end -- if
end -- for
return rows`
	out, _ := exec.CommandContext(ctx, "redis-cli", "-p", port, "EVAL", script, "0").Output() // #nosec G204 -- fixed script.
	return groupQueueKinds(string(out), time.Now().UnixMilli())
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
var storedTable = map[string]string{"otlp-trace": "spans", "collector": "spans", "otlp-log": "logs", "otlp-metric": "metrics"}

// LedgerRow is one step of the upgrade ledger, as far as the invariants read it.
type LedgerRow struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Mode     string `json:"mode"`
	Status   string `json:"status"`
	Attempt  int    `json:"attempt"`
	Finished string `json:"finished_at"`
	Started  string `json:"started_at"`
}

// Ledger reads every step row; a missing ledger schema is an empty ledger.
func Ledger(ctx context.Context, stores Stores) ([]LedgerRow, error) {
	out, err := psql(ctx, stores.psqlURL(), `SELECT coalesce(json_agg(json_build_object('id', id, 'kind', kind, 'mode', mode, 'status', status, 'attempt', attempt, 'finished_at', finished_at::text, 'started_at', started_at::text) ORDER BY id), '[]') FROM mydb_upgrade_ledger._langwatch_upgrade_step`)
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
	for _, row := range rows {
		if row.Status != "done" && row.Status != "not-needed" && row.Mode != "operator" {
			left = append(left, row)
		}
	}
	return left
}

// Reopened is every step done in before that is not done, or ran again, in after.
func Reopened(before, after []LedgerRow) []string {
	index := map[string]LedgerRow{}
	for _, row := range after {
		index[row.ID] = row
	}
	var reopened []string
	for _, row := range before {
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

// browserNoise is a console error or failed request the lab tolerates: every Match substring in the
// record's url or text. Reason is printed in the report; they are counted apart from findings.
type browserNoise struct {
	Match  []string
	Reason string
}

var acceptedBrowserNoise = []browserNoise{
	{[]string{"static.hotjar.com"}, "third-party analytics, same on main"},
	{[]string{"static.reo.dev", "ERR_BLOCKED_BY_ORB"}, "third-party analytics, same on main"},
}

// BrowserFindings reads browser.jsonl: the walks completed and every error outside the accepted list.
func BrowserFindings(path string, switched, ready int64) (walks, expected int, tolerated map[string]int, findings []BrowserRecord, err error) {
	data, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return 0, 0, nil, nil, err
	}
	tolerated = map[string]int{}
	for _, line := range strings.Split(string(data), "\n") {
		var record BrowserRecord
		if strings.TrimSpace(line) == "" || json.Unmarshal([]byte(line), &record) != nil {
			continue
		}
		switch {
		case record.Kind == "walk":
			walks++
		case expectedWhileStepsRun(record, switched, ready):
			expected++
		case record.Kind == "walkerror":
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
