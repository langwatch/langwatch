package workerrun

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
	"github.com/langwatch/langwatch/tools/havenrun"
)

// operator is a session signed in as the seeded admin, the stack's operator, which
// reads the ops dashboard snapshot the worker's metrics writer keeps fresh.
type operator struct {
	client *http.Client
	app    string
	err    error
}

func signInOperator(ctx context.Context, app string) *operator {
	jar, _ := cookiejar.New(nil)
	op := &operator{app: app, client: &http.Client{Timeout: 20 * time.Second, Jar: jar,
		Transport: &http.Transport{TLSClientConfig: havenrun.LocalTLSConfig()}}}
	body, _ := json.Marshal(map[string]string{"email": diffkit.SeededAdminEmail, "password": diffkit.SeededAdminPassword})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, app+"/api/auth/sign-in/email", bytes.NewReader(body))
	if err != nil {
		op.err = err
		return op
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", app) // better-auth CSRF wants the app origin
	response, err := op.client.Do(request)
	if err != nil {
		op.err = fmt.Errorf("operator sign-in: %w", err)
		return op
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		op.err = fmt.Errorf("operator sign-in: status %d", response.StatusCode)
	}
	return op
}

// dashboard is the slice of ops.getDashboardSnapshot drain reads.
type dashboard struct {
	PipelineTree []struct {
		Name    string `json:"name"`
		Pending int    `json:"pending"`
		Blocked int    `json:"blocked"`
	} `json:"pipelineTree"`
	Queues []struct {
		DlqCount int `json:"dlqCount"`
	} `json:"queues"`
	Snapshot struct {
		ComputedAt int64 `json:"computedAt"`
	} `json:"snapshot"`
}

// staleSnapshot is how old a snapshot may be before the writer is taken to have stopped.
const staleSnapshot = time.Minute

func (op *operator) snapshot(ctx context.Context) (dashboard, error) {
	if op.err != nil {
		return dashboard{}, op.err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, op.app+"/api/trpc/ops.getDashboardSnapshot", nil)
	if err != nil {
		return dashboard{}, err
	}
	response, err := op.client.Do(request)
	if err != nil {
		return dashboard{}, err
	}
	defer func() { _ = response.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	snap, err := decodeSnapshot(raw, response.StatusCode)
	if err != nil {
		return dashboard{}, err
	}
	if age := time.Since(time.UnixMilli(snap.Snapshot.ComputedAt)); age > staleSnapshot {
		return dashboard{}, fmt.Errorf("ops.getDashboardSnapshot: snapshot is %s old (metrics writer stopped?)", age.Round(time.Second))
	}
	return snap, nil
}

func decodeSnapshot(raw []byte, status int) (dashboard, error) {
	var envelope struct {
		Error  json.RawMessage `json:"error"`
		Result struct {
			Data json.RawMessage `json:"data"`
		} `json:"result"`
	}
	if json.Unmarshal(raw, &envelope) != nil || len(envelope.Error) > 0 {
		return dashboard{}, fmt.Errorf("ops.getDashboardSnapshot: status %d %s", status, oneLine(string(raw)))
	}
	data := unwrapJSON(envelope.Result.Data)
	if len(data) == 0 || string(data) == "null" {
		return dashboard{}, errors.New("ops.getDashboardSnapshot: no snapshot yet (is the worker's metrics writer running?)")
	}
	var snap dashboard
	if err := json.Unmarshal(data, &snap); err != nil {
		return dashboard{}, fmt.Errorf("ops.getDashboardSnapshot: %w", err)
	}
	return snap, nil
}

// unwrapJSON strips superjson's {"json": ...} wrapper when the answer has one.
func unwrapJSON(data json.RawMessage) json.RawMessage {
	var wrapped struct {
		JSON json.RawMessage `json:"json"`
	}
	if json.Unmarshal(data, &wrapped) == nil && len(wrapped.JSON) > 0 {
		return wrapped.JSON
	}
	return data
}

// depth is one pipeline's queue as the snapshot counts it.
type depth struct {
	Pending int `json:"pending"`
	Blocked int `json:"blocked"`
}

// drainWatch samples the watched pipelines' depth: before the load, its peak, and after.
type drainWatch struct {
	mu        sync.Mutex
	op        *operator
	pipelines []string
	before    map[string]depth
	peak      map[string]depth
	last      map[string]depth
	dlqBefore int
	dlqLast   int
	drained   time.Duration // after read-back ended; -1 never
	err       string
}

func newDrainWatch(pipelines []string, op *operator) *drainWatch {
	return &drainWatch{op: op, pipelines: pipelines, peak: map[string]depth{}, drained: -1}
}

func (d *drainWatch) sample(ctx context.Context) (map[string]depth, int, error) {
	snap, err := d.op.snapshot(ctx)
	if err != nil {
		return nil, 0, err
	}
	depths := map[string]depth{}
	for _, node := range snap.PipelineTree {
		depths[node.Name] = depth{Pending: node.Pending, Blocked: node.Blocked}
	}
	dlq := 0
	for _, queue := range snap.Queues {
		dlq += queue.DlqCount
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, name := range d.pipelines {
		peak := d.peak[name]
		d.peak[name] = depth{Pending: max(peak.Pending, depths[name].Pending), Blocked: max(peak.Blocked, depths[name].Blocked)}
	}
	d.last, d.dlqLast = depths, dlq
	return depths, dlq, nil
}

func (d *drainWatch) baseline(ctx context.Context) {
	depths, dlq, err := d.sample(ctx)
	d.mu.Lock()
	defer d.mu.Unlock()
	if err != nil {
		d.err = err.Error()
		return
	}
	d.before, d.dlqBefore = depths, dlq
}

func (d *drainWatch) sampleEvery(ctx context.Context, every time.Duration) {
	for sleep(ctx, every) == nil {
		_, _, _ = d.sample(ctx)
	}
}

// await polls until every watched pipeline is back to its depth before the load, or limit passes.
func (d *drainWatch) await(ctx context.Context, limit time.Duration) {
	if d.before == nil {
		return
	}
	began := time.Now()
	for time.Since(began) <= limit {
		depths, _, err := d.sample(ctx)
		if err == nil && d.back(depths) {
			d.mu.Lock()
			d.drained = time.Since(began)
			d.mu.Unlock()
			return
		}
		if sleep(ctx, 2*time.Second) != nil {
			return
		}
	}
}

func (d *drainWatch) back(depths map[string]depth) bool {
	for _, name := range d.pipelines {
		if depths[name].Pending > d.before[name].Pending {
			return false
		}
	}
	return true
}

// healthWatch probes the health route every 2s: a probe over 2s or failing is a stall.
type healthWatch struct {
	mu      sync.Mutex
	probes  int
	stalls  int
	gateway int // 502s from the router
	slowest time.Duration
	worst   string
}

const stallAfter = 2 * time.Second

func (h *healthWatch) run(ctx context.Context, address string) {
	client := &http.Client{Timeout: 15 * time.Second, Transport: &http.Transport{TLSClientConfig: havenrun.LocalTLSConfig()}}
	for sleep(ctx, 2*time.Second) == nil {
		began := time.Now()
		status, err := probeHealth(ctx, client, address)
		if ctx.Err() != nil {
			return
		}
		took := time.Since(began)
		h.record(probeResult{began: began, took: took, status: status, problem: probeProblem(status, took, err)})
	}
}

func probeHealth(ctx context.Context, client *http.Client, address string) (int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return 0, err
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, err
	}
	_ = response.Body.Close()
	return response.StatusCode, nil
}

func probeProblem(status int, took time.Duration, err error) string {
	switch {
	case err != nil:
		return oneLine(err.Error())
	case status >= 300:
		return fmt.Sprintf("status %d", status)
	case took > stallAfter:
		return "slow"
	}
	return ""
}

// probeResult is one health probe: when it began, how long it took, and what was wrong.
type probeResult struct {
	began   time.Time
	took    time.Duration
	status  int
	problem string
}

func (h *healthWatch) record(probe probeResult) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.probes++
	h.slowest = max(h.slowest, probe.took)
	if probe.status == http.StatusBadGateway {
		h.gateway++
	}
	if probe.problem != "" {
		h.stalls++
		h.worst = fmt.Sprintf("%s after %s at %s", probe.problem, probe.took.Round(time.Millisecond), probe.began.Format("15:04:05"))
	}
}

// logWindow is the stack log from the run's start: its size then, read again at the end.
type logWindow struct {
	path   string
	offset int64
	err    error
}

func openLogWindow(path string) logWindow {
	if path == "" {
		return logWindow{err: errors.New("no stack log (pass -log, or run against a haven stack)")}
	}
	info, err := os.Stat(path)
	if err != nil {
		return logWindow{path: path, err: err}
	}
	return logWindow{path: path, offset: info.Size()}
}

// read answers the lines written since the window opened. A log that shrank was
// rotated: the rest of <path>.1 from the offset, then the new file whole.
func (w logWindow) read() ([]string, error) {
	if w.err != nil {
		return nil, w.err
	}
	info, err := os.Stat(w.path)
	if err != nil {
		return nil, err
	}
	if info.Size() >= w.offset {
		return linesFrom(w.path, w.offset)
	}
	rotated, _ := linesFrom(w.path+".1", w.offset)
	current, err := linesFrom(w.path, 0)
	return append(rotated, current...), err
}

func linesFrom(path string, offset int64) ([]string, error) {
	file, err := os.Open(path) // #nosec G304 -- the stack's own log.
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }()
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return nil, err
	}
	var lines []string
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	return lines, scanner.Err()
}

// signature is one error/fatal line shape: its level, logger and message with ids stripped.
// Ours is set when a line of it names the run's project, org or tag.
type signature struct {
	ID      string `json:"id"`
	Level   string `json:"level"`
	Message string `json:"message"`
	Count   int    `json:"count"`
	Ours    bool   `json:"ours"`
}

func scanSignatures(lines, markers []string) []signature {
	index := map[string]*signature{}
	for _, line := range lines {
		countLine(index, line, markers)
	}
	signatures := make([]signature, 0, len(index))
	for _, found := range index {
		signatures = append(signatures, *found)
	}
	sort.Slice(signatures, func(a, b int) bool { return signatures[a].ID < signatures[b].ID })
	return signatures
}

// countLine adds an error or fatal line to its signature, marking it ours when it names a marker.
func countLine(index map[string]*signature, line string, markers []string) {
	level, message := diffkit.LogLevelMessage(line)
	if level != "error" && level != "fatal" {
		return
	}
	key := level + " :: " + diffkit.NormaliseSignature(message)
	found := index[key]
	if found == nil {
		sum := sha256.Sum256([]byte(key))
		found = &signature{ID: "log-" + hex.EncodeToString(sum[:])[:8], Level: level, Message: diffkit.NormaliseSignature(message)}
		index[key] = found
	}
	found.Count++
	if slices.ContainsFunc(markers, func(marker string) bool { return strings.Contains(line, marker) }) {
		found.Ours = true
	}
}
