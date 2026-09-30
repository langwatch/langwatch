// Package llmsim is a local LLM provider stand-in: the OpenAI chat-completions,
// embeddings and models calls and the Anthropic messages call the stack makes,
// answered from a seeded Markov chain so a prompt always gets the same answer
// and nothing costs money. See the package README for the modes and switches.
package llmsim

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	mrand "math/rand/v2"
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Request headers that steer one call. The model name carries the same
// switches for callers (the gateway) that forward no custom headers.
const (
	HeaderSeed  = "X-Llmsim-Seed"
	HeaderMode  = "X-Llmsim-Mode"
	HeaderError = "X-Llmsim-Error"
)

// maxBodyBytes caps one request body; agent transcripts run large.
const maxBodyBytes = 32 << 20

// Config is llmsim's environment-derived configuration.
type Config struct {
	// Addr is the listen address (LLMSIM_ADDR, default :5595).
	Addr string
	// Stack is the haven stack slug the console names (LLMSIM_STACK).
	Stack string
	// MaxCalls is how many calls the console remembers (LLMSIM_MAX_CALLS, default 500).
	MaxCalls int
	// MaxBodyBytes is the request body kept per call; a larger one is kept as
	// a size and a head (LLMSIM_MAX_BODY_BYTES, default 262144).
	MaxBodyBytes int
}

// LoadConfig reads llmsim's configuration from the environment.
func LoadConfig() Config {
	cfg := Config{
		Addr: os.Getenv("LLMSIM_ADDR"), Stack: os.Getenv("LLMSIM_STACK"),
		MaxCalls:     envInt("LLMSIM_MAX_CALLS", defaultRecentCalls),
		MaxBodyBytes: envInt("LLMSIM_MAX_BODY_BYTES", defaultBodyBytes),
	}
	if cfg.Addr == "" {
		cfg.Addr = ":5595"
	}
	return cfg
}

func envInt(key string, fallback int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil && n > 0 {
		return n
	}
	return fallback
}

// Server answers the provider calls and keeps the console's record of them.
type Server struct {
	cfg     Config
	chain   *markov
	console http.Handler
	calls   *ring
	mu      sync.Mutex
	set     Settings
}

// NewServer builds the Markov chain once and the server over it.
func NewServer(cfg Config) *Server {
	if cfg.MaxCalls < 1 {
		cfg.MaxCalls = defaultRecentCalls
	}
	if cfg.MaxBodyBytes < 1 {
		cfg.MaxBodyBytes = defaultBodyBytes
	}
	return &Server{cfg: cfg, chain: newMarkov(corpus), console: newConsole(embeddedConsole()), calls: newRing(cfg.MaxCalls)}
}

// Handler routes provider calls by path suffix, so /v1/chat/completions,
// /chat/completions and Azure's /openai/deployments/{d}/chat/completions all
// land in one place; /_sim/api is the console's data and any other GET is
// the console itself.
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(s.serveHTTP)
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

func (s *Server) serveHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSuffix(r.URL.Path, "/")
	switch {
	case strings.HasPrefix(path, "/_sim/api"):
		s.serveConsoleAPI(w, r, strings.TrimPrefix(path, "/_sim/api"))
	case path == "/healthz":
		w.WriteHeader(http.StatusOK)
	case r.Method == http.MethodGet && strings.HasSuffix(path, "/models"):
		writeModels(w, r)
	case r.Method == http.MethodGet:
		s.handleConsole(w, r)
	case r.Method == http.MethodPost:
		s.serveProvider(w, r, path)
	default:
		writeError(w, isAnthropic(path), http.StatusMethodNotAllowed, "llmsim answers POST here")
	}
}

func isAnthropic(path string) bool {
	return strings.HasSuffix(path, "/messages") || strings.HasSuffix(path, "/messages/count_tokens")
}

// serveProvider answers one provider call and records it for the console.
func (s *Server) serveProvider(w http.ResponseWriter, r *http.Request, path string) {
	started := time.Now()
	anthropic := isAnthropic(path)
	rec := record{At: started, Path: path, Dialect: "openai", Status: http.StatusOK}
	if anthropic {
		rec.Dialect = "anthropic"
	}
	defer func() {
		rec.LatencyMs = float64(time.Since(started).Microseconds()) / 1000
		s.calls.add(rec)
	}()
	fail := func(status int, message string) {
		rec.Status, rec.Error = status, message
		writeError(w, anthropic, status, message)
	}

	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	var body map[string]json.RawMessage
	if err == nil {
		err = json.Unmarshal(raw, &body)
	}
	if err != nil {
		fail(http.StatusBadRequest, "request body is not a JSON object: "+err.Error())
		return
	}
	rec.Request = recordedBody(raw, s.cfg.MaxBodyBytes)
	rec.Model = str(body["model"])
	if status := s.forcedStatus(r.Header, rec.Model); status != 0 {
		if status == http.StatusTooManyRequests {
			w.Header().Set("Retry-After", "1")
		}
		fail(status, fmt.Sprintf("llmsim forced a %d for model %q", status, rec.Model))
		return
	}

	var req request
	switch {
	case strings.HasSuffix(path, "/chat/completions"):
		req = parseOpenAI(body)
	case strings.HasSuffix(path, "/messages/count_tokens"):
		writeJSON(w, map[string]int{"input_tokens": parseAnthropic(body).promptTokens()})
		rec.Mode = "count_tokens"
		return
	case strings.HasSuffix(path, "/messages"):
		req = parseAnthropic(body)
	case strings.HasSuffix(path, "/embeddings"):
		rec.Dialect, rec.Mode = "embeddings", "embeddings"
		writeEmbeddings(w, body)
		return
	default:
		fail(http.StatusNotFound, "llmsim does not serve "+r.URL.Path)
		return
	}
	rep := s.answer(r.Header, req)
	rec.Mode, rec.Stream, rec.InputTokens, rec.OutputTokens, rec.Response = rep.Mode, req.stream, rep.In, rep.Out, &rep
	if anthropic {
		s.writeAnthropic(w, req, rep)
	} else {
		s.writeOpenAI(w, req, rep)
	}
}

var errorInModel = regexp.MustCompile(`error-([45]\d\d)`)

// forcedStatus is the error a call asked for: the X-Llmsim-Error header,
// "error-429" / "error-500" (any 4xx or 5xx) in the model name, or else the
// console's forced-error setting.
func (s *Server) forcedStatus(h http.Header, model string) int {
	raw := h.Get(HeaderError)
	if raw == "" {
		if m := errorInModel.FindStringSubmatch(model); m != nil {
			raw = m[1]
		}
	}
	if status, err := strconv.Atoi(raw); err == nil && status >= 400 && status <= 599 {
		return status
	}
	return s.settings().ForcedError
}

// rng is the call's random source: the X-Llmsim-Seed header (or the
// console's seed setting) pins it and "random" draws a fresh one; otherwise
// it is a hash of the model and the messages.
func (s *Server) rng(h http.Header, req request) *mrand.Rand {
	seed := h.Get(HeaderSeed)
	if seed == "" {
		seed = s.settings().Seed
	}
	var sum [32]byte
	switch seed {
	case "random":
		_, _ = rand.Read(sum[:])
	case "":
		sum = sha256.Sum256(append([]byte(req.model+"\x00"), req.seedBytes...))
	default:
		sum = sha256.Sum256([]byte(seed))
	}
	//nolint:gosec // G404: seeded math/rand is the point, a simulator must replay the same answer for a seed
	return mrand.New(mrand.NewPCG(binary.LittleEndian.Uint64(sum[:8]), binary.LittleEndian.Uint64(sum[8:16])))
}

// writeError answers in the caller's own dialect, so its SDK maps the status.
func writeError(w http.ResponseWriter, anthropic bool, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	kind := "api_error"
	switch {
	case status == http.StatusTooManyRequests:
		kind = "rate_limit_error"
	case status < 500:
		kind = "invalid_request_error"
	}
	if anthropic {
		_ = json.NewEncoder(w).Encode(map[string]any{"type": "error", "error": map[string]string{"type": kind, "message": message}})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"message": message, "type": kind, "code": strconv.Itoa(status)}})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// Models are what /models lists; any model name is answered regardless.
var Models = []string{"markov-small", "markov-json", "langy-echo", "text-embedding-llmsim", "canned-hello", "canned-ok", "canned-json"}

// canned are the fixed answers a "canned-<name>" model returns, whatever the prompt.
var canned = map[string]string{
	"hello": "Hello from llmsim. This answer is canned: the same for every prompt.",
	"ok":    "OK",
	"json":  `{"answer":"canned","source":"llmsim"}`,
}

func cannedFor(model string) (string, bool) {
	for name, text := range canned {
		if strings.Contains(model, "canned-"+name) {
			return text, true
		}
	}
	return "", false
}

func writeModels(w http.ResponseWriter, r *http.Request) {
	data := make([]map[string]any, 0, len(Models))
	for _, id := range Models {
		if r.Header.Get("anthropic-version") != "" {
			data = append(data, map[string]any{"type": "model", "id": id, "display_name": id, "created_at": "2026-01-01T00:00:00Z"})
		} else {
			data = append(data, map[string]any{"id": id, "object": "model", "created": 1767225600, "owned_by": "llmsim"})
		}
	}
	writeJSON(w, map[string]any{"object": "list", "data": data, "has_more": false, "first_id": Models[0], "last_id": Models[len(Models)-1]})
}

// sse writes one server-sent event and flushes it; an empty event name
// writes only the data line (OpenAI's framing).
func sse(w http.ResponseWriter, event string, v any) {
	if event != "" {
		_, _ = fmt.Fprintf(w, "event: %s\n", event)
	}
	b, _ := json.Marshal(v)
	_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func startSSE(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
}

// str decodes a JSON string field, or "" when absent or not a string.
func str(raw json.RawMessage) string {
	var s string
	_ = json.Unmarshal(raw, &s)
	return s
}
