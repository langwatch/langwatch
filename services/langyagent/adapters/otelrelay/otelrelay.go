// Package otelrelay is the manager-side, loopback telemetry + LLM mediation
// relay for Langy workers.
//
// The worker subprocess is a model-driven coding agent and must hold NO
// customer secret beyond what it strictly needs. Two flows used to require a
// secret in the worker env; both are mediated by the manager now:
//
//   - Telemetry (phase 1): the worker's opencode exports OTLP/HTTP over
//     loopback to this relay — no Authorization header, no LangWatch key in the
//     worker. The relay re-parents the spans under the conversation's current
//     turn trace (the manager knows each turn's traceparent; opencode does not
//     speak W3C propagation) and forwards them to the customer's LangWatch
//     project at POST <endpoint>/api/otel/v1/traces, authenticated with the
//     session key the manager was handed at spawn.
//
//   - LLM calls (phase 2): the worker's OPENAI_BASE_URL points at this relay
//     instead of the AI gateway. The relay injects the per-conversation LLM
//     virtual key and the turn's traceparent, then streams the gateway's
//     response back UNBUFFERED (FlushInterval < 0) so SSE token streaming is
//     not delayed. The virtual key never enters the worker env.
//
// Routing is by an unguessable per-worker token in the path
// (/w/{token}/v1/traces, /w/{token}/llm/...), minted at Register and revoked
// at Unregister — a sibling worker on the same loopback cannot attribute
// telemetry to (or spend the virtual key of) another conversation without its
// 128-bit token. The token grants only "submit telemetry as this conversation"
// / "make LLM calls as this conversation"; it is NOT a customer credential.
//
// SECURITY POSTURE NOTE: mediation means the manager now RETAINS the session
// key + virtual key in memory for the worker's lifetime (keyed by token),
// where previously they lived only in the worker subprocess env. That is the
// deliberate trade of this design: the secrets move from the model-driven,
// prompt-injectable subprocess into the manager process that already brokers
// every other credential. Unregister drops them.
package otelrelay

import (
	"compress/gzip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
)

// maxOTLPBodyBytes caps a worker's OTLP export body. Batches from one opencode
// process are small; 16MB leaves generous room while bounding a hostile worker.
const maxOTLPBodyBytes = 16 * 1024 * 1024

// forwardTimeout bounds one upstream OTLP forward. Telemetry is best-effort;
// a slow customer ingest must not pile up relay handlers.
const forwardTimeout = 30 * time.Second

// WorkerInfo is everything the relay needs to mediate one worker's telemetry
// and LLM traffic. Captured at spawn (the only moment the manager sees the
// credentials) and dropped at Unregister.
type WorkerInfo struct {
	ConversationID    string
	LangwatchEndpoint string
	// LangwatchAPIKey authenticates the trace forward into the customer's
	// project. Held by the relay, never by the worker.
	LangwatchAPIKey string
	// GatewayBaseURL + LLMVirtualKey mediate the worker's LLM calls. The
	// virtual key is injected by the relay, never by the worker.
	GatewayBaseURL string
	LLMVirtualKey  string
}

// workerEntry is one registered worker: its info plus the conversation's
// CURRENT turn trace context, updated by the app at each turn start. Spans and
// LLM calls arriving between turns ride the last turn's context — better a
// slightly-stale parent than an orphaned trace.
type workerEntry struct {
	info WorkerInfo

	mu   sync.RWMutex
	turn trace.SpanContext
	// llmErr is the most recent typed herr the gateway answered a mediated LLM
	// call with (decoded from its wire envelope via herr.FromBody) — the real
	// cause behind the agent's laundered error event, captured so the turn's
	// terminal error frame can carry the full typed chain through.
	llmErr *herr.E
}

func (e *workerEntry) setTurn(sc trace.SpanContext) {
	e.mu.Lock()
	e.turn = sc
	// A new turn must never inherit the previous turn's failure as its cause.
	e.llmErr = nil
	e.mu.Unlock()
}

func (e *workerEntry) turnContext() trace.SpanContext {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.turn
}

func (e *workerEntry) setLLMError(err herr.E) {
	e.mu.Lock()
	e.llmErr = &err
	e.mu.Unlock()
}

func (e *workerEntry) clearLLMError() {
	e.mu.Lock()
	e.llmErr = nil
	e.mu.Unlock()
}

func (e *workerEntry) lastLLMError() (herr.E, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.llmErr == nil {
		return herr.E{}, false
	}
	return *e.llmErr, true
}

// Relay is the loopback HTTP server workers export to. One per manager
// process; workers are multiplexed by routing token.
type Relay struct {
	baseCtx  context.Context
	srv      *http.Server
	port     int
	upstream *http.Client

	mu      sync.Mutex
	workers map[string]*workerEntry
}

// New binds a loopback listener on an ephemeral port and starts serving.
// ctx is the manager-lifetime context (carries the logger); Shutdown stops the
// listener.
func New(ctx context.Context) (*Relay, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("otelrelay listen: %w", err)
	}
	r := &Relay{
		baseCtx: ctx,
		port:    ln.Addr().(*net.TCPAddr).Port,
		workers: map[string]*workerEntry{},
		upstream: &http.Client{
			Timeout: forwardTimeout,
			Transport: &http.Transport{
				MaxIdleConnsPerHost: 4,
				IdleConnTimeout:     60 * time.Second,
			},
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /w/{token}/v1/traces", r.handleTraces)
	// opencode's native OTel exports logs too. They are ACCEPTED and DROPPED:
	// worker logs carry the highest-density PII/secret surface (raw prompts,
	// tool output) and the manager deliberately discards the worker's
	// stdout/stderr for the same reason. Answering 200 keeps the worker-side
	// exporter quiet instead of retrying into a 404.
	mux.HandleFunc("POST /w/{token}/v1/logs", r.handleDropSignal)
	mux.HandleFunc("POST /w/{token}/v1/metrics", r.handleDropSignal)
	// LLM mediation (phase 2): everything under /llm/ is reverse-proxied to the
	// conversation's AI gateway with the virtual key + turn traceparent injected.
	mux.HandleFunc("/w/{token}/llm/", r.handleLLM)

	r.srv = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		// No WriteTimeout: the LLM proxy streams SSE for as long as the model
		// generates.
		BaseContext: func(net.Listener) context.Context { return ctx },
	}
	go func() {
		defer clog.HandlePanic(ctx, false)
		if err := r.srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			clog.Get(ctx).Error("otelrelay server stopped", zap.Error(err))
		}
	}()
	return r, nil
}

// Port is the loopback port workers dial.
func (r *Relay) Port() int { return r.port }

// Shutdown stops the listener. In-flight forwards are cut; telemetry is
// best-effort by design.
func (r *Relay) Shutdown(ctx context.Context) error {
	return r.srv.Shutdown(ctx)
}

// Register mints an unguessable routing token for a worker and retains its
// mediation info until Unregister. Called at spawn.
func (r *Relay) Register(info WorkerInfo) (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("otelrelay token: %w", err)
	}
	token := hex.EncodeToString(raw)
	r.mu.Lock()
	r.workers[token] = &workerEntry{info: info}
	r.mu.Unlock()
	return token, nil
}

// Unregister revokes a worker's routing token and drops its retained
// credentials. Idempotent; safe with an empty token.
func (r *Relay) Unregister(token string) {
	if token == "" {
		return
	}
	r.mu.Lock()
	delete(r.workers, token)
	r.mu.Unlock()
}

// SetTurnContext records the conversation's current turn trace context —
// the parent every subsequently exported worker span is stitched under, and
// the traceparent injected on mediated LLM calls. Called by the app at each
// turn start. No-op for an unknown token (worker already recycled).
func (r *Relay) SetTurnContext(token string, sc trace.SpanContext) {
	if e := r.lookup(token); e != nil {
		e.setTurn(sc)
	}
}

// LastLLMError is the typed gateway herr the worker's most recent mediated
// LLM call failed with, if any — reset at each turn start (SetTurnContext).
// The app reads it when the agent reports a turn error, so the terminal frame
// carries the gateway's real cause instead of opencode's laundered prose.
func (r *Relay) LastLLMError(token string) (herr.E, bool) {
	if e := r.lookup(token); e != nil {
		return e.lastLLMError()
	}
	return herr.E{}, false
}

// OTLPEndpointFor is the value for the worker's OTEL_EXPORTER_OTLP_ENDPOINT:
// the SDK appends the per-signal path (/v1/traces, /v1/logs) itself.
func (r *Relay) OTLPEndpointFor(token string) string {
	return fmt.Sprintf("http://127.0.0.1:%d/w/%s", r.port, token)
}

// LLMBaseURLFor is the value for the worker's OPENAI_BASE_URL: request paths
// the OpenAI SDK appends (e.g. /chat/completions) are re-joined onto the
// conversation's GatewayBaseURL by the proxy.
func (r *Relay) LLMBaseURLFor(token string) string {
	return fmt.Sprintf("http://127.0.0.1:%d/w/%s/llm", r.port, token)
}

func (r *Relay) lookup(token string) *workerEntry {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.workers[token]
}

// entryFor resolves the request's routing token, answering 404 (and nil) for
// an unknown one — a dead worker's token, or a sibling probing paths.
func (r *Relay) entryFor(w http.ResponseWriter, req *http.Request) *workerEntry {
	e := r.lookup(req.PathValue("token"))
	if e == nil {
		http.Error(w, "unknown telemetry token", http.StatusNotFound)
		return nil
	}
	return e
}

// handleDropSignal accepts-and-drops a non-trace OTLP signal (logs, metrics).
// 200 with an empty body is a valid OTLP/HTTP success (an empty protobuf
// message is a valid Export*ServiceResponse serialization).
func (r *Relay) handleDropSignal(w http.ResponseWriter, req *http.Request) {
	if r.entryFor(w, req) == nil {
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(req.Body, maxOTLPBodyBytes))
	w.Header().Set("Content-Type", "application/x-protobuf")
	w.WriteHeader(http.StatusOK)
}

// handleTraces receives one OTLP/HTTP trace export from a worker, re-parents
// it under the conversation's current turn, and forwards it to the customer's
// LangWatch project with the session key the manager holds.
func (r *Relay) handleTraces(w http.ResponseWriter, req *http.Request) {
	entry := r.entryFor(w, req)
	if entry == nil {
		return
	}
	body, err := readOTLPBody(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	out, err := ReparentOTLP(body, entry.info.ConversationID, entry.turnContext())
	if err != nil {
		http.Error(w, "invalid OTLP payload", http.StatusBadRequest)
		return
	}

	if err := r.forwardTraces(req.Context(), entry.info, out); err != nil {
		// Telemetry is best-effort, but be honest with the worker-side exporter:
		// a 502 lets its standard retry/backoff handle a transient ingest outage.
		clog.Get(r.baseCtx).Warn("otelrelay trace forward failed",
			zap.String("conversation", entry.info.ConversationID),
			zap.Error(err),
		)
		http.Error(w, "trace forward failed", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/x-protobuf")
	w.WriteHeader(http.StatusOK)
}

// readOTLPBody reads a capped, possibly-gzipped OTLP request body.
func readOTLPBody(req *http.Request) ([]byte, error) {
	var rd io.Reader = http.MaxBytesReader(nil, req.Body, maxOTLPBodyBytes)
	if strings.EqualFold(req.Header.Get("Content-Encoding"), "gzip") {
		gz, err := gzip.NewReader(rd)
		if err != nil {
			return nil, fmt.Errorf("bad gzip body: %w", err)
		}
		defer gz.Close()
		rd = gz
	}
	body, err := io.ReadAll(rd)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	return body, nil
}

// forwardTraces POSTs the re-parented protobuf batch to the customer's
// LangWatch OTLP ingest, authenticated with the session key.
func (r *Relay) forwardTraces(ctx context.Context, info WorkerInfo, payload []byte) error {
	url := strings.TrimRight(info.LangwatchEndpoint, "/") + "/api/otel/v1/traces"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-protobuf")
	req.Header.Set("Authorization", "Bearer "+info.LangwatchAPIKey)
	resp, err := r.upstream.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("ingest answered %d: %s", resp.StatusCode, string(b))
	}
	return nil
}
