// Package telemetrysim sends telemetry to a stack's OTLP HTTP door: preset
// batches from a seed, sustained load at a target rate, and seeded fuzz whose
// every mutation id replays. haven drives it through /_sim/api.
//
// ponytail: one run at a time, counters in memory; a dev shim, never expose it.
package telemetrysim

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"sync"
	"time"
)

// Config is telemetrysim's environment-derived configuration.
type Config struct {
	// Addr is the listen address (TELEMETRYSIM_ADDR, default :5599).
	Addr string
	// Stack is the haven stack slug it reports (TELEMETRYSIM_STACK, may be empty).
	Stack string
}

// LoadConfig reads telemetrysim's configuration from the environment.
func LoadConfig() Config {
	cfg := Config{Addr: os.Getenv("TELEMETRYSIM_ADDR"), Stack: os.Getenv("TELEMETRYSIM_STACK")}
	if cfg.Addr == "" {
		cfg.Addr = ":5599"
	}
	return cfg
}

const (
	maxRetries   = 2
	retryBackoff = 50 * time.Millisecond
	maxInFlight  = 64
	maxCases     = 10000
	maxRate      = 10000
	maxDuration  = 2 * time.Hour
)

// Run states.
const (
	stateRunning = "running"
	stateDone    = "done"
	stateStopped = "stopped"
)

// RunRequest starts a run: send (Batches batches), load (Rate batches a second
// for Duration) or fuzz (Budget mutated batches).
type RunRequest struct {
	Mode     string   `json:"mode"`
	Preset   string   `json:"preset"`
	Seed     uint64   `json:"seed"`
	Endpoint string   `json:"endpoint"` // the OTLP HTTP base, e.g. https://app.<slug>.langwatch.localhost/api/otel
	APIKey   string   `json:"apiKey"`   // sent as a bearer token; never kept in the status
	Encoding Encoding `json:"encoding,omitempty"`
	NoGzip   bool     `json:"noGzip,omitempty"`
	Batches  int      `json:"batches,omitempty"`
	Rate     float64  `json:"rate,omitempty"`
	Duration string   `json:"duration,omitempty"`
	Budget   int      `json:"budget,omitempty"`
}

// Mutation is one fuzzed send and how the door answered it (0: no answer).
type Mutation struct {
	ID     string `json:"id"`
	Status int    `json:"status"`
	Error  string `json:"error,omitempty"`
}

// RunStatus is a run's settings and counters. Sent counts batches; each ends
// once as acked (2xx), refused (any other answer) or failed (no answer).
type RunStatus struct {
	Mode       string     `json:"mode"`
	Preset     string     `json:"preset"`
	Seed       uint64     `json:"seed"`
	Endpoint   string     `json:"endpoint"`
	Encoding   Encoding   `json:"encoding"`
	Gzip       bool       `json:"gzip"`
	State      string     `json:"state"`
	StartedAt  time.Time  `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt,omitempty"`
	TargetRate float64    `json:"targetRate,omitempty"`
	Sent       int64      `json:"sent"`
	Acked      int64      `json:"acked"`
	Refused    int64      `json:"refused"`
	Failed     int64      `json:"failed"`
	Retried    int64      `json:"retried"`
	Late       int64      `json:"late"` // load ticks skipped because maxInFlight sends were still out
	LastError  string     `json:"lastError,omitempty"`
	Mutations  []Mutation `json:"mutations,omitempty"`
}

// Status is GET /_sim/api/status.
type Status struct {
	Stack   string     `json:"stack"`
	Presets []string   `json:"presets"`
	Run     *RunStatus `json:"run,omitempty"`
}

type run struct {
	mu     sync.Mutex
	status RunStatus
	cancel context.CancelFunc
	done   chan struct{}
}

func (r *run) update(f func(*RunStatus)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	f(&r.status)
}

func (r *run) snapshot() RunStatus {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := r.status
	s.Mutations = slices.Clone(s.Mutations)
	return s
}

// delivery is one batch on its way to url.
type delivery struct {
	url     string
	apiKey  string
	payload Payload
}

// sender delivers one batch and answers the door's status. httpSender is
// OTLP/HTTP; an OTLP/gRPC sender joins it once the gRPC receiver exists.
type sender interface {
	send(ctx context.Context, d delivery) (int, error)
}

type httpSender struct{ client *http.Client }

func (h httpSender) send(ctx context.Context, d delivery) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.url, bytes.NewReader(d.payload.Body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", d.payload.ContentType)
	if d.payload.Gzip {
		req.Header.Set("Content-Encoding", "gzip")
	}
	if d.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+d.apiKey)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, nil
}

// Server is the control API and the one run it drives.
type Server struct {
	cfg    Config
	sender sender
	mu     sync.Mutex
	run    *run
	mux    *http.ServeMux
}

// NewServer builds the control API over an OTLP/HTTP sender.
func NewServer(cfg Config) *Server {
	s := &Server{cfg: cfg, sender: httpSender{client: &http.Client{Timeout: 30 * time.Second}}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, map[string]bool{"ok": true}) })
	mux.HandleFunc("GET /_sim/api/status", s.handleStatus)
	mux.HandleFunc("POST /_sim/api/runs", s.handleStart)
	mux.HandleFunc("DELETE /_sim/api/runs/current", s.handleStop)
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprintln(w, "telemetrysim: drive it with `haven telemetry send|load|fuzz|status|stop`")
	})
	s.mux = mux
	return s
}

// Handler is the whole HTTP surface, for tests that drive it without a listener.
func (s *Server) Handler() http.Handler { return s.mux }

// Serve listens until ctx ends, then stops the current run.
func (s *Server) Serve(ctx context.Context) error {
	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("telemetrysim listening on %s: %w", s.cfg.Addr, err)
	}
	srv := &http.Server{Handler: s.mux, ReadHeaderTimeout: 10 * time.Second}
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	s.stop()
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return srv.Shutdown(shutdown)
}

func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	st := Status{Stack: s.cfg.Stack, Presets: PresetNames()}
	s.mu.Lock()
	rn := s.run
	s.mu.Unlock()
	if rn != nil {
		snap := rn.snapshot()
		st.Run = &snap
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	var req RunRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "the run request is not JSON: "+err.Error())
		return
	}
	p, err := req.plan()
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rn, err := s.start(p)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	code := http.StatusAccepted
	if p.Mode == "send" {
		<-rn.done
		code = http.StatusOK
	}
	writeJSON(w, code, rn.snapshot())
}

func (s *Server) handleStop(w http.ResponseWriter, _ *http.Request) {
	rn := s.stop()
	if rn == nil {
		writeError(w, http.StatusNotFound, "no run to stop")
		return
	}
	writeJSON(w, http.StatusOK, rn.snapshot())
}

// plan is a checked RunRequest.
type plan struct {
	RunRequest
	preset   Preset
	duration time.Duration
}

func (req RunRequest) plan() (plan, error) {
	p := plan{RunRequest: req}
	preset, ok := presetByName(req.Preset)
	if !ok {
		return p, fmt.Errorf("unknown preset %q; presets: %s", req.Preset, strings.Join(PresetNames(), ", "))
	}
	p.preset = preset
	if err := p.checkWire(); err != nil {
		return p, err
	}
	err := p.checkMode()
	return p, err
}

func (p *plan) checkWire() error {
	if u, err := url.Parse(p.Endpoint); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("endpoint %q is not an http(s) URL", p.Endpoint)
	}
	if p.Encoding == "" {
		p.Encoding = EncodingProtobuf
	}
	if p.Encoding != EncodingProtobuf && p.Encoding != EncodingJSON {
		return fmt.Errorf("encoding %q is neither protobuf nor json", p.Encoding)
	}
	return nil
}

func (p *plan) checkMode() error {
	switch p.Mode {
	case "send":
		return defaultWithinCases(&p.Batches, 1, fmt.Sprintf("send takes 1 to %d batches", maxCases))
	case "load":
		return p.checkLoad()
	case "fuzz":
		return defaultWithinCases(&p.Budget, 100, fmt.Sprintf("fuzz takes a budget of 1 to %d", maxCases))
	default:
		return fmt.Errorf("mode %q is not send, load or fuzz", p.Mode)
	}
}

// defaultWithinCases fills an unset count with fallback and refuses one outside 1..maxCases.
func defaultWithinCases(n *int, fallback int, refusal string) error {
	if *n == 0 {
		*n = fallback
	}
	if *n < 1 || *n > maxCases {
		return errors.New(refusal)
	}
	return nil
}

func (p *plan) checkLoad() error {
	d, err := time.ParseDuration(p.Duration)
	if err != nil || d <= 0 || d > maxDuration {
		return fmt.Errorf("load needs a duration up to %s, e.g. 30s", maxDuration)
	}
	if p.Rate <= 0 || p.Rate > maxRate {
		return fmt.Errorf("load needs a rate above 0 and up to %d batches a second", maxRate)
	}
	p.duration = d
	return nil
}

func (s *Server) start(p plan) (*run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.run != nil && s.run.snapshot().State == stateRunning {
		return nil, errors.New("a run is already going; stop it first")
	}
	ctx, cancel := context.WithCancel(context.Background())
	rn := &run{cancel: cancel, done: make(chan struct{}), status: RunStatus{
		Mode: p.Mode, Preset: p.Preset, Seed: p.Seed, Endpoint: p.Endpoint, Encoding: p.Encoding,
		Gzip: !p.NoGzip, State: stateRunning, StartedAt: time.Now().UTC(), TargetRate: p.Rate,
	}}
	s.run = rn
	go func() {
		defer close(rn.done)
		defer cancel()
		s.execute(ctx, rn, p)
		rn.update(func(st *RunStatus) {
			now := time.Now().UTC()
			st.FinishedAt, st.State = &now, stateDone
			if ctx.Err() != nil {
				st.State = stateStopped
			}
		})
	}()
	return rn, nil
}

func (s *Server) stop() *run {
	s.mu.Lock()
	rn := s.run
	s.mu.Unlock()
	if rn != nil {
		rn.cancel()
		<-rn.done
	}
	return rn
}

func (s *Server) execute(ctx context.Context, rn *run, p plan) {
	started := rn.snapshot().StartedAt
	spec := func(i int) BatchSpec {
		return BatchSpec{Preset: p.preset, Seed: p.Seed, Index: i, Start: started, Encoding: p.Encoding, Gzip: !p.NoGzip}
	}
	target := delivery{url: strings.TrimRight(p.Endpoint, "/") + "/v1/" + string(p.preset.Signal), apiKey: p.APIKey}
	deliver := func(i int) {
		payload, err := Build(spec(i))
		if err != nil {
			rn.update(func(st *RunStatus) { st.LastError = err.Error() })
			return
		}
		d := target
		d.payload = payload
		_, _ = s.send(ctx, rn, d)
	}
	switch p.Mode {
	case "send":
		for i := 0; i < p.Batches && ctx.Err() == nil; i++ {
			deliver(i)
		}
	case "fuzz":
		for i := 0; i < p.Budget && ctx.Err() == nil; i++ {
			s.fuzzOne(ctx, fuzzTask{rn: rn, target: target, spec: spec(i)})
		}
	case "load":
		rn.load(ctx, p, deliver)
	}
}

// load sends open-loop: one batch per tick whether or not earlier ones were
// answered, so a slow door cannot slow the arrival rate and hide its latency.
func (rn *run) load(ctx context.Context, p plan, deliver func(int)) {
	ticker := time.NewTicker(time.Duration(float64(time.Second) / p.Rate))
	defer ticker.Stop()
	end := time.NewTimer(p.duration)
	defer end.Stop()
	slots := make(chan struct{}, maxInFlight)
	var wg sync.WaitGroup
	defer wg.Wait()
	for i := 0; ; i++ {
		select {
		case <-ctx.Done():
			return
		case <-end.C:
			return
		case <-ticker.C:
		}
		select {
		case slots <- struct{}{}:
		default:
			rn.update(func(st *RunStatus) { st.Late++ })
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-slots }()
			deliver(i)
		}()
	}
}

// fuzzTask is one mutated batch to send for a run.
type fuzzTask struct {
	rn     *run
	target delivery
	spec   BatchSpec
}

func (s *Server) fuzzOne(ctx context.Context, task fuzzTask) {
	rn, target := task.rn, task.target
	id, payload, err := FuzzCase(task.spec)
	if err != nil {
		rn.update(func(st *RunStatus) { st.LastError = err.Error() })
		return
	}
	target.payload = payload
	status, sendErr := s.send(ctx, rn, target)
	m := Mutation{ID: id, Status: status}
	if sendErr != nil {
		m.Error = sendErr.Error()
	}
	rn.update(func(st *RunStatus) { st.Mutations = append(st.Mutations, m) })
}

// send delivers one batch, retrying a 429, 502 to 504 or no answer at most
// maxRetries times, and counts how it ended.
func (s *Server) send(ctx context.Context, rn *run, d delivery) (int, error) {
	rn.update(func(st *RunStatus) { st.Sent++ })
	var status int
	var err error
	for attempt := 0; ; attempt++ {
		status, err = s.sender.send(ctx, d)
		if attempt == maxRetries || !retryable(status, err) || !sleep(ctx, retryBackoff*time.Duration(attempt+1)) {
			break
		}
		rn.update(func(st *RunStatus) { st.Retried++ })
	}
	rn.update(func(st *RunStatus) {
		switch {
		case err != nil:
			st.Failed++
			st.LastError = err.Error()
		case status >= 200 && status < 300:
			st.Acked++
		default:
			st.Refused++
			st.LastError = fmt.Sprintf("the door answered %d", status)
		}
	})
	return status, err
}

func retryable(status int, err error) bool {
	return err != nil || status == http.StatusTooManyRequests || (status >= 502 && status <= 504)
}

func sleep(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, code, map[string]string{"error": message})
}
