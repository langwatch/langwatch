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
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/metric/noop"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/otelsetup"
	"github.com/langwatch/langwatch/services/langyagent/domain"
	langyotel "github.com/langwatch/langwatch/services/langyagent/otel"
)

// maxOTLPBodyBytes caps a worker's OTLP export body. Batches from one opencode
// process are small; 16MB leaves generous room while bounding a hostile worker.
const maxOTLPBodyBytes = 16 * 1024 * 1024

// forwardTimeout bounds one upstream OTLP forward. Telemetry is best-effort;
// a slow customer ingest must not pile up relay handlers.
const forwardTimeout = 30 * time.Second

// Internal exports are deliberately small and bounded. At the maximum accepted
// OTLP body size this caps retained queued payloads at 128 MiB, plus at most two
// in-flight requests. When full, internal observability is dropped so customer
// forwarding keeps its memory and latency budget.
const (
	internalExportQueueSize = 8
	internalExportWorkers   = 2
)

// WorkerInfo is everything the relay needs to mediate one worker's telemetry
// and LLM traffic. Captured at spawn (the only moment the manager sees the
// credentials) and dropped at Unregister.
type WorkerInfo struct {
	ConversationID string
	// ActorUserID is the user the turn runs for. The manager holds it
	// authoritatively (a worker is bound to one (project, actor) pair for its
	// whole life), so the relay stamps it onto forwarded traces as trusted
	// truth — never read from the worker's own OTLP, which is prompt-injectable.
	// This is what attributes Langy spend to the acting user.
	ActorUserID       string
	LangwatchEndpoint string
	// Model comes from manager-owned worker configuration. The relay uses this
	// trusted value in LangWatch's internal trace instead of the worker-supplied
	// OTLP model attribute, which is an arbitrary string and may carry content.
	Model string
	// LangwatchAPIKey authenticates the trace forward into the customer's
	// project. Held by the relay, never by the worker.
	LangwatchAPIKey string
	// GatewayBaseURL + LLMVirtualKey mediate the worker's LLM calls. The
	// virtual key is injected by the relay, never by the worker.
	GatewayBaseURL string
	LLMVirtualKey  string
	// MirrorTier is the resolved ADR-061 mirror fidelity for this conversation's
	// organization ("content" | "structural" | "skip"). Bound at Register from
	// the credentials envelope; a tier change recycles the worker (it is folded
	// into the credential signature) so this value is never stale for a live
	// worker. Empty ⇒ skip.
	MirrorTier string
	// SourceOrganizationID + SourceProjectID name the CUSTOMER tenant this turn
	// runs for. Stamped onto the mirror copy for per-customer attribution
	// (ADR-061 §5); never forwarded to the customer's own project. Manager-held,
	// never read from the worker's OTLP.
	SourceOrganizationID string
	SourceProjectID      string
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

	// internalEndpoint/internalHeaders address LangWatch's OWN collector. When
	// set, each worker batch is ALSO delivered there in content-stripped form
	// (see services/langyagent/otel). Empty disables that destination — the
	// customer path is unaffected either way.
	internalEndpoint string
	internalHeaders  map[string]string
	// mirrorEndpoint/mirrorKey address the operator-designated mirror project —
	// the mirror lane (ADR-061): a SECONDARY EXPORTER for the turn's gen_ai
	// trace data, so the operator can watch Langy turns with the product's own
	// tools. When set, each worker batch is ALSO posted to
	// <mirrorEndpoint>/api/otel/v1/traces with the key as a Bearer token,
	// through the SAME bounded queue as the collector copy, so a mirror outage
	// is exactly as invisible to the worker and the customer lane as a
	// collector outage always was. Empty (the default) keeps the lane dormant.
	mirrorEndpoint  string
	mirrorKey       string
	internalCtx     context.Context
	internalCancel  context.CancelFunc
	internalJobs    chan internalExportJob
	internalWG      sync.WaitGroup
	internalDropped metric.Int64Counter
	mirrorFailures  metric.Int64Counter
	forwardFailures metric.Int64Counter

	mu      sync.Mutex
	workers map[string]*workerEntry
}

type internalExportJob struct {
	conversationID string
	model          string
	turn           trace.SpanContext
	payload        []byte
	// mirror carries the ADR-061 mirror decision captured at handleTraces time,
	// so the async exporter builds the right-fidelity copy for the right source
	// tenant. The collector copy (deliverInternal) ignores all of this.
	mirrorTier      string
	sourceOrgID     string
	sourceProjectID string
}

// Options configures the relay. The zero value is valid: no second export.
type Options struct {
	// InternalOTLPEndpoint is the base URL of LangWatch's own OTLP collector
	// ("/v1/traces" is appended). Empty means no collector copy of worker
	// telemetry.
	InternalOTLPEndpoint string
	InternalOTLPHeaders  map[string]string
	// MirrorEndpoint is the base URL of the LangWatch deployment holding the
	// operator-designated mirror project ("/api/otel/v1/traces" is appended) — the
	// mirror lane (ADR-061), a secondary exporter that ships a copy of the
	// turn's gen_ai trace data into that project. MirrorKey is the project's
	// static API key, sent as a Bearer token. Empty endpoint means the mirror
	// lane is dormant.
	MirrorEndpoint string
	MirrorKey      string
}

// New binds a loopback listener on an ephemeral port and starts serving.
// ctx is the manager-lifetime context (carries the logger); Shutdown stops the
// listener.
func New(ctx context.Context, opts Options) (*Relay, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("otelrelay listen: %w", err)
	}
	r := &Relay{
		baseCtx:          ctx,
		port:             ln.Addr().(*net.TCPAddr).Port,
		internalEndpoint: opts.InternalOTLPEndpoint,
		internalHeaders:  opts.InternalOTLPHeaders,
		mirrorEndpoint:   opts.MirrorEndpoint,
		mirrorKey:        opts.MirrorKey,
		workers:          map[string]*workerEntry{},
		upstream: &http.Client{
			Timeout: forwardTimeout,
			Transport: &http.Transport{
				MaxIdleConnsPerHost: 4,
				IdleConnTimeout:     60 * time.Second,
			},
		},
	}
	r.forwardFailures = newForwardFailureCounter()
	if r.internalEndpoint != "" || r.mirrorEndpoint != "" {
		// The cancel function is invoked by Shutdown after the workers stop.
		r.internalCtx, r.internalCancel = context.WithCancel(ctx) //nolint:gosec // lifecycle-owned by Relay.Shutdown
		r.internalJobs = make(chan internalExportJob, internalExportQueueSize)
		r.internalDropped = newInternalDropCounter()
		r.mirrorFailures = newMirrorForwardFailureCounter()
		for range internalExportWorkers {
			r.internalWG.Add(1)
			go r.runInternalExporter()
		}
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
		Handler:           r.logRequests(ctx, mux),
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
	if r.internalCancel != nil {
		r.internalCancel()
	}
	serverErr := r.srv.Shutdown(ctx)
	if r.internalCancel == nil {
		return serverErr
	}
	done := make(chan struct{})
	go func() {
		r.internalWG.Wait()
		close(done)
	}()
	select {
	case <-done:
		return serverErr
	case <-ctx.Done():
		return errors.Join(serverErr, ctx.Err())
	}
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

// ForwardTurnSpan emits the platform-owned TURN span into the customer's
// project: the real root every re-parented worker span and every
// gateway-retold LLM span already names as parent. Without it the customer
// trace hangs off a span id that exists only in LangWatch's internal store.
// The span id is the internal langy.turn span's — the SAME id in both
// stores is the deliberate cross-store correlation key.
//
// failure (nil on success) marks the span with OTel error status plus an
// exception event carrying the vetted failure message, so a failed turn's
// trace SHOWS the failure — the ingest folds the exception message into the
// trace-level error the UI renders. The message is client-safe by the
// TurnFailure contract.
//
// Detached and best-effort like every other telemetry leg: a failed forward
// warns and bumps the same counter, never the turn.
func (r *Relay) ForwardTurnSpan(token string, sc trace.SpanContext, start, end time.Time, failure *domain.TurnFailure) {
	entry := r.lookup(token)
	if entry == nil || !sc.IsValid() {
		return
	}

	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	stampResource(rs.Resource().Attributes(), entry.info.ConversationID, entry.info.ActorUserID)
	ss := rs.ScopeSpans().AppendEmpty()
	// The instrumentation scope names WHO produced this span — the agent
	// manager, not the worker (whose own scope rides its re-parented spans).
	ss.Scope().SetName("langy-agent")
	if info := contexts.GetServiceInfo(r.baseCtx); info != nil {
		ss.Scope().SetVersion(info.Version)
	}
	span := ss.Spans().AppendEmpty()
	span.SetName("langy.turn")
	span.SetKind(ptrace.SpanKindServer)
	// Span-level origin is the strongest signal the product's trace-origin
	// resolution accepts — the root span carrying it makes the whole trace
	// resolve to Langy deterministically.
	span.Attributes().PutStr(otelsetup.AttrLangWatchOrigin, originLangy)
	// The turn root speaks semconv too: the thread filter reads span-level
	// gen_ai.conversation.id, and the root span is the one every view of the
	// trace is guaranteed to hold.
	span.Attributes().PutStr(attrGenAIConversationID, entry.info.ConversationID)
	if entry.info.ActorUserID != "" {
		span.Attributes().PutStr(attrEndUserID, entry.info.ActorUserID)
	}
	span.SetTraceID(pcommon.TraceID(sc.TraceID()))
	span.SetSpanID(pcommon.SpanID(sc.SpanID()))
	span.SetStartTimestamp(pcommon.NewTimestampFromTime(start))
	span.SetEndTimestamp(pcommon.NewTimestampFromTime(end))
	if failure != nil {
		span.Status().SetCode(ptrace.StatusCodeError)
		span.Status().SetMessage(failure.Message)
		span.Attributes().PutStr("langy.outcome", failure.Code)
		// The ingest reads the newest exception event's exception.message as
		// the trace-level error (span-status.service.ts), so the failure text
		// lands where the trace views actually look.
		event := span.Events().AppendEmpty()
		event.SetName("exception")
		event.SetTimestamp(pcommon.NewTimestampFromTime(end))
		event.Attributes().PutStr("exception.type", failure.Code)
		event.Attributes().PutStr("exception.message", failure.Message)
	} else {
		span.Status().SetCode(ptrace.StatusCodeOk)
	}
	applyCustomerTracePolicy(td, customerTracePolicy)
	// The customer-facing identity of the turn itself — stamped AFTER the
	// policy pass, which reserves platform names precisely so a WORKER can
	// never claim them; this span is the platform speaking, the one place
	// the reserved name is legitimate.
	rs.Resource().Attributes().PutStr("service.name", "langy")

	payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
	if err != nil {
		return
	}
	info := entry.info
	go func() {
		defer clog.HandlePanic(r.baseCtx, false)
		ctx, cancel := context.WithTimeout(r.baseCtx, 10*time.Second)
		defer cancel()
		if err := r.forwardTraces(ctx, info, payload); err != nil && r.baseCtx.Err() == nil {
			r.forwardFailures.Add(r.baseCtx, 1)
			clog.Get(r.baseCtx).Warn("otelrelay turn span forward failed",
				zap.String("conversation", info.ConversationID),
				zap.Error(err))
		}
	}()
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
		// The one silent failure mode worth a line of its own: a worker (or its
		// exporter's shutdown flush) submitting after Unregister, or a token
		// that never matched. Redacted — the token is a routing credential.
		clog.Get(r.baseCtx).Warn("otelrelay unknown or expired worker token",
			zap.String("token_prefix", redactToken(req.PathValue("token"))),
			zap.String("path_suffix", pathSignal(req.URL.Path)))
		http.Error(w, "unknown telemetry token", http.StatusNotFound)
		return nil
	}
	return e
}

// redactToken keeps enough of a routing token to correlate log lines without
// disclosing the credential.
func redactToken(token string) string {
	if len(token) <= 6 {
		return "…"
	}
	return token[:6] + "…"
}

// pathSignal reduces a relay path to its signal suffix (v1/traces, llm/…)
// so logs never carry the full token-bearing path.
func pathSignal(p string) string {
	// /llm/ first: LLM proxy paths (/w/{token}/llm/v1/chat/completions)
	// contain /v1/ AFTER /llm/, and the highest-volume traffic through the
	// relay must not log under the wrong signal.
	if strings.Contains(p, "/llm/") {
		return "llm"
	}
	if i := strings.LastIndex(p, "/v1/"); i >= 0 {
		return p[i+1:]
	}
	return "?"
}

// logRequests is the relay's request line — the surface is low-volume
// (per-worker OTLP batches + LLM calls), and this hop was completely dark:
// a worker exporting into a 404 was indistinguishable from a worker not
// exporting at all. Tokens are redacted; paths are reduced to their signal.
func (r *Relay) logRequests(ctx context.Context, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, req)
		clog.Get(ctx).Info("otelrelay request",
			zap.String("method", req.Method),
			zap.String("signal", pathSignal(req.URL.Path)),
			zap.String("token_prefix", redactToken(req.PathValue("token"))),
			zap.Int("status", sw.status),
			zap.Int64("bytes_in", req.ContentLength))
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Flush keeps SSE streaming working through the wrapper (the LLM proxy
// streams responses; losing Flusher would buffer them to death).
func (s *statusWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
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

	// Content-type-aware decode. opencode's native exporter ships OTLP/HTTP
	// JSON and IGNORES OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf — a
	// proto-only parse 400'd every worker batch this relay ever received,
	// which is exactly why worker spans never reached anyone. Everything
	// downstream (the internal copy and the customer forward) is normalized
	// to protobuf regardless of what arrived.
	td, err := unmarshalTraces(req.Header.Get("Content-Type"), body)
	if err != nil {
		http.Error(w, "invalid OTLP payload", http.StatusBadRequest)
		return
	}
	conversationID, turn := entry.info.ConversationID, entry.turnContext()

	// LangWatch's own second-lane copies, built from the batch BEFORE it is
	// re-parented in place for the customer. Best-effort and detached: our
	// observability must never delay or fail the customer's telemetry.
	// Marshaled here (not the raw body) so the internal leg always carries
	// protobuf, whatever encoding the worker chose.
	if internalBody, imErr := (&ptrace.ProtoMarshaler{}).MarshalTraces(td); imErr == nil {
		r.exportInternal(internalExportJob{
			conversationID:  conversationID,
			model:           entry.info.Model,
			turn:            turn,
			payload:         internalBody,
			mirrorTier:      entry.info.MirrorTier,
			sourceOrgID:     entry.info.SourceOrganizationID,
			sourceProjectID: entry.info.SourceProjectID,
		})
	}

	FilterCustomerSpans(td)
	if td.SpanCount() == 0 {
		// Nothing customer-meaningful in this batch (pure plumbing). The
		// internal copy above already took what it wanted.
		w.Header().Set("Content-Type", "application/x-protobuf")
		w.WriteHeader(http.StatusOK)
		return
	}
	ReparentTraces(td, conversationID, entry.info.ActorUserID, turn)
	// Codex turns run on the user's ChatGPT plan, not a paid API key: mark the
	// relayed model-call spans bundled so cost tracking never bills them as
	// API spend. The manager-held model id is the only trusted codex signal
	// (ReparentTraces already swept any worker-supplied claim of the flag).
	if strings.HasPrefix(entry.info.Model, codexModelPrefix) {
		StampCodexNonBillable(td)
	}
	applyCustomerTracePolicy(td, customerTracePolicy)
	out, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
	if err != nil {
		http.Error(w, "invalid OTLP payload", http.StatusBadRequest)
		return
	}

	if err := r.forwardTraces(req.Context(), entry.info, out); err != nil {
		// Telemetry is best-effort, but be honest with the worker-side exporter:
		// a 502 lets its standard retry/backoff handle a transient ingest outage.
		// The counter is what makes a broken customer-ingest path visible on a
		// dashboard — the internal drop counter only covers the platform copy.
		r.forwardFailures.Add(r.baseCtx, 1)
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

// exportInternal queues LangWatch's second-lane copies of a worker batch: the
// content-stripped collector copy, and the tiered mirror copy (ADR-061). No-op
// when there is nothing to do — no collector endpoint AND either no mirror
// endpoint or a skip tier for this turn.
//
// The original immutable protobuf body is queued rather than the mutable pdata
// tree. Copying, sanitizing, marshaling, and HTTP all happen behind the bounded
// worker pool, so neither LangWatch copy ever delays customer forwarding.
func (r *Relay) exportInternal(job internalExportJob) {
	// The mirror fires only when it is configured AND the turn's tier is not
	// skip; the self-skip (a turn inside the mirror project itself) arrives here
	// as MirrorTierSkip, resolved control-plane side.
	mirrorWanted := r.mirrorEndpoint != "" &&
		domain.NormalizeMirrorTier(job.mirrorTier) != domain.MirrorTierSkip
	if r.internalEndpoint == "" && !mirrorWanted {
		return
	}
	if r.internalCtx.Err() != nil {
		return
	}
	select {
	case r.internalJobs <- job:
	default:
		r.internalDropped.Add(r.baseCtx, 1, metric.WithAttributes(
			attribute.String("reason", "queue_full"),
		))
		clog.Get(r.baseCtx).Warn("otelrelay internal trace dropped",
			zap.String("conversation", job.conversationID),
			zap.String("reason", "queue_full"),
		)
	}
}

func (r *Relay) runInternalExporter() {
	defer r.internalWG.Done()
	defer clog.HandlePanic(r.baseCtx, false)
	for {
		select {
		case <-r.internalCtx.Done():
			return
		case job := <-r.internalJobs:
			if r.internalCtx.Err() != nil {
				return
			}
			r.processInternalJobSafely(job)
		}
	}
}

// processInternalJobSafely contains a panic to one best-effort batch. Recovering
// at the worker-loop boundary alone would keep the process alive but permanently
// shrink the fixed-size pool after a single malformed batch.
func (r *Relay) processInternalJobSafely(job internalExportJob) {
	defer clog.HandlePanic(r.baseCtx, false)
	r.processInternalJob(job)
}

func (r *Relay) processInternalJob(job internalExportJob) {
	td, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(job.payload)
	if err != nil {
		clog.Get(r.baseCtx).Warn("otelrelay internal copy unmarshal failed",
			zap.String("conversation", job.conversationID), zap.Error(err))
		return
	}
	if r.internalEndpoint != "" {
		r.deliverInternal(job, td)
	}
	tier := domain.NormalizeMirrorTier(job.mirrorTier)
	if r.mirrorEndpoint != "" && tier != domain.MirrorTierSkip {
		r.deliverMirror(job, td, tier)
	}
}

// deliverInternal ships the content-stripped collector copy of one batch.
func (r *Relay) deliverInternal(job internalExportJob, td ptrace.Traces) {
	payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(
		langyotel.InternalCopy(td, job.conversationID, job.model, job.turn),
	)
	if err != nil {
		clog.Get(r.baseCtx).Warn("otelrelay internal copy marshal failed",
			zap.String("conversation", job.conversationID), zap.Error(err))
		return
	}
	ctx, cancel := context.WithTimeout(r.internalCtx, forwardTimeout)
	defer cancel()
	if err := r.postInternal(ctx, payload); err != nil && r.internalCtx.Err() == nil {
		clog.Get(r.baseCtx).Warn("otelrelay internal trace forward failed",
			zap.String("conversation", job.conversationID), zap.Error(err))
	}
}

// deliverMirror ships the FULL-FIDELITY mirror copy of one batch into the
// designated mirror project (ADR-061). Unlike deliverInternal's content-stripped
// ops copy, the mirror preserves the worker's whole trace and gates only content
// on the customer's tier: content ⇒ the copy carries prompts/completions/tool
// payloads, structural ⇒ the same trace with content removed. The caller has
// already excluded the skip tier. Best-effort like every second-lane leg: a
// failed POST warns and bumps the mirror counter, and is never visible to the
// worker or the customer lane.
func (r *Relay) deliverMirror(job internalExportJob, td ptrace.Traces, tier domain.MirrorTier) {
	payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(
		langyotel.MirrorCopy(td, langyotel.MirrorParams{
			ConversationID:  job.conversationID,
			TrustedModel:    job.model,
			Turn:            job.turn,
			SourceOrgID:     job.sourceOrgID,
			SourceProjectID: job.sourceProjectID,
			IncludeContent:  tier == domain.MirrorTierContent,
		}),
	)
	if err != nil {
		clog.Get(r.baseCtx).Warn("otelrelay mirror copy marshal failed",
			zap.String("conversation", job.conversationID), zap.Error(err))
		return
	}
	ctx, cancel := context.WithTimeout(r.internalCtx, forwardTimeout)
	defer cancel()
	if err := r.postMirror(ctx, payload); err != nil && r.internalCtx.Err() == nil {
		r.mirrorFailures.Add(r.baseCtx, 1)
		clog.Get(r.baseCtx).Warn("otelrelay mirror trace forward failed",
			zap.String("conversation", job.conversationID), zap.Error(err))
	}
}

// newForwardFailureCounter counts failed forwards of worker trace batches to
// the CUSTOMER ingest (the reparented, customer-visible copy). Same noop
// fallback as the internal drop counter: telemetry must never take the relay
// down.
func newForwardFailureCounter() metric.Int64Counter {
	const name = "langwatch.langy.customer_trace.forward_failures"
	counter, err := otel.Meter("langwatch-langyagent").Int64Counter(
		name,
		metric.WithDescription("Worker trace batches that failed to forward to the customer ingest (worker exporter got a 502 and will retry)."),
	)
	if err == nil {
		return counter
	}
	fallback, _ := noop.NewMeterProvider().Meter("langwatch-langyagent").Int64Counter(name)
	return fallback
}

func newInternalDropCounter() metric.Int64Counter {
	const name = "langwatch.langy.internal_trace.batches_dropped"
	counter, err := otel.Meter("langwatch-langyagent").Int64Counter(
		name,
		metric.WithDescription("Internal worker trace batches dropped before export."),
	)
	if err == nil {
		return counter
	}
	fallback, _ := noop.NewMeterProvider().Meter("langwatch-langyagent").Int64Counter(name)
	return fallback
}

// newMirrorForwardFailureCounter counts failed mirror POSTs into the prod
// Langy project (ADR-061). Its own counter — a mirror outage and a collector
// outage are different pages.
func newMirrorForwardFailureCounter() metric.Int64Counter {
	const name = "langwatch.langy.mirror_trace.forward_failures"
	counter, err := otel.Meter("langwatch-langyagent").Int64Counter(
		name,
		metric.WithDescription("Mirror trace batches that failed to POST into the designated mirror project."),
	)
	if err == nil {
		return counter
	}
	fallback, _ := noop.NewMeterProvider().Meter("langwatch-langyagent").Int64Counter(name)
	return fallback
}

func (r *Relay) postInternal(ctx context.Context, payload []byte) error {
	url := strings.TrimRight(r.internalEndpoint, "/")
	if !strings.HasSuffix(url, "/v1/traces") {
		url += "/v1/traces"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-protobuf")
	for k, v := range r.internalHeaders {
		req.Header.Set(k, v)
	}
	resp, err := r.upstream.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 2048))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("internal collector answered %d", resp.StatusCode)
	}
	return nil
}

// postMirror POSTs one mirror payload — the secondary export of the turn's
// gen_ai trace data — to the designated mirror project's LangWatch ingest. Same wire
// shape as the customer forward (protobuf to /api/otel/v1/traces, Bearer
// auth), because the mirror IS an ordinary LangWatch project ingest, just
// LangWatch's own (ADR-061).
//
// Deliberately NOT an OTel SDK exporter: otlptracehttp exports SDK
// ReadOnlySpans, and everything this relay touches is pdata (ptrace.Traces
// unmarshaled from the worker's wire bytes) — converting pdata → SDK spans
// just to re-serialize them is the long way round, and the pdata-native OTLP
// exporter lives in the collector framework, whose component/consumer stack
// is far too much dependency for one bounded POST. forwardTraces and
// postInternal hand-roll the same POST for the same reason.
func (r *Relay) postMirror(ctx context.Context, payload []byte) error {
	url := strings.TrimRight(r.mirrorEndpoint, "/") + "/api/otel/v1/traces"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-protobuf")
	req.Header.Set("Authorization", "Bearer "+r.mirrorKey)
	resp, err := r.upstream.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 2048))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("mirror ingest answered %d", resp.StatusCode)
	}
	return nil
}

// unmarshalTraces decodes an OTLP trace payload by its content type:
// application/json → the OTLP JSON encoding, anything else → protobuf.
func unmarshalTraces(contentType string, body []byte) (ptrace.Traces, error) {
	if strings.HasPrefix(strings.TrimSpace(strings.ToLower(contentType)), "application/json") {
		return (&ptrace.JSONUnmarshaler{}).UnmarshalTraces(body)
	}
	return (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(body)
}

// forwardTraces POSTs the re-parented protobuf batch to the customer's
// LangWatch OTLP ingest, authenticated with the session key.
func (r *Relay) forwardTraces(ctx context.Context, info WorkerInfo, payload []byte) error {
	url := strings.TrimRight(info.LangwatchEndpoint, "/") + "/api/otel/v1/traces"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
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
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 2048))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("ingest answered %d", resp.StatusCode)
	}
	return nil
}

// originLangy is the langwatch.origin value for this service's relayed
// worker telemetry — service identity, declared here rather than in the
// shared policy package.
const originLangy = "langy"

// customerTracePolicy is the allowlist for resource attributes on worker
// telemetry bound for the customer's project. It runs AFTER ReparentTraces,
// so the allowed keys are the ones that carry customer meaning: the relay's
// own stamps (thread, acting user, tags) and the worker's telemetry identity
// (service.name). Everything else — sdk metadata, environment identity, and
// whatever a future opencode version starts emitting — fails closed. The
// origin stamp replaces any worker-supplied value: the worker is a
// model-driven, prompt-injectable process and must not brand its spans with
// LangWatch's provenance marker; the platform says these spans are Langy's.
var customerTracePolicy = customertracebridge.Policy{
	Allow: []attribute.Key{
		attrThreadID,
		attrUserID,
		attrTags,
		// The OTel GenAI semconv twins of the reserved pair above — same
		// values, standard names, stamped by the relay (stampResource) so the
		// trace speaks semconv to any consumer. Allowlisted or the policy
		// pass would strip the relay's own stamps.
		attrGenAIConversationID,
		attrEndUserID,
		"service.name",
	},
	Stamp: []attribute.KeyValue{
		attribute.String(otelsetup.AttrLangWatchOrigin, originLangy),
	},
}

// isPlatformServiceName reports whether a worker-supplied service.name claims
// a platform identity (any langwatch-* variant, or the relay's own "langy"
// turn-span surface), under case folding and -/_ normalization.
func isPlatformServiceName(name string) bool {
	n := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(name)), "_", "-")
	return strings.HasPrefix(n, "langwatch") || n == "langy"
}

// applyCustomerTracePolicy applies the allowlist to every resource in the
// batch — the pdata twin of the policy's SDK-level ApplyResource, living here
// because this module already carries the collector pdata dependency.
func applyCustomerTracePolicy(td ptrace.Traces, p customertracebridge.Policy) {
	for i := 0; i < td.ResourceSpans().Len(); i++ {
		attrs := td.ResourceSpans().At(i).Resource().Attributes()
		attrs.RemoveIf(func(k string, v pcommon.Value) bool {
			key := attribute.Key(k)
			if !p.Allows(key) || p.Stamps(key) {
				return true
			}
			// service.name passes the allowlist so the customer can tell the
			// worker's telemetry apart — but its VALUE is worker-supplied, and
			// a prompt-injectable process must not impersonate the platform.
			// Case-folded and separator-normalized so LangWatch-App /
			// LANGWATCH_APP variants don't slip past, and the relay's own
			// turn-span identity is reserved too.
			if key == "service.name" && isPlatformServiceName(v.Str()) {
				return true
			}
			return false
		})
		for _, kv := range p.Stamp {
			attrs.PutStr(string(kv.Key), kv.Value.AsString())
		}
	}
}
