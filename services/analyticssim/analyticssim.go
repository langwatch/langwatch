// Package analyticssim is a local stand-in for the product-analytics vendors
// the stack talks to: PostHog (posthog-node's /batch/, posthog-js's /e/ and
// flags) and Customer.io (the CDP API nurturing posts to, and the Track API).
// Every call is normalized into one Record and kept in memory, listed under
// /_sim/api/records for the console, apidiff and visualdiff.
//
// ponytail: keys are accepted, never checked. It is a dev shim; never expose it.
package analyticssim

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is analyticssim's environment-derived configuration.
type Config struct {
	// Addr is the listen address (ANALYTICSSIM_ADDR, default :5596).
	Addr string
	// Stack is the haven stack slug the console names (ANALYTICSSIM_STACK, may be empty).
	Stack string
	// MaxRecords is how many records the ring keeps (ANALYTICSSIM_MAX_RECORDS, default 5000).
	MaxRecords int
	// MaxRawBytes is the largest raw body kept per record; a bigger one is
	// replaced by a size marker (ANALYTICSSIM_MAX_RAW_BYTES, default 65536).
	MaxRawBytes int
	// Seed loads sample PostHog and Customer.io records at start (ANALYTICSSIM_SEED=1).
	Seed bool
}

// LoadConfig reads analyticssim's configuration from the environment.
func LoadConfig() Config {
	cfg := Config{
		Addr: os.Getenv("ANALYTICSSIM_ADDR"), Stack: os.Getenv("ANALYTICSSIM_STACK"),
		MaxRecords:  envInt("ANALYTICSSIM_MAX_RECORDS", 5000),
		MaxRawBytes: envInt("ANALYTICSSIM_MAX_RAW_BYTES", 64<<10),
		Seed:        os.Getenv("ANALYTICSSIM_SEED") == "1",
	}
	if cfg.Addr == "" {
		cfg.Addr = ":5596"
	}
	return cfg
}

func envInt(key string, fallback int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil && n > 0 {
		return n
	}
	return fallback
}

// maxBody bounds one provider call; session recordings are the largest.
const maxBody = 16 << 20

// Server answers the provider calls, the query API and the console.
type Server struct {
	cfg     Config
	records store
	now     func() time.Time
	mux     *http.ServeMux
	console http.Handler
}

// NewServer builds the server over the embedded console bundle.
func NewServer(cfg Config) *Server {
	return newServer(cfg, embeddedConsole())
}

func newServer(cfg Config, bundle fs.FS) *Server {
	if cfg.MaxRecords < 1 {
		cfg.MaxRecords = 5000
	}
	if cfg.MaxRawBytes < 1 {
		cfg.MaxRawBytes = 64 << 10
	}
	s := &Server{cfg: cfg, records: newStore(cfg.MaxRecords, cfg.MaxRawBytes), now: time.Now, console: newConsole(bundle)}
	if cfg.Seed {
		seeds := seedRecords()
		for i := range seeds {
			seeds[i].seeded = true
		}
		s.records.add(seeds, s.now())
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	// PostHog: posthog-node's batch, posthog-js's capture paths, and the legacy ones.
	for _, path := range []string{"/batch/", "/e/", "/i/v0/e/", "/capture/", "/track/", "/engage/"} {
		mux.HandleFunc("POST "+path, s.handlePostHogCapture)
	}
	mux.HandleFunc("POST /s/", s.handleDiscard) // session recordings: accepted, not kept
	mux.HandleFunc("POST /flags/", s.handlePostHogFlags)
	mux.HandleFunc("POST /decide/", s.handlePostHogFlags)
	mux.HandleFunc("GET /array/", s.handlePostHogRemoteConfig)
	mux.HandleFunc("GET /static/", handlePostHogExtension)
	// Customer.io: the CDP API nurturing posts to, and the Track API.
	mux.HandleFunc("POST /v1/{call}", s.handleCustomerIOCDP)
	mux.HandleFunc("PUT /api/v1/customers/{id}", s.handleCustomerIOTrack)
	mux.HandleFunc("POST /api/v1/customers/{id}/events", s.handleCustomerIOTrack)
	// The query API.
	mux.HandleFunc("GET /_sim/api/status", s.handleStatus)
	mux.HandleFunc("GET /_sim/api/records", s.handleRecords)
	mux.HandleFunc("DELETE /_sim/api/records", s.handleClear)
	// A provider or console path analyticssim does not fake is a 404, never the console page.
	for _, pattern := range []string{"POST /", "PUT /", "GET /api/", "GET /_sim/api/"} {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusNotFound, "analyticssim does not fake "+r.Method+" "+r.URL.Path)
		})
	}
	mux.HandleFunc("GET /", s.handleConsole)
	s.mux = mux
	return s
}

// Handler is the whole HTTP surface, for tests that drive it without a listener.
func (s *Server) Handler() http.Handler {
	return withCORS(s.mux)
}

// withCORS lets posthog-js on the app's origin post here, cookies and all.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", r.Header.Get("Access-Control-Request-Headers"))
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Serve listens on cfg.Addr until ctx is done.
func (s *Server) Serve(ctx context.Context) error {
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("binding %s: %w", s.cfg.Addr, err)
	}
	srv := &http.Server{Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
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

// writeError answers {"error": message}, the shape the console's fetch reads.
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// readBody is the request body with the PostHog clients' encodings undone.
func readBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		return nil, fmt.Errorf("reading the body: %w", err)
	}
	return decodeBody(body, bodyEncoding{
		contentEncoding: r.Header.Get("Content-Encoding"),
		compression:     r.URL.Query().Get("compression"),
		contentType:     r.Header.Get("Content-Type"),
	})
}

func (s *Server) handlePostHogCapture(w http.ResponseWriter, r *http.Request) {
	body, err := readBody(w, r)
	if err == nil {
		var records []Record
		if records, err = NormalizePostHog(body); err == nil {
			s.records.add(records, s.now())
			writeJSON(w, http.StatusOK, map[string]int{"status": 1})
			return
		}
	}
	writeError(w, http.StatusBadRequest, err.Error())
}

func (s *Server) handleDiscard(w http.ResponseWriter, r *http.Request) {
	_, _ = io.Copy(io.Discard, http.MaxBytesReader(w, r.Body, maxBody))
	writeJSON(w, http.StatusOK, map[string]int{"status": 1})
}

// handlePostHogExtension answers posthog-js's lazy extension scripts
// (exception autocapture, surveys, recorder) with an empty one, so the page
// logs no 404 and loads no real extension.
func handlePostHogExtension(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/javascript")
	w.WriteHeader(http.StatusOK)
}

// handlePostHogFlags answers every flag question with no flags, so both clients
// fall back to their defaults.
func (s *Server) handlePostHogFlags(w http.ResponseWriter, r *http.Request) {
	_, _ = io.Copy(io.Discard, http.MaxBytesReader(w, r.Body, maxBody))
	writeJSON(w, http.StatusOK, map[string]any{
		"flags": map[string]any{}, "featureFlags": map[string]any{}, "featureFlagPayloads": map[string]any{},
		"errorsWhileComputingFlags": false, "requestId": "analyticssim",
	})
}

// handlePostHogRemoteConfig is posthog-js's /array/{token}/config(.js): nothing configured.
func (s *Server) handlePostHogRemoteConfig(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, ".js") {
		w.Header().Set("Content-Type", "application/javascript")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{})
}

func (s *Server) handleCustomerIOCDP(w http.ResponseWriter, r *http.Request) {
	call := r.PathValue("call")
	switch call {
	case "identify", "track", "group", "alias", "page", "screen", "batch":
	default:
		writeError(w, http.StatusNotFound, "analyticssim does not fake POST /v1/"+call)
		return
	}
	body, err := readBody(w, r)
	if err == nil {
		var records []Record
		if records, err = NormalizeCustomerIOCDP(call, body); err == nil {
			s.records.add(records, s.now())
			writeJSON(w, http.StatusOK, map[string]any{})
			return
		}
	}
	writeError(w, http.StatusBadRequest, err.Error())
}

func (s *Server) handleCustomerIOTrack(w http.ResponseWriter, r *http.Request) {
	body, err := readBody(w, r)
	if err == nil {
		var record Record
		isEvent := strings.HasSuffix(r.URL.Path, "/events")
		if record, err = NormalizeCustomerIOTrack(r.PathValue("id"), isEvent, body); err == nil {
			s.records.add([]Record{record}, s.now())
			writeJSON(w, http.StatusOK, map[string]any{})
			return
		}
	}
	writeError(w, http.StatusBadRequest, err.Error())
}

// consoleStatus is what the console header says about this simulator.
type consoleStatus struct {
	Stack    string   `json:"stack"`
	Records  int      `json:"records"`
	BaseURL  string   `json:"baseUrl"`
	Activity Activity `json:"activity"`
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	writeJSON(w, http.StatusOK, consoleStatus{
		Stack: s.cfg.Stack, Records: s.records.count(), BaseURL: scheme + "://" + r.Host,
		Activity: s.records.activity(s.now().Add(-activityWindow)),
	})
}

// handleRecords lists records newest first, narrowed by ?provider, kind, id and name.
func (s *Server) handleRecords(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	writeJSON(w, http.StatusOK, map[string][]Record{"records": s.records.list(Filter{
		Provider: q.Get("provider"), Kind: q.Get("kind"), ID: q.Get("id"), Name: q.Get("name"),
	})})
}

func (s *Server) handleClear(w http.ResponseWriter, _ *http.Request) {
	s.records.clear()
	w.WriteHeader(http.StatusNoContent)
}
