// Package lambdasim is a local stand-in for the AWS Lambda and CloudWatch Logs
// calls the workflow module makes on its per-project NLP Lambda fleet. It keeps
// functions and log groups in memory and runs every invocation on the stack's
// own nlpgo over HTTP, framed the way the image's Lambda Web Adapter frames it
// (RESPONSE_STREAM). A console under /_sim shows recent invocations.
//
// ponytail: signatures and credentials are accepted, never checked. It is a dev shim; never expose it.
package lambdasim

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Defaults for LAMBDASIM_MAX_CALLS and LAMBDASIM_MAX_BODY_BYTES.
const (
	defaultMaxCalls  = 500
	defaultBodyBytes = 64 << 10
)

// Config is lambdasim's environment-derived configuration.
type Config struct {
	// Addr is the listen address (LAMBDASIM_ADDR, default :5594).
	Addr string
	// Stack is the haven stack slug the console names (LAMBDASIM_STACK, may be empty).
	Stack string
	// Target is the nlpgo base URL every invocation runs on (LAMBDASIM_TARGET).
	Target string
	// MaxCalls is how many recent invocations the console keeps (LAMBDASIM_MAX_CALLS).
	MaxCalls int
	// MaxBodyBytes is how much of each request and response body a call keeps (LAMBDASIM_MAX_BODY_BYTES).
	MaxBodyBytes int
}

// LoadConfig reads lambdasim's configuration from the environment.
func LoadConfig() Config {
	cfg := Config{
		Addr: os.Getenv("LAMBDASIM_ADDR"), Stack: os.Getenv("LAMBDASIM_STACK"), Target: os.Getenv("LAMBDASIM_TARGET"),
		MaxCalls:     envInt("LAMBDASIM_MAX_CALLS", defaultMaxCalls),
		MaxBodyBytes: envInt("LAMBDASIM_MAX_BODY_BYTES", defaultBodyBytes),
	}
	if cfg.Addr == "" {
		cfg.Addr = ":5594"
	}
	if cfg.Target == "" {
		cfg.Target = "http://127.0.0.1:5562" // nlpgo's own default address
	}
	return cfg
}

func envInt(key string, fallback int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil && n > 0 {
		return n
	}
	return fallback
}

// Forced errors an operator can set; "" lets invocations through.
const (
	ErrorThrottled     = "throttled"
	ErrorNotFound      = "not-found"
	ErrorFunctionError = "function-error"
	ErrorService       = "service"
)

// ForcedErrors are the accepted settings values, in display order.
var ForcedErrors = []string{"", ErrorThrottled, ErrorNotFound, ErrorFunctionError, ErrorService}

// Settings are the console's switches.
type Settings struct {
	ForcedError string `json:"forcedError"`
}

// Server answers the Lambda, CloudWatch Logs and console calls.
type Server struct {
	cfg     Config
	mux     *http.ServeMux
	console http.Handler
	client  *http.Client
	calls   *ring

	mu        sync.Mutex
	set       Settings
	functions map[string]*function
	logGroups map[string]int // name -> retention days
}

// NewServer builds the server over the embedded console bundle.
func NewServer(cfg Config) *Server {
	return newServer(cfg, embeddedConsole())
}

func newServer(cfg Config, bundle fs.FS) *Server {
	if cfg.MaxCalls <= 0 {
		cfg.MaxCalls = defaultMaxCalls
	}
	if cfg.MaxBodyBytes <= 0 {
		cfg.MaxBodyBytes = defaultBodyBytes
	}
	cfg.Target = strings.TrimRight(cfg.Target, "/")
	s := &Server{
		cfg: cfg, console: newConsole(bundle), client: &http.Client{}, calls: newRing(cfg.MaxCalls),
		functions: map[string]*function{}, logGroups: map[string]int{},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /2015-03-31/functions", s.handleListFunctions)
	mux.HandleFunc("GET /2015-03-31/functions/{$}", s.handleListFunctions)
	mux.HandleFunc("POST /2015-03-31/functions", s.handleCreateFunction)
	mux.HandleFunc("POST /2015-03-31/functions/{$}", s.handleCreateFunction)
	mux.HandleFunc("GET /2015-03-31/functions/{name}", s.handleGetFunction)
	mux.HandleFunc("GET /2015-03-31/functions/{name}/configuration", s.handleGetConfiguration)
	mux.HandleFunc("DELETE /2015-03-31/functions/{name}", s.handleDeleteFunction)
	mux.HandleFunc("PUT /2015-03-31/functions/{name}/code", s.handleUpdateCode)
	mux.HandleFunc("PUT /2015-03-31/functions/{name}/configuration", s.handleUpdateConfiguration)
	mux.HandleFunc("POST /2015-03-31/functions/{name}/invocations", s.handleInvoke)
	mux.HandleFunc("POST /2021-11-15/functions/{name}/response-streaming-invocations", s.handleInvokeStream)
	// CloudWatch Logs is JSON 1.1: every operation is a POST to / named by X-Amz-Target.
	mux.HandleFunc("POST /{$}", s.handleLogs)
	mux.HandleFunc("GET /_sim/api/info", s.handleInfo)
	mux.HandleFunc("GET /_sim/api/calls", s.handleCalls)
	mux.HandleFunc("GET /_sim/api/calls/{id}", s.handleCall)
	mux.HandleFunc("DELETE /_sim/api/calls", s.handleClearCalls)
	mux.HandleFunc("GET /_sim/api/settings", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, s.settings())
	})
	mux.HandleFunc("PUT /_sim/api/settings", s.handlePutSettings)
	// A Lambda or console path lambdasim does not fake is a 404, never the console page.
	for _, pattern := range []string{
		"GET /2015-03-31/", "POST /2015-03-31/", "PUT /2015-03-31/", "DELETE /2015-03-31/", "POST /2021-11-15/", "GET /_sim/api/",
	} {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			writeAWSError(w, http.StatusNotFound, "UnknownOperationException", "lambdasim does not fake "+r.Method+" "+r.URL.Path)
		})
	}
	mux.HandleFunc("GET /", s.handleConsole)
	s.mux = mux
	return s
}

// Handler is the whole HTTP surface, for tests that drive it without a listener.
func (s *Server) Handler() http.Handler { return s.mux }

// Serve listens on cfg.Addr until ctx is done.
func (s *Server) Serve(ctx context.Context) error {
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("binding %s: %w", s.cfg.Addr, err)
	}
	srv := &http.Server{Handler: s.mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func (s *Server) settings() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.set
}

func (s *Server) handleInfo(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	names := make([]string, 0, len(s.functions))
	for name := range s.functions {
		names = append(names, name)
	}
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"sim": "lambda", "stack": s.cfg.Stack, "target": s.cfg.Target, "capacity": s.cfg.MaxCalls,
		"functions": sortedStrings(names), "forcedErrors": ForcedErrors, "settings": s.settings(),
	})
}

func (s *Server) handleCalls(w http.ResponseWriter, _ *http.Request) {
	calls := s.calls.newest()
	for i := range calls {
		calls[i].Request, calls[i].Response = "", ""
	}
	writeJSON(w, http.StatusOK, map[string]any{"calls": calls})
}

func (s *Server) handleCall(w http.ResponseWriter, r *http.Request) {
	for _, c := range s.calls.newest() {
		if c.ID == r.PathValue("id") {
			writeJSON(w, http.StatusOK, c)
			return
		}
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "no recent call " + r.PathValue("id")})
}

func (s *Server) handleClearCalls(w http.ResponseWriter, _ *http.Request) {
	s.calls.clear()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var next Settings
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&next); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "settings body is not JSON: " + err.Error()})
		return
	}
	known := false
	for _, kind := range ForcedErrors {
		known = known || kind == next.ForcedError
	}
	if !known {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "forcedError is one of \"\", throttled, not-found, function-error, service"})
		return
	}
	s.mu.Lock()
	s.set = next
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, next)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeAWSError answers in Lambda's REST JSON error shape; the SDK names the error from the header.
func writeAWSError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("X-Amzn-ErrorType", code)
	writeJSON(w, status, map[string]string{"Type": "User", "message": message})
}
