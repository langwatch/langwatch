// Package mcpsim stands in for MCP clients (Claude Desktop, Claude Code, Cursor)
// against LangWatch's hosted MCP endpoint over /mcp and /sse, with the API key and
// OAuth flows, through named scenarios whose exchanges are recorded. haven drives it
// through /_sim/api. State is in memory and bounded; a dev shim, never expose it.
package mcpsim

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/langwatch/langwatch/pkg/webconsole"
)

// Config is mcpsim's environment-derived configuration.
type Config struct {
	Addr  string // MCPSIM_ADDR, default 127.0.0.1:5598: it holds credentials, so loopback only
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
		Addr: cmp.Or(os.Getenv("MCPSIM_ADDR"), "127.0.0.1:5598"), Stack: os.Getenv("MCPSIM_STACK"),
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
	handler http.Handler
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
	mux.HandleFunc("POST /_sim/api/runs", jsonOnly(s.handleStart))
	mux.HandleFunc("DELETE /_sim/api/runs", s.handleClear)
	mux.HandleFunc("GET /_sim/api/runs/{id}", s.handleRun)
	mux.HandleFunc("DELETE /_sim/api/runs/{id}", s.handleStop)
	mux.HandleFunc("POST /_sim/api/oauth/connect", jsonOnly(s.handleConnect))
	mux.HandleFunc("GET /_sim/api/oauth", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, s.grants.status()) })
	mux.HandleFunc("DELETE /_sim/api/oauth", func(w http.ResponseWriter, _ *http.Request) {
		s.grants.set(nil)
		writeJSON(w, http.StatusOK, s.grants.status())
	})
	mux.HandleFunc("GET /callback", s.handleCallback)
	mux.HandleFunc("GET /", s.handleConsole)
	s.handler = localOnly(mux)
	return s
}

// Handler is the whole HTTP surface, for tests that drive it without a listener.
func (s *Server) Handler() http.Handler { return s.handler }

// Serve listens until ctx ends, then stops every run.
func (s *Server) Serve(ctx context.Context) error {
	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("mcpsim listening on %s: %w", s.cfg.Addr, err)
	}
	if s.cfg.PublicURL == "" {
		s.cfg.PublicURL = "http://" + loopback(ln.Addr().String())
	}
	srv := &http.Server{Handler: s.handler, ReadHeaderTimeout: 10 * time.Second}
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
