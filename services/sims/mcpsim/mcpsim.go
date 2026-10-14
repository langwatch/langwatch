// Package mcpsim stands in for MCP clients (Claude Desktop, Claude Code, Cursor)
// against LangWatch's hosted MCP endpoint: the API key flow and the OAuth flow
// (discovery, client registration, PKCE, approval, code exchange, refresh), on
// /mcp and on /sse, through named scenarios whose every exchange is recorded
// with its status, latency and pass or fail. haven drives it through /_sim/api.
//
// ponytail: runs, steps and the OAuth grant live in memory and are bounded; a
// dev shim, never expose it.
package mcpsim

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/langwatch/langwatch/pkg/webconsole"
)

// Config is mcpsim's environment-derived configuration.
type Config struct {
	Addr  string // MCPSIM_ADDR, default :5598
	Stack string // MCPSIM_STACK
	// Endpoint is the LangWatch base URL; the hosted MCP endpoint is Endpoint+"/mcp" (MCPSIM_ENDPOINT).
	Endpoint string
	// APIKey is the project key the API key flow presents (MCPSIM_API_KEY). Never reported.
	APIKey string
	// ProjectID is the project an automated OAuth approval grants (MCPSIM_PROJECT_ID).
	ProjectID string
	// PublicURL is the sim's own URL; the OAuth redirect_uri is PublicURL+"/callback" (MCPSIM_PUBLIC_URL).
	PublicURL string
	// Cookie is a LangWatch browser session for automated approval (MCPSIM_COOKIE). Never reported.
	Cookie string
	// SignInEmail and SignInPassword let the sim sign in itself on a local stack
	// for automated approval (MCPSIM_SIGNIN_EMAIL, MCPSIM_SIGNIN_PASSWORD). Never reported.
	SignInEmail, SignInPassword string
	// ApprovalTimeout bounds how long an interactive connect waits for the browser (default 10m).
	ApprovalTimeout time.Duration
}

// LoadConfig reads mcpsim's configuration from the environment.
func LoadConfig() Config {
	cfg := Config{
		Addr: cmp.Or(os.Getenv("MCPSIM_ADDR"), ":5598"), Stack: os.Getenv("MCPSIM_STACK"),
		Endpoint: strings.TrimRight(os.Getenv("MCPSIM_ENDPOINT"), "/"), APIKey: os.Getenv("MCPSIM_API_KEY"),
		ProjectID: os.Getenv("MCPSIM_PROJECT_ID"), PublicURL: strings.TrimRight(os.Getenv("MCPSIM_PUBLIC_URL"), "/"),
		Cookie: os.Getenv("MCPSIM_COOKIE"), SignInEmail: os.Getenv("MCPSIM_SIGNIN_EMAIL"), SignInPassword: os.Getenv("MCPSIM_SIGNIN_PASSWORD"),
	}
	return cfg
}

const (
	maxRuns     = 50   // runs kept, newest first; the oldest finished one goes first
	maxRunning  = 16   // runs going at once
	maxSteps    = 1000 // steps a run keeps; a longer run keeps the newest
	maxSamples  = 4096 // latency samples a run keeps
	maxClients  = 500
	maxDuration = 2 * time.Hour
	maxHold     = 2 * time.Hour
)

// Server is the control API, the OAuth callback and the runs.
type Server struct {
	cfg     Config
	http    *http.Client
	console http.Handler
	grants  *grantStore
	mux     *http.ServeMux
	// sleep waits d unless ctx ends first; tests shorten it.
	sleep func(ctx context.Context, d time.Duration) bool

	mu      sync.Mutex
	runs    []*run // newest first
	seq     int
	pending map[string]chan callbackResult // interactive connects by state
}

// NewServer builds the control API.
func NewServer(cfg Config) *Server {
	if cfg.ApprovalTimeout == 0 {
		cfg.ApprovalTimeout = 10 * time.Minute
	}
	cfg.Endpoint = strings.TrimRight(cfg.Endpoint, "/")
	cfg.PublicURL = strings.TrimRight(cfg.PublicURL, "/")
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConnsPerHost = 256
	s := &Server{
		cfg: cfg, http: &http.Client{Transport: transport}, grants: &grantStore{},
		console: webconsole.New(embeddedConsole(), consoleBuildCommand), sleep: sleepCtx,
		pending: map[string]chan callbackResult{},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, map[string]bool{"ok": true}) })
	mux.HandleFunc("GET /_sim/api/status", s.handleStatus)
	mux.HandleFunc("GET /_sim/api/runs", s.handleRuns)
	mux.HandleFunc("POST /_sim/api/runs", s.handleStart)
	mux.HandleFunc("DELETE /_sim/api/runs", s.handleClear)
	mux.HandleFunc("GET /_sim/api/runs/{id}", s.handleRun)
	mux.HandleFunc("DELETE /_sim/api/runs/{id}", s.handleStop)
	mux.HandleFunc("POST /_sim/api/oauth/connect", s.handleConnect)
	mux.HandleFunc("GET /_sim/api/oauth", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, s.grants.status()) })
	mux.HandleFunc("DELETE /_sim/api/oauth", func(w http.ResponseWriter, _ *http.Request) {
		s.grants.set(nil)
		writeJSON(w, http.StatusOK, s.grants.status())
	})
	mux.HandleFunc("GET /callback", s.handleCallback)
	mux.HandleFunc("GET /", s.handleConsole)
	s.mux = mux
	return s
}

// Handler is the whole HTTP surface, for tests that drive it without a listener.
func (s *Server) Handler() http.Handler { return s.mux }

// Serve listens until ctx ends, then stops every run.
func (s *Server) Serve(ctx context.Context) error {
	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("mcpsim listening on %s: %w", s.cfg.Addr, err)
	}
	if s.cfg.PublicURL == "" {
		s.cfg.PublicURL = "http://" + loopback(ln.Addr().String())
	}
	srv := &http.Server{Handler: s.mux, ReadHeaderTimeout: 10 * time.Second}
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	s.stopAll()
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return srv.Shutdown(shutdown)
}

func loopback(addr string) string {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return "127.0.0.1:" + port
}

func (s *Server) callbackURL() string { return s.cfg.PublicURL + "/callback" }

// run is one scenario's state; every field behind mu.
type run struct {
	mu      sync.Mutex
	st      RunStatus
	samples []float64
	next    int
	cancel  context.CancelFunc
	done    chan struct{}
}

func (r *run) update(f func(*RunStatus)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	f(&r.st)
}

// step keeps one step, dropping the oldest past maxSteps.
func (r *run) step(st Step) {
	if st.At.IsZero() {
		st.At = time.Now().UTC()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.st.Steps) >= maxSteps {
		r.st.Steps = append(r.st.Steps[:0], r.st.Steps[1:]...)
		r.st.StepsDropped++
	}
	r.st.Steps = append(r.st.Steps, st)
}

// httpStep fills a step from a plain exchange and keeps it.
func (r *run) httpStep(st Step, x exchange) {
	st.Status, st.LatencyMs = x.status, ms(x.took)
	if x.err != nil {
		st.Error = x.err.Error()
	} else if !st.OK && len(x.body) > 0 && st.Detail == "" {
		st.Error = clip(string(x.body), 300)
	}
	r.attempt(x.status, x.took)
	r.step(st)
}

func (r *run) check(name string, pass bool, detail string) {
	r.update(func(st *RunStatus) { st.Checks = append(st.Checks, Check{Name: name, Pass: pass, Detail: detail}) })
}

// attempt counts one HTTP attempt: its latency, and its status where it had one.
func (r *run) attempt(status int, took time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.samples) < maxSamples {
		r.samples = append(r.samples, ms(took))
	} else {
		r.samples[r.next] = ms(took)
		r.next = (r.next + 1) % maxSamples
	}
	if l := r.st.Load; l != nil {
		l.Requests++
		if status != 0 {
			if l.Answers == nil {
				l.Answers = map[int]int64{}
			}
			l.Answers[status]++
		}
	}
}

// counted changes the load counters of a soak run; other runs have none.
func (r *run) counted(f func(*LoadStats)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.st.Load != nil {
		f(r.st.Load)
	}
}

func (r *run) snapshot(withSteps bool) RunStatus {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := r.st
	s.Checks = slices.Clone(s.Checks)
	if withSteps {
		s.Steps = slices.Clone(s.Steps)
	} else {
		s.Steps = []Step{}
	}
	if s.Checks == nil {
		s.Checks = []Check{}
	}
	if s.Steps == nil {
		s.Steps = []Step{}
	}
	if s.Load != nil {
		l := *s.Load
		l.Answers = cloneAnswers(l.Answers)
		l.Latency = latencyOf(r.samples)
		s.Load = &l
	}
	if s.FinishedAt == nil {
		s.DurationMs = ms(time.Since(s.StartedAt))
	}
	return s
}

func cloneAnswers(m map[int]int64) map[int]int64 {
	if m == nil {
		return nil
	}
	out := make(map[int]int64, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func (r *run) active() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.st.State == StateRunning || r.st.State == StateWaiting
}

func latencyOf(samples []float64) *Latency {
	if len(samples) == 0 {
		return nil
	}
	sorted := slices.Sorted(slices.Values(samples))
	at := func(q float64) float64 { return sorted[max(0, int(math.Ceil(q*float64(len(sorted))))-1)] }
	return &Latency{Samples: len(sorted), P50: at(0.5), P90: at(0.9), P99: at(0.99), Max: sorted[len(sorted)-1]}
}

// start registers a run and executes body in the background. The run passes
// when body returns nil and every check passed.
func (s *Server) start(st RunStatus, body func(ctx context.Context, rn *run) error) (*run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if running := s.activeCount(); running >= maxRunning {
		return nil, fmt.Errorf("%d runs are already going; stop one first", running)
	}
	s.seq++
	ctx, cancel := context.WithCancel(context.Background())
	st.ID, st.State, st.StartedAt = fmt.Sprintf("run-%d", s.seq), StateRunning, time.Now().UTC()
	st.Steps, st.Checks = []Step{}, []Check{}
	rn := &run{st: st, cancel: cancel, done: make(chan struct{})}
	s.runs = append([]*run{rn}, s.runs...)
	s.prune()
	go func() {
		defer close(rn.done)
		defer cancel()
		rn.finish(ctx, body(ctx, rn))
	}()
	return rn, nil
}

// activeCount is how many runs are going; the caller holds s.mu.
func (s *Server) activeCount() int {
	n := 0
	for _, r := range s.runs {
		if r.active() {
			n++
		}
	}
	return n
}

// finish settles a run's outcome: stopped, passed (every check passed), or failed.
func (r *run) finish(ctx context.Context, err error) {
	r.update(func(st *RunStatus) {
		now := time.Now().UTC()
		st.FinishedAt, st.DurationMs = &now, ms(now.Sub(st.StartedAt))
		passed := err == nil && len(st.Checks) > 0 && !slices.ContainsFunc(st.Checks, func(c Check) bool { return !c.Pass })
		switch {
		case ctx.Err() != nil:
			st.State = StateStopped
		case passed:
			st.State = StatePassed
		default:
			st.State = StateFailed
		}
		if err != nil {
			st.Error = err.Error()
		}
	})
}

// prune drops the oldest finished runs past maxRuns; the caller holds s.mu.
func (s *Server) prune() {
	for len(s.runs) > maxRuns {
		dropped := false
		for j := len(s.runs) - 1; j >= 0; j-- {
			if !s.runs[j].active() {
				s.runs = slices.Delete(s.runs, j, j+1)
				dropped = true
				break
			}
		}
		if !dropped {
			return
		}
	}
}

func (s *Server) find(id string) *run {
	s.mu.Lock()
	defer s.mu.Unlock()
	if (id == "latest" || id == "current") && len(s.runs) > 0 {
		return s.runs[0]
	}
	for _, r := range s.runs {
		if r.snapshot(false).ID == id {
			return r
		}
	}
	return nil
}

func (s *Server) stopAll() {
	s.mu.Lock()
	runs := slices.Clone(s.runs)
	s.mu.Unlock()
	for _, r := range runs {
		r.cancel()
		<-r.done
	}
}

func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	st := Status{
		Stack: s.cfg.Stack, Endpoint: s.cfg.Endpoint, KeyHint: hint(s.cfg.APIKey), ProjectID: s.cfg.ProjectID,
		CallbackURL: s.callbackURL(), OAuth: s.grants.status(), Scenarios: scenarios, Runs: s.list(),
	}
	if s.cfg.APIKey != "" {
		st.KeySource = "MCPSIM_API_KEY"
	}
	switch {
	case s.cfg.Cookie != "":
		st.AutoApprove = "cookie"
	case s.cfg.SignInEmail != "" && s.cfg.SignInPassword != "":
		st.AutoApprove = "sign-in " + s.cfg.SignInEmail
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) list() []RunStatus {
	s.mu.Lock()
	runs := slices.Clone(s.runs)
	s.mu.Unlock()
	out := make([]RunStatus, 0, len(runs))
	for _, r := range runs {
		out = append(out, r.snapshot(false))
	}
	return out
}

func (s *Server) handleRuns(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string][]RunStatus{"runs": s.list()})
}

func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	rn := s.find(r.PathValue("id"))
	if rn == nil {
		writeError(w, http.StatusNotFound, "no run "+r.PathValue("id")+"; the sim keeps the newest 50")
		return
	}
	writeJSON(w, http.StatusOK, rn.snapshot(true))
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	rn := s.find(r.PathValue("id"))
	if rn == nil {
		writeError(w, http.StatusNotFound, "no run "+r.PathValue("id"))
		return
	}
	rn.cancel()
	<-rn.done
	writeJSON(w, http.StatusOK, rn.snapshot(true))
}

// handleClear drops every finished run.
func (s *Server) handleClear(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	s.runs = slices.DeleteFunc(s.runs, func(r *run) bool { return !r.active() })
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string][]RunStatus{"runs": s.list()})
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	var req RunRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "the run request is not JSON: "+err.Error())
		return
	}
	p, err := s.plan(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rn, err := s.start(RunStatus{Scenario: p.Scenario, Flow: p.Flow, Client: p.persona.name, Endpoint: p.Endpoint, Transports: p.transports},
		func(ctx context.Context, rn *run) error { return s.execute(ctx, rn, p) })
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	reply{w, r}.answer(rn, req.Wait)
}

// reply is the request a run answers.
type reply struct {
	w http.ResponseWriter
	r *http.Request
}

// answer is 202 with the run as it started, or 200 with it finished when the caller waits.
func (rp reply) answer(rn *run, wait bool) {
	if !wait {
		writeJSON(rp.w, http.StatusAccepted, rn.snapshot(true))
		return
	}
	select {
	case <-rn.done:
	case <-rp.r.Context().Done():
		return
	}
	writeJSON(rp.w, http.StatusOK, rn.snapshot(true))
}

const (
	modeAuto        = "auto"
	modeInteractive = "interactive"
)

func (s *Server) handleConnect(w http.ResponseWriter, r *http.Request) {
	var req ConnectRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "the connect request is not JSON: "+err.Error())
		return
	}
	if err := s.checkConnect(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rn, err := s.start(RunStatus{Scenario: ScenarioOAuthConnect, Flow: FlowOAuth, Client: req.Client, Endpoint: req.Endpoint, Transports: []string{"/mcp"}},
		func(ctx context.Context, rn *run) error { return s.connectOAuth(ctx, rn, req) })
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if !req.Wait && req.Mode == modeInteractive {
		rn.awaitAuthorizeURL()
	}
	reply{w, r}.answer(rn, req.Wait)
}

// awaitAuthorizeURL waits (up to ten seconds) until an interactive connect has its authorize URL, so the caller can show it at once.
func (r *run) awaitAuthorizeURL() {
	for i := 0; i < 200 && r.snapshot(false).AuthorizeURL == "" && r.active(); i++ {
		time.Sleep(50 * time.Millisecond)
	}
}

// checkConnect fills a connect request's defaults and refuses one the sim cannot carry out.
func (s *Server) checkConnect(req *ConnectRequest) error {
	req.Endpoint = strings.TrimRight(cmp.Or(req.Endpoint, s.cfg.Endpoint), "/")
	req.Client = cmp.Or(req.Client, "claude-code")
	if err := checkEndpoint(req.Endpoint); err != nil {
		return err
	}
	if _, ok := personas[req.Client]; !ok {
		return fmt.Errorf("client %q is not claude-code, claude-desktop or cursor", req.Client)
	}
	if s.cfg.PublicURL == "" {
		return errors.New("the sim has no public URL for the OAuth callback (MCPSIM_PUBLIC_URL)")
	}
	return s.checkMode(req)
}

// checkMode defaults the approval mode to auto when the sim has a session to approve with.
func (s *Server) checkMode(req *ConnectRequest) error {
	hasSession := req.Cookie != "" || s.cfg.Cookie != "" || (s.cfg.SignInEmail != "" && s.cfg.SignInPassword != "")
	if req.Mode == "" {
		req.Mode = modeInteractive
		if hasSession {
			req.Mode = modeAuto
		}
	}
	switch {
	case req.Mode != modeAuto && req.Mode != modeInteractive:
		return fmt.Errorf("mode %q is neither auto nor interactive", req.Mode)
	case req.Mode == modeAuto && !hasSession:
		return errors.New("auto approval needs a LangWatch session: pass cookie, or set MCPSIM_COOKIE or MCPSIM_SIGNIN_EMAIL and MCPSIM_SIGNIN_PASSWORD")
	}
	return nil
}

func checkEndpoint(endpoint string) error {
	if u, err := url.Parse(endpoint); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("endpoint %q is not an http(s) URL; pass endpoint or set MCPSIM_ENDPOINT", endpoint)
	}
	return nil
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
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
