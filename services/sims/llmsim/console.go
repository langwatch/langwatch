package llmsim

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/langwatch/langwatch/pkg/webconsole"
	"github.com/langwatch/langwatch/services/sims/simconsole"
)

// consoleBuildCommand is what the not-built page tells a developer to run.
const consoleBuildCommand = simconsole.BuildCommand

// embeddedConsole is the llm page of the apps/sims build this binary embeds (ADR-160).
func embeddedConsole() fs.FS {
	return simconsole.Page("llm")
}

func newConsole(bundle fs.FS) http.Handler {
	return webconsole.New(bundle, consoleBuildCommand)
}

func (s *Server) handleConsole(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy",
		"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "+
			"object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
	s.console.ServeHTTP(w, r)
}

// Defaults for LLMSIM_MAX_CALLS and LLMSIM_MAX_BODY_BYTES: the console keeps
// the newest calls, each with at most this much request body, so a few
// hundred agent transcripts cannot hold the process's memory hostage.
const (
	defaultRecentCalls = 500
	defaultBodyBytes   = 256 << 10
)

// Settings are the console's switches, applied to every call that does not
// carry its own header.
type Settings struct {
	// ForcedError answers every call with this status (0 is off).
	ForcedError int `json:"forcedError"`
	// Seed pins the random source ("" hashes each request, "random" draws).
	Seed string `json:"seed"`
	// NextJSON is the exact answer to the next JSON request, consumed once.
	NextJSON json.RawMessage `json:"nextJson,omitempty"`
}

// takeNextJSON hands out the queued JSON answer once, to a request that asks for JSON.
func (s *Server) takeNextJSON(req request) (string, bool) {
	if req.schema == nil && !req.jsonObject {
		return "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.set.NextJSON
	if len(next) == 0 {
		return "", false
	}
	s.set.NextJSON = nil
	return string(next), true
}

func (s *Server) settings() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.set
}

// record is one call the console lists; Request and Response are only in
// the detail answer.
type record struct {
	ID           string          `json:"id"`
	At           time.Time       `json:"at"`
	Path         string          `json:"path"`
	Dialect      string          `json:"dialect"`
	Model        string          `json:"model"`
	Mode         string          `json:"mode"`
	Stream       bool            `json:"stream"`
	Status       int             `json:"status"`
	InputTokens  int             `json:"inputTokens"`
	OutputTokens int             `json:"outputTokens"`
	LatencyMs    float64         `json:"latencyMs"`
	Error        string          `json:"error,omitempty"`
	Request      json.RawMessage `json:"request,omitempty"`
	Response     *reply          `json:"response,omitempty"`
}

func recordedBody(raw []byte, limit int) json.RawMessage {
	if len(raw) <= limit {
		return append(json.RawMessage{}, raw...)
	}
	b, _ := json.Marshal(map[string]any{"truncated": true, "bytes": len(raw), "head": string(raw[:min(4096, len(raw))])})
	return b
}

// ring is a bounded, newest-last buffer of calls.
type ring struct {
	mu    sync.Mutex
	items []record
	next  int
	seq   uint64
}

func newRing(size int) *ring {
	return &ring{items: make([]record, 0, size)}
}

func (r *ring) add(rec record) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seq++
	rec.ID = strconv.FormatUint(r.seq, 10)
	if len(r.items) < cap(r.items) {
		r.items = append(r.items, rec)
		return
	}
	r.items[r.next] = rec
	r.next = (r.next + 1) % len(r.items)
}

// newest lists the calls newest first.
func (r *ring) newest() []record {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]record, 0, len(r.items))
	for i := range r.items {
		out = append(out, r.items[(r.next+len(r.items)-1-i)%len(r.items)])
	}
	return out
}

// serveConsoleAPI answers the console: GET /info, GET /calls, GET
// /calls/{id}, DELETE /calls, and GET or PUT /settings.
func (s *Server) serveConsoleAPI(w http.ResponseWriter, r *http.Request, path string) {
	w.Header().Set("Cache-Control", "no-store")
	switch {
	case path == "/info" && r.Method == http.MethodGet:
		writeJSON(w, map[string]any{"sim": "llm", "stack": s.cfg.Stack, "models": Models, "capacity": s.cfg.MaxCalls, "settings": s.settings()})
	case path == "/calls" && r.Method == http.MethodGet:
		writeJSON(w, map[string]any{"calls": s.callSummaries()})
	case path == "/calls" && r.Method == http.MethodDelete:
		s.calls.mu.Lock()
		s.calls.items, s.calls.next = s.calls.items[:0], 0
		s.calls.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	case strings.HasPrefix(path, "/calls/") && r.Method == http.MethodGet:
		s.serveConsoleCall(w, strings.TrimPrefix(path, "/calls/"))
	case path == "/settings" && r.Method == http.MethodGet:
		writeJSON(w, s.settings())
	case path == "/settings" && r.Method == http.MethodPut:
		s.putConsoleSettings(w, r)
	default:
		writeError(w, providerError{status: http.StatusNotFound, message: "no console route " + r.Method + " " + path})
	}
}

// callSummaries is the recent calls, newest first, without their bodies.
func (s *Server) callSummaries() []record {
	calls := s.calls.newest()
	for i := range calls {
		calls[i].Request, calls[i].Response = nil, nil
	}
	return calls
}

// serveConsoleCall answers one recent call by id, bodies included.
func (s *Server) serveConsoleCall(w http.ResponseWriter, id string) {
	calls := s.calls.newest()
	for i := range calls {
		if calls[i].ID == id {
			writeJSON(w, calls[i])
			return
		}
	}
	writeError(w, providerError{status: http.StatusNotFound, message: "no recent call " + id})
}

// putConsoleSettings replaces the settings, refusing a forced error that is
// not a 4xx or 5xx status.
func (s *Server) putConsoleSettings(w http.ResponseWriter, r *http.Request) {
	var next Settings
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&next); err != nil {
		writeError(w, providerError{status: http.StatusBadRequest, message: "settings body is not JSON: " + err.Error()})
		return
	}
	if next.ForcedError != 0 && (next.ForcedError < 400 || next.ForcedError > 599) {
		writeError(w, providerError{status: http.StatusBadRequest, message: "forcedError is 0 (off) or a 4xx/5xx status"})
		return
	}
	if len(next.NextJSON) > 0 && (next.NextJSON[0] != '{' || !json.Valid(next.NextJSON)) {
		writeError(w, providerError{status: http.StatusBadRequest, message: "nextJson is a JSON object"})
		return
	}
	s.mu.Lock()
	s.set = next
	s.mu.Unlock()
	writeJSON(w, next)
}
