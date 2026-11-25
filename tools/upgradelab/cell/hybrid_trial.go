package cell

import (
	"context"
	"fmt"
	"io"
	"maps"
	"net"
	"net/http"
	neturl "net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Hybrid drills (trial T7): a private ClickHouse target down while head upgrades, and a private route missing or malformed.
const (
	DrillPrivateDown = "private-down" // H8
	DrillRouteBroken = "route-broken" // H7
)

// privateKindTables are the tables a private organization's own kinds land in; H6 wants each on its own target.
var privateKindTables = []string{"stored_spans", "trace_summaries", "log_records", "metric_data_points", "evaluation_runs", "event_log"}

// Gate is a TCP forwarder in front of ClickHouse that a drill can take down, as a private target going away.
type Gate struct {
	listener net.Listener
	upstream string
	mu       sync.Mutex
	down     bool
	conns    map[net.Conn]bool
}

// StartGate listens on a free local port and forwards each connection to upstream (host:port).
func StartGate(upstream string) (*Gate, error) {
	listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	gate := &Gate{listener: listener, upstream: upstream, conns: map[net.Conn]bool{}}
	go gate.serve()
	return gate, nil
}

// Port is where the gate listens.
func (gate *Gate) Port() int { return gate.listener.Addr().(*net.TCPAddr).Port }

func (gate *Gate) serve() {
	for {
		conn, err := gate.listener.Accept()
		if err != nil {
			return
		}
		go gate.forward(conn)
	}
}

func (gate *Gate) track(conn net.Conn) bool {
	gate.mu.Lock()
	defer gate.mu.Unlock()
	if gate.down {
		return false
	}
	gate.conns[conn] = true
	return true
}

func (gate *Gate) drop(conn net.Conn) {
	gate.mu.Lock()
	delete(gate.conns, conn)
	gate.mu.Unlock()
	_ = conn.Close()
}

func (gate *Gate) forward(conn net.Conn) {
	if !gate.track(conn) {
		_ = conn.Close()
		return
	}
	defer gate.drop(conn)
	upstream, err := (&net.Dialer{Timeout: 5 * time.Second}).Dial("tcp", gate.upstream)
	if err != nil || !gate.track(upstream) {
		return
	}
	defer gate.drop(upstream)
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(upstream, conn); done <- struct{}{} }()
	go func() { _, _ = io.Copy(conn, upstream); done <- struct{}{} }()
	<-done
}

// SetDown refuses new connections and closes the open ones, or lets connections through again.
func (gate *Gate) SetDown(down bool) {
	gate.mu.Lock()
	defer gate.mu.Unlock()
	gate.down = down
	if down {
		for conn := range gate.conns {
			_ = conn.Close()
		}
	}
}

// Close stops listening and drops every connection.
func (gate *Gate) Close() {
	_ = gate.listener.Close()
	gate.SetDown(true)
}

// GatedURL is url with its host swapped for the gate's local port.
func GatedURL(url string, port int) string {
	parsed, err := neturl.Parse(url)
	if err != nil {
		return url
	}
	parsed.Host = "127.0.0.1:" + strconv.Itoa(port)
	return parsed.String()
}

// PrivateTargetsFor adds a second private organization at tier M (trial T7, UM-11: two private targets). Only a tier M
// snapshot holds the heavy tenancy's fifth organization; a live cell seeds tier S's four, so there the second
// target takes organization 3, which exists (T7-F9: a route to an organization that does not exist got no traffic).
func PrivateTargetsFor(shape map[string]string, tier string, fromSnapshot bool) map[string]string {
	targets := maps.Clone(shape)
	if tier == "M" && len(targets) > 0 {
		targets["snap2"] = "snap_hybrid_org_3"
		if fromSnapshot {
			targets["snap2"] = "snap_hybrid_org_5"
		}
	}
	return targets
}

// startGates puts a gate in front of each private target when the private-down drill runs.
func (cell *run) startGates() error {
	if !cell.drill(DrillPrivateDown) {
		return nil
	}
	parsed, err := neturl.Parse(cell.stores.ClickHouseBase)
	if err != nil {
		return err
	}
	cell.gates, cell.stores.Gates = map[string]*Gate{}, map[string]int{}
	for _, label := range cell.stores.Private {
		gate, err := StartGate(parsed.Host)
		if err != nil {
			return err
		}
		cell.gates[label], cell.stores.Gates[label] = gate, gate.Port()
	}
	return nil
}

// TargetState is one ClickHouse target's upgrade steps: how many are not done, of how many, and their statuses.
type TargetState struct {
	Open, Total int
	Statuses    string
}

// ParseTargetStates reads `target|open|total|statuses` rows.
func ParseTargetStates(out string) map[string]TargetState {
	states := map[string]TargetState{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		fields := strings.Split(line, "|")
		if len(fields) != 4 {
			continue
		}
		open, _ := strconv.Atoi(fields[1])
		total, _ := strconv.Atoi(fields[2])
		states[fields[0]] = TargetState{Open: open, Total: total, Statuses: fields[3]}
	}
	return states
}

func (cell *run) targetStates(ctx context.Context) (map[string]TargetState, error) {
	out, err := psql(ctx, cell.stores.psqlURL(), `SELECT target, count(*) FILTER (WHERE status NOT IN ('done', 'not-needed')), count(*), string_agg(DISTINCT status, ',') FROM mydb_upgrade_ledger._langwatch_upgrade_target GROUP BY target ORDER BY target`)
	if err != nil {
		return nil, err
	}
	return ParseTargetStates(out), nil
}

// downState is what the private-down drill saw: which target went down, and when it caught up.
type downState struct {
	label                      string
	downAtMs, upAtMs, caughtMs int64
	whileDown                  map[string]TargetState
	sharedDone                 bool
	readyWhileDown             bool
	err                        string
}

// downTarget is the ledger target of the private label the drill takes down.
func (cell *run) downTarget() string { return "private:" + cell.private[cell.down.label] }

// holdPrivateDown (H8) takes the first private target down as head's worker starts the upgrade (any other private
// target stays up), waits until the shared target has no open step and head is ready (at most eight minutes),
// records what each target shows, brings it back, then waits for it to catch up (at most ten minutes).
func (cell *run) holdPrivateDown(ctx context.Context) {
	defer cell.downWG.Done()
	cell.down.label = slices.Sorted(maps.Keys(cell.gates))[0]
	cell.gates[cell.down.label].SetDown(true)
	cell.down.downAtMs = time.Since(cell.origin).Milliseconds()
	cell.awaitSharedDone(ctx, time.Now().Add(8*time.Minute))
	_ = sleep(ctx, 20*time.Second) // the private target stays down a while after the rest finished
	if states, err := cell.targetStates(ctx); err == nil {
		cell.down.whileDown = states
	}
	cell.down.readyWhileDown = cell.readyReached()
	cell.gates[cell.down.label].SetDown(false)
	cell.down.upAtMs = time.Since(cell.origin).Milliseconds()
	_ = waitFor(ctx, 10*time.Minute, func() bool {
		states, err := cell.targetStates(ctx)
		if state, ok := states[cell.downTarget()]; err == nil && ok && state.Open == 0 {
			cell.down.caughtMs = time.Since(cell.origin).Milliseconds()
			return true
		}
		return false
	})
}

func (cell *run) readyReached() bool {
	return cell.poller != nil && FirstAt(cell.poller.Timeline(), "ready") >= 0
}

// awaitSharedDone polls the ledger until the shared target has no open step and head is ready, or the deadline passes.
func (cell *run) awaitSharedDone(ctx context.Context, deadline time.Time) {
	for time.Now().Before(deadline) && ctx.Err() == nil {
		states, err := cell.targetStates(ctx)
		if err != nil {
			cell.down.err = err.Error()
		} else if cell.down.whileDown, cell.down.err = states, ""; states["shared"].Total > 0 && states["shared"].Open == 0 {
			cell.down.sharedDone = true
			if cell.readyReached() {
				return
			}
		}
		_ = sleep(ctx, 2*time.Second)
	}
}

// downVerdict (H8): while one private target was down it was held, the shared target and every other private
// target finished, head became ready, no other organization's call failed, and once back it caught up.
func (cell *run) downVerdict(ctx context.Context) Verdict {
	final, err := cell.targetStates(ctx)
	down := cell.downTarget()
	privateHeld, othersDone, allDone := cell.down.whileDown[down].Open > 0, len(cell.down.whileDown) == 1+len(cell.private), err == nil && len(final) == 1+len(cell.private)
	for target, state := range cell.down.whileDown {
		othersDone = othersDone && (target == down || state.Open == 0)
	}
	for _, state := range final {
		allDone = allDone && state.Open == 0
	}
	sharedFailed, privateAnswered := callsInWindow(cell.allCalls(), cell.down.downAtMs, cell.down.upAtMs)
	detail := fmt.Sprintf("%s down %d..%d ms, caught up at %d ms (0: never); while down: %v (shared finished: %t, others finished: %t, ready reached: %t); after: %v %s; other organizations' calls failed in the window: %d %v; the down organization's answers in the window: %v %s",
		down, cell.down.downAtMs, cell.down.upAtMs, cell.down.caughtMs, cell.down.whileDown, cell.down.sharedDone, othersDone, cell.down.readyWhileDown, final, errText(err),
		len(sharedFailed), sharedFailed[:min(len(sharedFailed), 5)], countStrings(privateAnswered), cell.down.err)
	if !privateHeld && (cell.down.sharedDone || cell.down.readyWhileDown) {
		return Verdict{ID: "H8", Name: invariantNames["H8"], Result: "inconclusive", Detail: "the private target never showed an open step while down; " + detail}
	}
	return verdict("H8", privateHeld && othersDone && cell.down.readyWhileDown && cell.down.caughtMs > 0 && allDone && len(sharedFailed) == 0 && OnlyRefusals(privateAnswered), detail)
}

// downExcused counts the down organization's failed calls inside the H8 window, which N2 leaves to H8.
func (cell *run) downExcused() int {
	if cell.down.upAtMs == 0 || cell.privateTraffic == nil {
		return 0
	}
	excused := 0
	callsRange := cell.privateTraffic.Calls()
	for i := range callsRange {
		call := &callsRange[i]
		if !call.ok() && call.AtMs >= cell.down.downAtMs && call.AtMs <= cell.down.upAtMs {
			excused++
		}
	}
	return excused
}

// OnlyRefusals is true when every answer is a 2xx or a 503: a down target is refused, never a bare 500.
func OnlyRefusals(statuses []string) bool {
	return !slices.ContainsFunc(statuses, func(status string) bool { return !strings.HasPrefix(status, "2") && status != "503" })
}

// callsInWindow answers the shared calls that failed between from and to, and the private calls' statuses.
func callsInWindow(calls []Call, from, to int64) (sharedFailed, privateAnswered []string) {
	for index := range calls {
		call := &calls[index]
		private := strings.HasPrefix(call.Kind, privatePrefix)
		switch {
		case call.AtMs < from || call.AtMs > to:
		case private:
			privateAnswered = append(privateAnswered, strconv.Itoa(call.Status))
		case !call.ok():
			sharedFailed = append(sharedFailed, call.String())
		}
	}
	return sharedFailed, privateAnswered
}

func countStrings(values []string) map[string]int {
	counts := map[string]int{}
	for _, value := range values {
		counts[value]++
	}
	return counts
}

// TenantRows is per table, per tenant, a row count on one target.
type TenantRows map[string]map[string]int

// tenantRows counts rows per tenant in every table on a target that has a TenantId column.
func tenantRows(ctx context.Context, target string) (TenantRows, error) {
	out, err := clickhouseQuery(ctx, target, "SELECT table FROM system.columns WHERE database = currentDatabase() AND name = 'TenantId' AND table IN (SELECT name FROM system.tables WHERE database = currentDatabase() AND engine NOT LIKE '%View') ORDER BY table FORMAT TSV")
	if err != nil {
		return nil, err
	}
	rows := TenantRows{}
	for _, table := range strings.Fields(out) {
		counts, err := clickhouseQuery(ctx, target, "SELECT TenantId, count() FROM "+table+" GROUP BY TenantId FORMAT TSV")
		if err != nil {
			return rows, fmt.Errorf("%s: %w", table, err)
		}
		rows[table] = map[string]int{}
		for _, line := range strings.Split(strings.TrimSpace(counts), "\n") {
			if tenant, count, found := strings.Cut(line, "\t"); found {
				rows[table][tenant], _ = strconv.Atoi(count)
			}
		}
	}
	return rows, nil
}

// MisplacedRows names each table and tenant found on label whose home is another target; home "" is shared.
func MisplacedRows(home map[string]string, label string, rows TenantRows) []string {
	var misplaced []string
	for table, tenants := range rows {
		for tenant, count := range tenants {
			if home[tenant] != label {
				misplaced = append(misplaced, fmt.Sprintf("%s %s x%d on %q, home %q", table, tenant, count, label, home[tenant]))
			}
		}
	}
	sort.Strings(misplaced)
	return misplaced
}

// placement scans every target's every TenantId table: misplaced rows, and the rows per target.
func (cell *run) placement(ctx context.Context) ([]string, map[string]TenantRows, error) {
	home, misplaced, byTarget := cell.homes(), []string{}, map[string]TenantRows{}
	for _, label := range append([]string{""}, cell.stores.Private...) {
		rows, err := tenantRows(ctx, cell.stores.queryURL(label))
		if err != nil {
			return misplaced, byTarget, err
		}
		byTarget[label] = rows
		misplaced = append(misplaced, MisplacedRows(home, label, rows)...)
	}
	return misplaced, byTarget, nil
}

// placementAtCut records the placement as main left it, before head starts.
func (cell *run) placementAtCut(ctx context.Context) {
	if len(cell.private) == 0 {
		return
	}
	misplaced, _, err := cell.placement(ctx)
	cell.placedBefore, cell.placedBeforeErr = misplaced, err
}

// PrivateKindCounts sums, per kind table, the rows a private organization's tenants hold on its own target.
func PrivateKindCounts(rows TenantRows, tenants map[string]bool) map[string]int {
	counts := map[string]int{}
	for _, table := range privateKindTables {
		counts[table] = 0
		for tenant, count := range rows[table] {
			if tenants[tenant] {
				counts[table] += count
			}
		}
	}
	return counts
}

// placementVerdicts: H1 nothing misplaced before or after, over every TenantId table; H6 every private kind present at home.
func (cell *run) placementVerdicts(ctx context.Context) []Verdict {
	misplaced, byTarget, err := cell.placement(ctx)
	tables := len(byTarget[""])
	h1 := verdict("H1", err == nil && cell.placedBeforeErr == nil && len(misplaced) == 0 && len(cell.placedBefore) == 0,
		fmt.Sprintf("%d TenantId tables per target; misplaced before the upgrade: %v %s; after: %v %s", tables, cell.placedBefore, errText(cell.placedBeforeErr), misplaced, errText(err)))
	home, missing, detail := cell.homes(), []string{}, []string{}
	for label := range cell.private {
		tenants := map[string]bool{}
		for tenant, at := range home {
			tenants[tenant] = at == label
		}
		counts := PrivateKindCounts(byTarget[label], tenants)
		detail = append(detail, fmt.Sprintf("%s: %v", label, counts))
		for table, count := range counts {
			if count == 0 {
				missing = append(missing, label+"/"+table)
			}
		}
	}
	sort.Strings(missing)
	h6 := verdict("H6", err == nil && len(missing) == 0, fmt.Sprintf("private rows on their own target %v; empty: %v", detail, missing))
	return []Verdict{h1, h6}
}

// keyedRead is one request made with an API key.
type keyedRead struct{ method, url, key, body string }

// readAs sends one request with an API key: status and up to 4 KiB of body.
func readAs(ctx context.Context, read keyedRead) (int, string) {
	var reader io.Reader = http.NoBody
	if read.body != "" {
		reader = strings.NewReader(read.body)
	}
	request, err := http.NewRequestWithContext(ctx, read.method, read.url, reader)
	if err != nil {
		return 0, err.Error()
	}
	request.Header.Set("X-Auth-Token", read.key)
	request.Header.Set("Content-Type", "application/json")
	response, err := httpClient.Do(request)
	if err != nil {
		return 0, err.Error()
	}
	defer func() { _ = response.Body.Close() }()
	text, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	return response.StatusCode, string(text)
}

// privateReadsVerdict (H3): the private key reads its trace list, a trace, analytics, a logged evaluation and a dataset's rows.
func (cell *run) privateReadsVerdict(ctx context.Context) Verdict {
	trace, dataset := cell.firstPrivateWrites()
	evaluated := ""
	calls := cell.privateTraffic.Calls()
	for index := range calls {
		if calls[index].ok() && calls[index].Kind == privatePrefix+"collector-eval" {
			evaluated = calls[index].ID
		}
	}
	key, now := cell.privateTraffic.Client.APIKey, time.Now().UnixMilli()
	window := fmt.Sprintf(`"startDate": %d, "endDate": %d`, now-86_400_000, now+60_000)
	type read struct {
		name, method, path, body, want string
	}
	reads := []read{
		{"traces list", http.MethodPost, "/api/traces/search", "{" + window + `, "pageSize": 10}`, cell.privateTraffic.Client.Project},
		{"trace detail", http.MethodGet, "/api/traces/" + trace, "", trace},
		{"analytics", http.MethodPost, "/api/analytics", "{" + window + `, "series": [{"metric": "metadata.trace_id", "aggregation": "cardinality"}], "timeScale": "full", "timeZone": "UTC"}`, ""},
		{"evaluation", http.MethodGet, "/api/traces/" + evaluated, "", evaluationName},
		{"dataset rows", http.MethodGet, "/api/dataset/" + dataset, "", "row " + dataset},
	}
	var failed, answered []string
	for _, each := range reads {
		status, text := readAs(ctx, keyedRead{each.method, cell.url() + each.path, key, each.body})
		answered = append(answered, fmt.Sprintf("%s %d", each.name, status))
		if status != http.StatusOK || !strings.Contains(text, each.want) {
			failed = append(failed, fmt.Sprintf("%s %d %.160q", each.name, status, text))
		}
	}
	return verdict("H3", trace != "" && dataset != "" && evaluated != "" && len(failed) == 0,
		fmt.Sprintf("trace %q, evaluated trace %q, dataset %q; answered %v; failed %v", trace, evaluated, dataset, answered, failed))
}

// evaluationName is the evaluation the private collector kind logs with its trace.
const evaluationName = "upgradelab-eval"

// collectorEval is a collector trace carrying one logged evaluation, so evaluations land on the tenant's target.
func collectorEval(ctx context.Context, client Client, n int) (*http.Request, string, error) {
	id := SeededID(client.Seed, "collector-eval", n)
	now := time.Now().UnixMilli()
	span := map[string]any{"type": "span", "span_id": id[:16], "name": "upgradelab evaluated " + strconv.Itoa(n),
		"input": map[string]string{"type": "text", "value": "item " + strconv.Itoa(n)}, "timestamps": map[string]int64{"started_at": now - 10, "finished_at": now}}
	evaluation := map[string]any{"name": evaluationName, "passed": true, "score": 1, "status": "processed"}
	request, err := client.post(ctx, "/api/collector", map[string]any{"trace_id": id, "spans": []any{span}, "evaluations": []any{evaluation}})
	return request, id, err
}

// routeProbe is one H7 variant: head's api booted with the private route missing or malformed.
type routeProbe struct {
	Variant    string            `json:"variant"`
	Booted     bool              `json:"booted"`
	BootNote   string            `json:"bootNote,omitempty"`
	Answers    map[string]int    `json:"answers,omitempty"`
	Bodies     []string          `json:"bodies,omitempty"`
	Codes      map[string]string `json:"codes,omitempty"`
	LogMatches []string          `json:"logMatches,omitempty"`
}

// routeBrokenDrill (H7) boots a second head api twice beside the settled cell, once without the private
// organization's CLICKHOUSE_URL__ entry and once with a malformed one, and asks it for the private data.
func (cell *run) routeBrokenDrill(ctx context.Context) error {
	if !cell.drill(DrillRouteBroken) || cell.privateTraffic == nil {
		return nil
	}
	trace, _ := cell.firstPrivateWrites()
	_ = waitFor(ctx, 7*time.Minute, func() bool { return cell.routesRecorded(ctx) >= len(cell.private) })
	// Only the organization whose key and trace the probe asks with: breaking another's route probed a healthy one (T7-F20).
	key := "CLICKHOUSE_URL__" + cell.privateLabel + "__" + cell.private[cell.privateLabel]
	for _, variant := range []string{"missing", "malformed"} {
		cell.routeProbes = append(cell.routeProbes, cell.probeRoute(ctx, routeBreak{variant: variant, key: key, trace: trace}))
	}
	misplaced, _, err := cell.placement(ctx)
	cell.routeAfter, cell.routeAfterErr = misplaced, err
	return nil
}

// routesRecorded reads which organizations head's worker recorded as privately routed (T7-F2/F3), keeping the rows
// for the report, and answers how many carry a ClickHouse label.
func (cell *run) routesRecorded(ctx context.Context) int {
	out, err := psql(ctx, cell.stores.psqlURL(), `SELECT id, coalesce("privateClickHouseLabel", '-'), coalesce("privateS3Label", '-'), "privateDataplaneSeenAt" IS NOT NULL FROM mydb."Organization" WHERE "privateClickHouseLabel" IS NOT NULL OR "privateS3Label" IS NOT NULL ORDER BY id`)
	if err != nil {
		cell.routeRecords = "read failed: " + err.Error()
		return 0
	}
	cell.routeRecords = strings.ReplaceAll(strings.TrimSpace(out), "\n", "; ")
	return len(slices.DeleteFunc(strings.Split(strings.TrimSpace(out), "\n"), func(line string) bool { return !strings.Contains(line, "|") }))
}

// brokenRouteEnv is env with the private route dropped (missing) or replaced by a value that is no URL (malformed).
func brokenRouteEnv(base map[string]string, variant, key string) map[string]string {
	env := maps.Clone(base)
	if variant == "missing" {
		delete(env, key)
	} else {
		env[key] = "clickhouse-private-route-is-not-a-url"
	}
	return env
}

// routeBreak is one probe: how the route is broken, the route variable, and the private trace to ask for.
type routeBreak struct{ variant, key, trace, base string }

func (cell *run) probeRoute(ctx context.Context, broken routeBreak) routeProbe {
	variant, key := broken.variant, broken.key
	probe := routeProbe{Variant: variant, Answers: map[string]int{}}
	env := brokenRouteEnv(cell.env, variant, key)
	port := mustPort()
	env["API_PORT"], env["OTEL_EXPORTER_PROMETHEUS_PORT"] = itoa(port), itoa(mustPort())
	name := "probe-api-" + variant
	proc, err := Start(ProcSpec{Name: name, Dir: filepath.Join(cell.options.HeadDir, "apps", "api"), Log: cell.logPath(name), Args: HeadStartArgs, Env: Env(env)})
	if err != nil {
		probe.BootNote = err.Error()
		return probe
	}
	defer proc.Stop(15 * time.Second)
	base := "http://127.0.0.1:" + itoa(port)
	_ = waitFor(ctx, 4*time.Minute, func() bool {
		status, _, err := get(ctx, httpClient, base+"/healthz")
		exited, _ := proc.Exited()
		probe.Booted = err == nil && status == http.StatusOK
		return probe.Booted || exited
	})
	if probe.Booted {
		broken.base = base
		cell.askProbe(ctx, &probe, broken)
	} else if exited, exitErr := proc.Exited(); exited {
		probe.BootNote = "exited before healthz: " + errText(exitErr)
	} else {
		probe.BootNote = "neither healthy nor exited within 4 minutes"
	}
	probe.LogMatches = logLines(cell.logPath(name), []string{"CLICKHOUSE_URL__", "private route", "ClickHouse private", "dataplane"}, 6)
	return probe
}

// askProbe reads the private trace and trace list through the probe api and sends it one private trace.
func (cell *run) askProbe(ctx context.Context, probe *routeProbe, broken routeBreak) {
	base, trace := broken.base, broken.trace
	client := cell.privateTraffic.Client
	client.URL = base
	now := time.Now().UnixMilli()
	reads := map[string]keyedRead{
		"trace":  {http.MethodGet, base + "/api/traces/" + trace, client.APIKey, ""},
		"search": {http.MethodPost, base + "/api/traces/search", client.APIKey, fmt.Sprintf(`{"startDate": %d, "endDate": %d, "pageSize": 5}`, now-86_400_000, now)},
	}
	for kind, read := range reads {
		// /healthz answers before the api serves: wait out its "is starting" 503 (T7-F19).
		var status int
		var text string
		_ = waitFor(ctx, 2*time.Minute, func() bool {
			status, text = readAs(ctx, read)
			return status != http.StatusServiceUnavailable || !strings.Contains(text, "is starting")
		})
		probe.Answers[kind] = status
		probe.Bodies = append(probe.Bodies, fmt.Sprintf("%s: %.200s", kind, text))
		if match := errorCode.FindStringSubmatch(text); match != nil {
			if probe.Codes == nil {
				probe.Codes = map[string]string{}
			}
			probe.Codes[kind] = match[1]
		}
	}
	request, _, err := otlpTrace(ctx, client, 9_000_001)
	if err != nil {
		return
	}
	if response, err := httpClient.Do(request); err == nil {
		probe.Answers["ingest"] = response.StatusCode
		_ = response.Body.Close()
	}
}

// logLines answers up to limit lines of a log naming any of the needles.
func logLines(path string, needles []string, limit int) []string {
	data, err := os.ReadFile(path) // #nosec G304 -- the cell's own log.
	if err != nil {
		return nil
	}
	var found []string
	for _, line := range strings.Split(string(data), "\n") {
		if len(found) < limit && slices.ContainsFunc(needles, func(needle string) bool { return strings.Contains(line, needle) }) {
			found = append(found, fmt.Sprintf("%.300s", line))
		}
	}
	return found
}

// errorCode is the code of a canonical error body.
var errorCode = regexp.MustCompile(`"code":"([a-z_]+)"`)

// RefusedClearly is true when the probe never served the private organization from another target: it refused to boot,
// or answered each private read 503 private_dataplane_unavailable (T7-F2/F3); a 2xx, a 404 or a bare 500 is not clear.
func RefusedClearly(probe routeProbe) bool {
	if !probe.Booted {
		return true
	}
	for _, kind := range []string{"trace", "search"} {
		if probe.Answers[kind] != http.StatusServiceUnavailable || probe.Codes[kind] != "private_dataplane_unavailable" {
			return false
		}
	}
	return true
}

// routeVerdict (H7): each broken route was refused clearly and the shared target took none of the private data.
func (cell *run) routeVerdict() Verdict {
	if len(cell.routeProbes) == 0 {
		return Verdict{ID: "H7", Name: invariantNames["H7"], Result: "inconclusive", Detail: "no probe ran"}
	}
	refused := true
	for _, probe := range cell.routeProbes {
		refused = refused && RefusedClearly(probe)
	}
	return verdict("H7", refused && cell.routeAfterErr == nil && len(cell.routeAfter) == 0,
		fmt.Sprintf("recorded routes [%s]; probes %+v; misplaced after the probes: %v %s", cell.routeRecords, cell.routeProbes, cell.routeAfter, errText(cell.routeAfterErr)))
}

// dataplanesVerdict (H9): Ops > Upgrades opens a Dataplanes tab listing every private target by organization.
func (cell *run) dataplanesVerdict(ctx context.Context) Verdict {
	if !cell.options.Shots {
		return Verdict{ID: "H9", Name: invariantNames["H9"], Result: "inconclusive", Detail: "-shots off"}
	}
	organizations := slices.Sorted(maps.Values(cell.private)) // the tab names each target private:<organization>
	text, file := cell.shootPage(ctx, "dataplanes", map[string]any{"open": "Dataplanes", "expect": "private:" + organizations[0]})
	missing := slices.DeleteFunc(slices.Clone(organizations), func(organization string) bool { return strings.Contains(text, "private:"+organization) })
	table := text[max(0, strings.Index(text, "Target")):]
	shared := strings.Contains(strings.ToLower(table), "shared") // T7-F5: the shared target is listed too
	return verdict("H9", strings.HasPrefix(text, "selected tab: Dataplanes\n") && len(missing) == 0 && shared,
		fmt.Sprintf("%s; targets missing from the tab: %v; shared listed: %t; text: %.700q", file, missing, shared, table))
}
