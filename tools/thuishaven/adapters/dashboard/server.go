// Package dashboard implements app.Dashboard: the daemon's HTTP surface — the
// dashboard page (which worktree runs what), the registry API, and the telemetry
// fan-out that broadcasts one OTLP export to every running stack.
package dashboard

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
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Server renders live state pulled through the callbacks it is built with, so it
// never imports the app core.
type Server struct {
	stacks    func() []domain.Stack
	sharedURL func(service string) string // builds langwatch/observability/telemetry URLs
	probes    Probes
}

// Probes are the optional OS checks the page uses to show live health and
// resource numbers. A nil PortInUse leaves every service dot in its default
// "down" state (the page can't confirm the port is listening); a nil GroupRSS or
// TotalMemory simply blanks the stat it feeds, and a nil ProcessAlive falls back
// to treating a stack with a launcher PID as live.
type Probes struct {
	PortInUse    func(port int) bool
	ProcessAlive func(pid int) bool
	GroupRSS     func(pid int) uint64
	TotalMemory  func() uint64
}

// New builds a Server. stacks yields the live registry; sharedURL builds the
// shared-surface URLs (dashboard root, observability, telemetry).
func New(stacks func() []domain.Stack, sharedURL func(string) string, probes Probes) *Server {
	return &Server{stacks: stacks, sharedURL: sharedURL, probes: probes}
}

// Serve runs the HTTP surface until the context is cancelled.
func (s *Server) Serve(ctx context.Context, port int) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "ok") })
	mux.HandleFunc("/api/registry", s.handleRegistry)
	mux.HandleFunc("/v1/", s.handleTelemetry) // OTLP: /v1/traces, /v1/metrics, /v1/logs
	mux.HandleFunc("/", s.handleIndex)
	srv := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", port), Handler: s.guardHost(mux), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// guardHost rejects any request whose Host header is neither loopback nor a
// hostname under haven's own domain. Binding 127.0.0.1 already stops remote TCP
// connections, but a DNS-rebinding page can still make a victim's browser issue
// loopback requests carrying an attacker-controlled Host — pinning the Host to
// haven's own domain (langwatch.localhost and its subdomains) closes that
// same-origin hole without listing every stack host individually.
func (s *Server) guardHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.hostAllowed(r.Host) {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// hostAllowed reports whether host (an HTTP Host header, possibly with a port) is
// loopback or falls under the domain haven registers its hostnames beneath.
func (s *Server) hostAllowed(host string) bool {
	h := host
	if hostOnly, _, err := net.SplitHostPort(h); err == nil {
		h = hostOnly
	}
	h = strings.ToLower(strings.TrimSpace(h))
	switch h {
	case "", "127.0.0.1", "::1", "localhost":
		return true
	}
	// The base domain haven owns (langwatch.localhost), derived live from the
	// shared-surface URL so it honours a custom LANGWATCH_LOCAL_TLD. The bare
	// domain is the dashboard root; every stack host and the observability /
	// telemetry surfaces are subdomains of it.
	u, err := url.Parse(s.sharedURL("langwatch"))
	if err != nil {
		return false
	}
	base := strings.ToLower(u.Hostname())
	if base == "" {
		return false
	}
	return h == base || strings.HasSuffix(h, "."+base)
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, renderHTML(s.stacks(), s.sharedURL, s.probes))
}

// registryStack mirrors domain.Stack for the unauthenticated /api/registry
// response, dropping LocalAPIKey — any local process can hit this endpoint, and
// the dev API key must not leak to it.
type registryStack struct {
	Slug               string           `json:"slug"`
	WorktreeDir        string           `json:"worktreeDir"`
	Branch             string           `json:"branch"`
	LauncherPID        int              `json:"launcherPid"`
	RedisDB            int              `json:"redisDb"`
	APIPort            int              `json:"apiPort"`
	WorkerMetricsPort  int              `json:"workerMetricsPort"`
	ClickHouseHTTPPort int              `json:"clickhouseHttpPort"`
	ClickHouseDatabase string           `json:"clickhouseDatabase"`
	Baseline           bool             `json:"baseline,omitempty"`
	Services           []domain.Service `json:"services"`
	UpdatedAt          time.Time        `json:"updatedAt"`
}

func toRegistryStack(st domain.Stack) registryStack {
	return registryStack{
		Slug:               st.Slug,
		WorktreeDir:        st.WorktreeDir,
		Branch:             st.Branch,
		LauncherPID:        st.LauncherPID,
		RedisDB:            st.RedisDB,
		APIPort:            st.APIPort,
		WorkerMetricsPort:  st.WorkerMetricsPort,
		ClickHouseHTTPPort: st.ClickHouseHTTPPort,
		ClickHouseDatabase: st.ClickHouseDatabase,
		Baseline:           st.IsBaseline,
		Services:           st.Services,
		UpdatedAt:          st.UpdatedAt,
	}
}

func (s *Server) handleRegistry(w http.ResponseWriter, _ *http.Request) {
	stacks := s.stacks()
	out := make([]registryStack, len(stacks))
	for i, st := range stacks {
		out[i] = toRegistryStack(st)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"stacks":        out,
		"dashboard":     s.sharedURL("langwatch"),
		"observability": s.sharedURL("observability"),
		"telemetry":     s.sharedURL("telemetry"),
	})
}

// handleTelemetry broadcasts an incoming OTLP export to every running stack, so
// one exporter pointed at telemetry.langwatch.localhost lands in every worktree
// you have open. Best-effort and asynchronous — a slow or dead stack never
// blocks the caller.
func (s *Server) handleTelemetry(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "telemetry fan-out accepts POST", http.StatusMethodNotAllowed)
		return
	}
	// Cap the buffered body: the daemon holds it in RAM and hands a copy to a
	// goroutine per running stack, so an unbounded POST (a local process, or a
	// page CSRF-posting to the loopback port) could exhaust memory. 32 MiB is far
	// above any real OTLP export.
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			http.Error(w, "telemetry body too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "reading telemetry body: "+err.Error(), http.StatusBadRequest)
		return
	}
	prefix := os.Getenv("LANGWATCH_OTLP_FORWARD_PREFIX")
	if prefix == "" {
		prefix = "/api/otel"
	}
	ct := r.Header.Get("Content-Type")
	fanned := 0
	for _, st := range s.stacks() {
		for _, svc := range st.Services {
			if svc.Name != "app" {
				continue
			}
			fanned++
			go forward(strings.TrimRight(svc.URL, "/")+prefix+r.URL.Path, ct, body)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"fannedOutTo": fanned})
}

func forward(url, contentType string, body []byte) {
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	client := &http.Client{Timeout: 5 * time.Second}
	if resp, err := client.Do(req); err == nil {
		_ = resp.Body.Close()
	}
}
