// Package otlpreceiver is the manager-local OTLP/HTTP receiver: the piece
// langytracebridge's doc comment calls out as "the one genuinely-new piece of
// Go infra" needed to fan per-worker opencode spans through the manager.
//
// Today an opencode worker exports OTLP straight at `<endpoint>/api/otel`. That
// is a SINK: the manager never sees the gen-AI / tool spans, so none of them can
// drive live UI. This package interposes:
//
//	opencode + the `langwatch` CLI --OTLP/HTTP--> Receiver --┬--> upstream /api/otel (ingestion preserved)
//	                                                         └--> []Event -> Sink -> langy.* NDJSON -> live UI
//
// Two properties are non-negotiable and shape everything here:
//
//  1. INGESTION IS NEVER LOST. Every received payload is forwarded upstream
//     byte-for-byte (original encoding, original auth headers), including the
//     signals we do not decode (logs, metrics). Forwarding is asynchronous over
//     a bounded queue: a dead or slow upstream drops spans with a warn, it never
//     wedges a turn. Same loss-window honesty as serve.go's otel-early-flush —
//     this narrows loss, it does not promise zero.
//
//  2. THE SINK IS NEVER BLOCKED BY THE NETWORK. Decode + Sink run inline on the
//     request goroutine and complete before the forwarder is even consulted. The
//     Sink implementation (the manager, fanning onto the in-flight turn's NDJSON
//     stream) must itself not block; see Sink.
//
// Correlation is by OTel RESOURCE attribute — the manager injects
// AttrConversationID into each worker's resource at spawn, so every span the
// worker's SDK exports is already tagged. The conversation is enough on its own:
// the control plane admits one in-flight turn per conversation, so the manager
// maps conversation -> currently-streaming turn. AttrTurnID is optional and
// normally absent (see event.go). Spans with no conversation id are still
// forwarded upstream but are not handed to the Sink — we have no turn to fan
// them onto.
//
// The `langwatch` CLI is the second intended producer: its spans carry
// `langwatch.*` attributes (`langwatch.resource`, `langwatch.verb`) and progress
// span-events. They need no special-casing — they decode into the same Event via
// the flattened Attributes map and Events slice, and the consumer decides what to
// render. Resist growing a taxonomy here; Kind stays coarse on purpose.
//
// The receiver does not bind a port. It exposes an http.Handler for the caller
// to mount (an OTLP path group on the existing manager listener, or a dedicated
// loopback listener) and a Shutdown for the lifecycle group.
package otlpreceiver

import (
	"context"
	"net/http"
	"time"

	"go.uber.org/zap"
)

// DefaultMaxBodyBytes caps a single OTLP request body. OTLP batches are small
// (a few hundred KiB at worst); the cap exists so a misbehaving worker cannot
// balloon manager memory.
const DefaultMaxBodyBytes int64 = 8 << 20

// Options configure a Receiver. Only Sink is truly required — with an empty
// UpstreamEndpoint the receiver still decodes and feeds the sink, it just has
// nowhere to forward (useful in tests and in local dev with no ingestion).
type Options struct {
	// UpstreamEndpoint is the real ingestion base — the `/api/otel` URL the
	// worker used to export to directly. Signal suffixes (/v1/traces, /v1/logs,
	// /v1/metrics) are appended per request; a base that already carries one is
	// normalised back to the base.
	UpstreamEndpoint string

	// UpstreamHeaders are DEFAULT headers on a forwarded request. Usually leave
	// this nil: each worker exports with its own project key, and the receiver
	// forwards the credential headers the worker itself sent (see
	// forwardedAuthHeaders) — which is what lets the manager keep holding no
	// credentials at all. An inbound header always beats one configured here.
	//
	// Forwarding lands in the CUSTOMER's own project, so nothing is stripped
	// from it.
	UpstreamHeaders map[string]string

	// Sink receives decoded, correlated spans. Nil means decode-and-drop (the
	// receiver degrades to a plain forwarding proxy).
	Sink Sink

	// StripContent removes message-content attributes (gen_ai.input.messages &
	// co) from the events handed to the Sink, mirroring langytracebridge's
	// stance. It never affects upstream forwarding.
	StripContent bool

	// Logger is used for drop/forward warnings. Nil gets a no-op logger.
	Logger *zap.Logger

	// HTTPClient forwards upstream. Nil gets a client with a 10s timeout.
	HTTPClient *http.Client

	// QueueSize bounds the in-flight forward queue. <=0 uses defaultQueueSize.
	QueueSize int

	// ForwardWorkers is the number of goroutines draining the forward queue.
	// <=0 uses defaultForwardWorkers.
	ForwardWorkers int

	// MaxBodyBytes caps a single request body. <=0 uses DefaultMaxBodyBytes.
	MaxBodyBytes int64
}

// Receiver serves OTLP/HTTP and tees decoded trace spans to a Sink.
type Receiver struct {
	sink         Sink
	stripContent bool
	logger       *zap.Logger
	maxBodyBytes int64
	forwarder    *forwarder
	handler      http.Handler
}

// New builds a Receiver. It never fails: a malformed upstream endpoint disables
// forwarding (logged) rather than refusing to start, because the live-UI path
// matters more than the tee and must come up regardless.
func New(opts Options) *Receiver {
	logger := opts.Logger
	if logger == nil {
		logger = zap.NewNop()
	}
	maxBody := opts.MaxBodyBytes
	if maxBody <= 0 {
		maxBody = DefaultMaxBodyBytes
	}
	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}

	r := &Receiver{
		sink:         opts.Sink,
		stripContent: opts.StripContent,
		logger:       logger,
		maxBodyBytes: maxBody,
		forwarder: newForwarder(forwarderOptions{
			Endpoint:  opts.UpstreamEndpoint,
			Headers:   opts.UpstreamHeaders,
			Client:    client,
			Logger:    logger,
			QueueSize: opts.QueueSize,
			Workers:   opts.ForwardWorkers,
		}),
	}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/traces", http.HandlerFunc(r.handleTraces))
	mux.Handle("POST /v1/logs", r.passthrough(signalLogs))
	mux.Handle("POST /v1/metrics", r.passthrough(signalMetrics))
	r.handler = mux

	return r
}

// Handler is the OTLP surface: POST /v1/traces (decoded + forwarded) and
// POST /v1/logs / POST /v1/metrics (forwarded only). Mount it wherever the
// worker's OTLP endpoint points; the receiver deliberately owns no listener.
func (r *Receiver) Handler() http.Handler { return r.handler }

// Shutdown drains the forward queue, bounded by ctx. Spans still queued when ctx
// expires are dropped — the same trade serve.go makes for the early flush: a
// dead upstream must not eat the graceful window.
func (r *Receiver) Shutdown(ctx context.Context) error { return r.forwarder.Shutdown(ctx) }

// handleTraces is the only decoding path: read once, forward the raw bytes
// upstream, then decode a copy and feed the Sink. Forwarding is enqueued FIRST
// so a slow sink cannot delay ingestion, and it is non-blocking so a slow
// upstream cannot delay the sink.
func (r *Receiver) handleTraces(w http.ResponseWriter, req *http.Request) {
	body, ok := r.readBody(w, req)
	if !ok {
		return
	}

	r.forwarder.Enqueue(payload{
		signal:          signalTraces,
		body:            body,
		contentType:     req.Header.Get("Content-Type"),
		contentEncoding: req.Header.Get("Content-Encoding"),
		auth:            authHeadersFrom(req.Header),
	})

	if r.sink != nil {
		r.decodeAndSink(req, body)
	}

	writeOTLPSuccess(w, req.Header.Get("Content-Type"))
}

// decodeAndSink turns the raw payload into correlated Events. A decode failure
// is a warn, never a 4xx/5xx: the payload is already on its way upstream and
// failing the worker's exporter would only make it retry a batch we cannot read.
func (r *Receiver) decodeAndSink(req *http.Request, body []byte) {
	raw, err := decompress(body, req.Header.Get("Content-Encoding"))
	if err != nil {
		r.logger.Warn("otlp_receiver_decompress_failed", zap.Error(err))
		return
	}
	traces, err := decodeTraces(raw, req.Header.Get("Content-Type"))
	if err != nil {
		r.logger.Warn("otlp_receiver_decode_failed", zap.Error(err))
		return
	}
	events := eventsFrom(traces, r.stripContent)
	if len(events) == 0 {
		return
	}
	r.sink.OnSpans(req.Context(), events)
}

// passthrough forwards a signal we do not decode. Logs and metrics exist so the
// worker can point ALL its OTLP traffic at the receiver without losing anything
// — decoding them buys the UI nothing today.
func (r *Receiver) passthrough(sig signal) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, ok := r.readBody(w, req)
		if !ok {
			return
		}
		r.forwarder.Enqueue(payload{
			signal:          sig,
			body:            body,
			contentType:     req.Header.Get("Content-Type"),
			contentEncoding: req.Header.Get("Content-Encoding"),
			auth:            authHeadersFrom(req.Header),
		})
		writeOTLPSuccess(w, req.Header.Get("Content-Type"))
	})
}

func (r *Receiver) readBody(w http.ResponseWriter, req *http.Request) ([]byte, bool) {
	body, err := readLimited(req.Body, r.maxBodyBytes)
	if err != nil {
		r.logger.Warn("otlp_receiver_body_read_failed", zap.Error(err))
		http.Error(w, "cannot read body", http.StatusBadRequest)
		return nil, false
	}
	return body, true
}
