// Package nodeinspector drives a running Node process's inspector over the
// Chrome DevTools protocol: it finds the inspector a process already has open,
// opens one with SIGUSR1 when it has none (and closes that one again after),
// and records CPU profiles, sampling heap profiles and heap snapshots.
package nodeinspector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/coder/websocket"
)

// DefaultPort is where a Node process opens its inspector on SIGUSR1 unless
// it was started with --inspect-port.
const DefaultPort = 9229

// Session is one CDP connection to a Node process's main thread.
type Session struct {
	conn *websocket.Conn
	// Opened is true when this session opened the inspector (SIGUSR1); Close
	// then closes it again, so the port is free for the next process.
	Opened bool
	Port   int
	pid    int

	stopRead context.CancelFunc
	mu       sync.Mutex
	nextID   int
	pending  map[int]chan reply
	onEvent  func(method string, params json.RawMessage)
	readErr  error
	done     chan struct{}
}

type reply struct {
	Result json.RawMessage
	Err    error
}

type message struct {
	ID     int             `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// Attach connects to pid's inspector, opening it with SIGUSR1 when the
// process listens on none.
func Attach(ctx context.Context, pid int) (*Session, error) {
	if port, ws, ok := findTarget(ctx, listenPorts(ctx, pid)); ok {
		return dial(ctx, endpoint{pid: pid, ws: ws, port: port})
	}
	if err := syscall.Kill(pid, syscall.SIGUSR1); err != nil {
		return nil, fmt.Errorf("signal pid %d to open its inspector: %w", pid, err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(150 * time.Millisecond):
		}
		if port, ws, ok := findTarget(ctx, listenPorts(ctx, pid)); ok {
			return dial(ctx, endpoint{pid: pid, ws: ws, port: port, opened: true})
		}
	}
	if holder := holderOf(ctx, DefaultPort); holder != "" && !strings.HasPrefix(holder, strconv.Itoa(pid)+" ") {
		return nil, fmt.Errorf("pid %d could not open its inspector: port %d is held by pid %s. Retry once that profile ends, or restart the lane (haven restart api) so it opens inspectors on a free port", pid, DefaultPort, holder)
	}
	return nil, fmt.Errorf("pid %d opened no inspector within 5s of SIGUSR1 (is it a Node process?)", pid)
}

// listenPorts lists the TCP ports pid listens on, via lsof.
func listenPorts(ctx context.Context, pid int) []int {
	out, _ := exec.CommandContext(ctx, "lsof", "-nP", "-a", "-p", strconv.Itoa(pid), "-iTCP", "-sTCP:LISTEN", "-Fn").Output() //nolint:gosec // a fixed binary; the only variable is a pid integer
	var ports []int
	for line := range strings.SplitSeq(string(out), "\n") {
		name, ok := strings.CutPrefix(line, "n")
		if !ok {
			continue
		}
		i := strings.LastIndex(name, ":")
		if port, err := strconv.Atoi(name[i+1:]); err == nil && !slices.Contains(ports, port) {
			ports = append(ports, port)
		}
	}
	// The default inspector port first: it is the likeliest, and probing it
	// first spares the process's own HTTP listeners a stray request.
	slices.SortFunc(ports, func(a, b int) int {
		if a == DefaultPort || b == DefaultPort {
			return boolInt(b == DefaultPort) - boolInt(a == DefaultPort)
		}
		return a - b
	})
	return ports
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// holderOf names the process listening on port as "<pid> <command>", or "".
func holderOf(ctx context.Context, port int) string {
	out, _ := exec.CommandContext(ctx, "lsof", "-nP", "-iTCP:"+strconv.Itoa(port), "-sTCP:LISTEN", "-Fpc").Output() //nolint:gosec // a fixed binary; the only variable is a port integer
	var pid, cmd string
	for line := range strings.SplitSeq(string(out), "\n") {
		switch {
		case strings.HasPrefix(line, "p") && pid == "":
			pid = line[1:]
		case strings.HasPrefix(line, "c") && cmd == "":
			cmd = line[1:]
		}
	}
	if pid == "" {
		return ""
	}
	return pid + " " + cmd
}

type target struct {
	Type string `json:"type"`
	WS   string `json:"webSocketDebuggerUrl"`
}

// findTarget probes each port for the inspector's /json/list.
func findTarget(ctx context.Context, ports []int) (int, string, bool) {
	client := &http.Client{Timeout: 700 * time.Millisecond}
	for _, port := range ports {
		if ws, ok := probe(ctx, client, port); ok {
			return port, ws, true
		}
	}
	return 0, "", false
}

// probe asks one port for an inspector target's websocket URL.
func probe(ctx context.Context, client *http.Client, port int) (string, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/json/list", port), nil)
	if err != nil {
		return "", false
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", false
	}
	defer func() { _ = resp.Body.Close() }()
	var targets []target
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&targets) != nil {
		return "", false
	}
	for _, t := range targets {
		if t.WS != "" && (t.Type == "" || t.Type == "node") {
			return t.WS, true
		}
	}
	return "", false
}

// endpoint is an inspector found for a process, and whether haven opened it.
type endpoint struct {
	pid, port int
	ws        string
	opened    bool
}

func dial(ctx context.Context, at endpoint) (*Session, error) {
	conn, resp, err := websocket.Dial(ctx, at.ws, nil)
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		return nil, fmt.Errorf("connect to the inspector on :%d: %w", at.port, err)
	}
	conn.SetReadLimit(-1)
	s := &Session{conn: conn, Opened: at.opened, Port: at.port, pid: at.pid, pending: map[int]chan reply{}, done: make(chan struct{})}
	readCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	s.stopRead = cancel
	go s.readLoop(readCtx)
	return s, nil
}

func (s *Session) readLoop(ctx context.Context) {
	defer close(s.done)
	for {
		_, data, err := s.conn.Read(ctx)
		if err != nil {
			s.failPending(err)
			return
		}
		var m message
		if json.Unmarshal(data, &m) == nil {
			s.dispatch(m)
		}
	}
}

// failPending ends every waiting call with the connection's error.
func (s *Session) failPending(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.readErr = err
	for id, ch := range s.pending {
		ch <- reply{Err: fmt.Errorf("inspector connection closed: %w", err)}
		delete(s.pending, id)
	}
}

// dispatch hands a reply to its waiting call, or an event to the handler.
func (s *Session) dispatch(m message) {
	s.mu.Lock()
	if m.ID == 0 {
		handler := s.onEvent
		s.mu.Unlock()
		if handler != nil && m.Method != "" {
			handler(m.Method, m.Params)
		}
		return
	}
	defer s.mu.Unlock()
	ch, ok := s.pending[m.ID]
	if !ok {
		return
	}
	delete(s.pending, m.ID)
	r := reply{Result: m.Result}
	if m.Error != nil {
		r.Err = fmt.Errorf("inspector: %s", m.Error.Message)
	}
	ch <- r
}

// Call sends one CDP command and waits for its result.
func (s *Session) Call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	if params == nil {
		params = struct{}{}
	}
	s.mu.Lock()
	if s.readErr != nil {
		s.mu.Unlock()
		return nil, fmt.Errorf("inspector connection closed: %w", s.readErr)
	}
	s.nextID++
	id := s.nextID
	ch := make(chan reply, 1)
	s.pending[id] = ch
	s.mu.Unlock()
	body, err := json.Marshal(map[string]any{"id": id, "method": method, "params": params})
	if err != nil {
		return nil, err
	}
	if err := s.conn.Write(ctx, websocket.MessageText, body); err != nil {
		return nil, fmt.Errorf("%s: %w", method, err)
	}
	select {
	case r := <-ch:
		if r.Err != nil {
			return nil, fmt.Errorf("%s: %w", method, r.Err)
		}
		return r.Result, nil
	case <-ctx.Done():
		return nil, fmt.Errorf("%s: %w", method, ctx.Err())
	}
}

// OnEvent sets the handler for CDP events (one at a time).
func (s *Session) OnEvent(fn func(method string, params json.RawMessage)) {
	s.mu.Lock()
	s.onEvent = fn
	s.mu.Unlock()
}

// CPUOptions shape a CPU profile: how long, how often to sample, and what to
// run once sampling has started (a load to drive, say).
type CPUOptions struct {
	Duration time.Duration
	Interval time.Duration
	During   func()
}

// CPUProfile records a CPU profile and returns the .cpuprofile bytes.
func (s *Session) CPUProfile(ctx context.Context, o CPUOptions) ([]byte, error) {
	if _, err := s.Call(ctx, "Profiler.enable", nil); err != nil {
		return nil, err
	}
	if _, err := s.Call(ctx, "Profiler.setSamplingInterval", map[string]any{"interval": o.Interval.Microseconds()}); err != nil {
		return nil, err
	}
	if _, err := s.Call(ctx, "Profiler.start", nil); err != nil {
		return nil, err
	}
	if o.During != nil {
		o.During()
	}
	wait(ctx, o.Duration)
	stopCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
	defer cancel()
	raw, err := s.Call(stopCtx, "Profiler.stop", nil)
	if err != nil {
		return nil, err
	}
	_, _ = s.Call(stopCtx, "Profiler.disable", nil)
	var out struct {
		Profile json.RawMessage `json:"profile"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("read the CPU profile: %w", err)
	}
	return out.Profile, nil
}

// HeapSampling records a sampling heap profile for d. With collected true the
// profile keeps objects the GC has since freed (everything allocated over the
// window); without it, only what is still alive at the end.
func (s *Session) HeapSampling(ctx context.Context, d time.Duration, collected bool) ([]byte, error) {
	if _, err := s.Call(ctx, "HeapProfiler.enable", nil); err != nil {
		return nil, err
	}
	params := map[string]any{
		"samplingInterval":                 32768,
		"includeObjectsCollectedByMajorGC": collected,
		"includeObjectsCollectedByMinorGC": collected,
	}
	if _, err := s.Call(ctx, "HeapProfiler.startSampling", params); err != nil {
		return nil, err
	}
	wait(ctx, d)
	stopCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
	defer cancel()
	raw, err := s.Call(stopCtx, "HeapProfiler.stopSampling", nil)
	if err != nil {
		return nil, err
	}
	var out struct {
		Profile json.RawMessage `json:"profile"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("read the heap profile: %w", err)
	}
	return out.Profile, nil
}

// HeapSnapshot streams a full heap snapshot into w. The process is paused
// while V8 writes it: seconds, for a large heap.
func (s *Session) HeapSnapshot(ctx context.Context, w io.Writer) error {
	var writeErr error
	var wmu sync.Mutex
	s.OnEvent(func(method string, params json.RawMessage) {
		if method != "HeapProfiler.addHeapSnapshotChunk" {
			return
		}
		var chunk struct {
			Chunk string `json:"chunk"`
		}
		if json.Unmarshal(params, &chunk) != nil {
			return
		}
		wmu.Lock()
		defer wmu.Unlock()
		if writeErr == nil {
			_, writeErr = io.WriteString(w, chunk.Chunk)
		}
	})
	defer s.OnEvent(nil)
	if _, err := s.Call(ctx, "HeapProfiler.enable", nil); err != nil {
		return err
	}
	if _, err := s.Call(ctx, "HeapProfiler.takeHeapSnapshot", map[string]any{"reportProgress": false}); err != nil {
		return err
	}
	wmu.Lock()
	defer wmu.Unlock()
	return writeErr
}

// Memory is process.memoryUsage() in bytes.
type Memory struct {
	RSS       int64 `json:"rss"`
	HeapUsed  int64 `json:"heapUsed"`
	HeapTotal int64 `json:"heapTotal"`
	External  int64 `json:"external"`
}

// Memory reads the process's memory usage.
func (s *Session) Memory(ctx context.Context) (Memory, error) {
	var m Memory
	raw, err := s.Call(ctx, "Runtime.evaluate", map[string]any{
		"expression":    "JSON.stringify(process.memoryUsage())",
		"returnByValue": true,
	})
	if err != nil {
		return m, err
	}
	var out struct {
		Result struct {
			Value string `json:"value"`
		} `json:"result"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return m, err
	}
	if err := json.Unmarshal([]byte(out.Result.Value), &m); err != nil {
		return m, errors.New("process.memoryUsage() answered no JSON")
	}
	return m, nil
}

// closeInspector is evaluated in the process to close an inspector this
// session opened. inspector.close() waits for connected sessions to leave, so
// it runs on a timer, after this session has disconnected.
const closeInspector = `setTimeout(() => {
  const g = globalThis.process?.getBuiltinModule;
  const inspector = g ? g("node:inspector") : null;
  inspector?.close();
}, 200), "closing"`

// Close disconnects, first asking the process to close its inspector when
// this session opened it, and waits (up to 3s) to see the port go. It reports
// whether the inspector is still open.
func (s *Session) Close(ctx context.Context) (leftOpen bool) {
	asked := false
	if s.Opened {
		callCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		_, err := s.Call(callCtx, "Runtime.evaluate", map[string]any{"expression": closeInspector, "returnByValue": true})
		cancel()
		asked = err == nil
	}
	_ = s.conn.Close(websocket.StatusNormalClosure, "")
	defer s.stopRead()
	select {
	case <-s.done:
	case <-time.After(2 * time.Second):
	}
	if !asked {
		return true
	}
	for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); {
		if !slices.Contains(listenPorts(ctx, s.pid), s.Port) {
			return false
		}
		wait(ctx, 100*time.Millisecond)
	}
	return true
}

// wait sleeps for d or until ctx ends, whichever is first.
func wait(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
