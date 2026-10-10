// Package outboundsim is a local stand-in for the things the product sends
// messages to: Slack incoming webhooks and the Slack Web API, customer webhook
// endpoints and customer SQS queues. Every call is kept in memory as a Record,
// listed under /_sim/api/records for the console, haven's CLI and the diff tools.
//
// ponytail: credentials are accepted, never checked. It is a dev shim; never expose it.
package outboundsim

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

// Config is outboundsim's environment-derived configuration.
type Config struct {
	// Addr is the listen address (OUTBOUNDSIM_ADDR, default :5597).
	Addr string
	// Stack is the haven stack slug the console names (OUTBOUNDSIM_STACK, may be empty).
	Stack string
	// MaxRecords is how many records the ring keeps (OUTBOUNDSIM_MAX_RECORDS, default 5000).
	MaxRecords int
	// MaxBodyBytes is the largest body kept per record; the rest is cut
	// and the record says so (OUTBOUNDSIM_MAX_BODY_BYTES, default 262144).
	MaxBodyBytes int
	// Seed loads sample records at start (OUTBOUNDSIM_SEED=1).
	Seed bool
}

// LoadConfig reads outboundsim's configuration from the environment.
func LoadConfig() Config {
	cfg := Config{
		Addr: os.Getenv("OUTBOUNDSIM_ADDR"), Stack: os.Getenv("OUTBOUNDSIM_STACK"),
		MaxRecords:   envInt("OUTBOUNDSIM_MAX_RECORDS", 5000),
		MaxBodyBytes: envInt("OUTBOUNDSIM_MAX_BODY_BYTES", 256<<10),
		Seed:         os.Getenv("OUTBOUNDSIM_SEED") == "1",
	}
	if cfg.Addr == "" {
		cfg.Addr = ":5597"
	}
	return cfg
}

func envInt(key string, fallback int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil && n > 0 {
		return n
	}
	return fallback
}

// maxBody bounds one incoming call.
const maxBody = 16 << 20

// Server answers the product's outbound calls, the control API and the console.
type Server struct {
	cfg       Config
	records   *store
	faults    *faultSet
	receivers *receiverSet
	slack     *slackWorkspace
	now       func() time.Time
	mux       *http.ServeMux
	console   http.Handler
}

// NewServer builds the server over the embedded console bundle.
func NewServer(cfg Config) *Server {
	return newServer(cfg, embeddedConsole())
}

func newServer(cfg Config, bundle fs.FS) *Server {
	if cfg.MaxRecords < 1 {
		cfg.MaxRecords = 5000
	}
	if cfg.MaxBodyBytes < 1 {
		cfg.MaxBodyBytes = 256 << 10
	}
	s := &Server{
		cfg: cfg, records: newStore(cfg.MaxRecords), faults: &faultSet{}, receivers: seedReceivers(),
		slack: seedWorkspace(), now: time.Now, console: newConsole(bundle),
	}
	if cfg.Seed {
		for _, r := range seedRecords() {
			s.records.add(r, s.now())
		}
	}
	s.mux = s.routes()
	return s
}

func (s *Server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("POST /services/{team}/{bot}/{secret}", s.handleSlackWebhook)
	mux.HandleFunc("POST /api/{method}", s.handleSlackAPI)
	mux.HandleFunc("POST /hooks/{name}", s.handleWebhook)
	mux.HandleFunc("POST /", s.handleSQS)
	mux.HandleFunc("GET /_sim/api/status", s.handleStatus)
	mux.HandleFunc("GET /_sim/api/setup", s.handleSetup)
	mux.HandleFunc("GET /_sim/api/records", s.handleRecords)
	mux.HandleFunc("DELETE /_sim/api/records", s.handleClearRecords)
	mux.HandleFunc("GET /_sim/api/deliveries", s.handleDeliveries)
	mux.HandleFunc("GET /_sim/api/faults", s.handleFaults)
	mux.HandleFunc("POST /_sim/api/faults", s.handleAddFault)
	mux.HandleFunc("DELETE /_sim/api/faults", s.handleClearFaults)
	mux.HandleFunc("DELETE /_sim/api/faults/{id}", s.handleRemoveFault)
	mux.HandleFunc("PUT /_sim/api/receivers/{name}", s.handleSetReceiver)
	mux.HandleFunc("DELETE /_sim/api/receivers/{name}", s.handleClearReceiver)
	// A path outboundsim does not fake is a 404, never the console page.
	for _, pattern := range []string{"PUT /", "GET /api/", "GET /hooks/", "GET /services/", "GET /_sim/api/"} {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusNotFound, "outboundsim does not fake "+r.Method+" "+r.URL.Path)
		})
	}
	mux.HandleFunc("GET /", s.handleConsole)
	return mux
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

// call is one incoming request, read and ready to be answered and recorded.
type call struct {
	ctx       context.Context
	channel   string
	target    string
	method    string
	header    http.Header
	body      []byte
	parsed    map[string]any
	eventID   string
	signature string
}

// reply is the answer to give: the vendor's natural one, or a fault's.
type reply struct {
	status      int
	contentType string
	body        string
	header      map[string]string
	latency     time.Duration
}

func textReply(status int, body string) reply {
	return reply{status: status, contentType: "text/plain", body: body}
}

func jsonReply(status int, v any) reply {
	encoded, _ := json.Marshal(v)
	return reply{status: status, contentType: "application/json", body: string(encoded)}
}

// readCall reads the request; a body over maxBody is refused with 413 and false.
func readCall(w http.ResponseWriter, r *http.Request, channel, target string) (call, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "reading the body: "+err.Error())
		return call{}, false
	}
	return call{ctx: r.Context(), channel: channel, target: target, method: r.Method, header: r.Header, body: body}, true
}

// finish applies the first matching fault to natural, records the call, then
// answers (after the latency), or drops the connection without an answer.
func (s *Server) finish(w http.ResponseWriter, c call, natural reply) {
	out, drop := natural, false
	fault, hit := s.faults.take(c.channel, c.target)
	if hit {
		out, drop = fault.apply(natural)
	}
	s.keep(c, out, fault.ID, drop)
	if drop {
		dropConnection(w)
		return
	}
	if pause(c.ctx, out.latency) {
		out.write(w)
	}
}

func (s *Server) keep(c call, out reply, faultID string, drop bool) {
	rec := Record{
		Channel: c.channel, Target: c.target, Method: c.method, Headers: redactHeaders(c.header),
		Parsed: c.parsed, EventID: c.eventID, Signature: c.signature, Status: out.status,
		FaultID: faultID, Dropped: drop, LatencyMs: out.latency.Milliseconds(),
	}
	rec.Body, rec.Truncated = capBody(c.body, s.cfg.MaxBodyBytes)
	if drop {
		rec.Status = 0
	}
	s.records.add(rec, s.now())
}

func (r reply) write(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	if r.contentType != "" {
		w.Header().Set("Content-Type", r.contentType)
	}
	for key, value := range r.header {
		w.Header().Set(key, value)
	}
	w.WriteHeader(r.status)
	_, _ = io.WriteString(w, r.body)
}

// dropConnection closes the client's connection without writing an answer.
func dropConnection(w http.ResponseWriter) {
	conn, _, err := http.NewResponseController(w).Hijack()
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		return
	}
	_ = conn.Close()
}

// pause waits d, and reports false when the client left first.
func pause(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		return true
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
}

// pick is the entries of m under keys that are present.
func pick(m map[string]any, keys ...string) map[string]any {
	out := map[string]any{}
	for _, key := range keys {
		if v, ok := m[key]; ok {
			out[key] = v
		}
	}
	return out
}

// baseURL is the origin the caller reached outboundsim at.
func baseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}
