package otlpreceiver

import (
	"bytes"
	"context"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"go.uber.org/zap"
)

// signal is the OTLP path suffix a payload belongs to. We key forwarding off the
// route we matched, not off r.URL.Path, so mounting the handler under a prefix
// cannot rewrite where a batch lands upstream.
type signal string

const (
	signalTraces  signal = "/v1/traces"
	signalLogs    signal = "/v1/logs"
	signalMetrics signal = "/v1/metrics"
)

// payload is one received OTLP request, held verbatim for forwarding. The body
// is the ORIGINAL bytes — still gzipped if it arrived gzipped, never
// content-stripped. Upstream is the customer's own project receiving their own
// telemetry; re-encoding or editing it on the way through would be both lossy
// and none of our business.
type payload struct {
	signal          signal
	body            []byte
	contentType     string
	contentEncoding string
	// auth carries the credential headers the WORKER sent us, forwarded straight
	// back out. See forwardedAuthHeaders.
	auth map[string]string
}

// forwardedAuthHeaders are the inbound headers copied onto the upstream request.
//
// This is not a convenience — it is what keeps the manager's central security
// property intact. The manager NEVER holds worker credentials: they arrive in
// each /chat body, are injected into the subprocess env, and die with it. Each
// worker therefore exports with ITS OWN project key (the exporter sets
// `Authorization: Bearer <key>` from OPENCODE_OTLP_HEADERS), and we forward that
// header rather than holding a key of our own. A static, manager-held key would
// both break that property and cross-post every conversation's telemetry into
// one project.
//
// Options.UpstreamHeaders remains the fallback for whatever a request does not
// carry (a fixed self-hosted key, say); an inbound header always wins.
var forwardedAuthHeaders = []string{"Authorization", "X-Auth-Token", "X-Api-Key"}

// authHeadersFrom lifts the credential headers off an inbound OTLP request.
func authHeadersFrom(h http.Header) map[string]string {
	var out map[string]string
	for _, key := range forwardedAuthHeaders {
		if value := h.Get(key); value != "" {
			if out == nil {
				out = make(map[string]string, len(forwardedAuthHeaders))
			}
			out[key] = value
		}
	}
	return out
}

const (
	defaultQueueSize      = 512
	defaultForwardWorkers = 2
)

type forwarderOptions struct {
	Endpoint  string
	Headers   map[string]string
	Client    *http.Client
	Logger    *zap.Logger
	QueueSize int
	Workers   int
}

// forwarder ships received payloads to the real ingestion endpoint, off the
// request goroutine.
//
// BACKPRESSURE, DELIBERATELY: the queue is bounded and Enqueue never blocks. An
// upstream that is slow, down, or rate-limiting fills the queue and we then DROP
// with a warn. The alternative — blocking, or an unbounded queue — would let a
// dead collector either stall a live turn or grow the manager's heap until the
// OOM killer ends the pod, taking every worker with it. Same trade serve.go
// makes bounding the otel-early-flush: telemetry loses, the turn wins.
//
// Retries are not attempted: a failed batch is dropped. Retrying inside a
// bounded queue mostly serves to fill it faster with stale batches, and the OTel
// exporters on the other side of the manager are the layer that owns retry.
type forwarder struct {
	base    string
	headers map[string]string
	client  *http.Client
	logger  *zap.Logger

	queue chan payload
	wg    sync.WaitGroup

	mu     sync.RWMutex
	closed bool

	dropped atomic.Int64
}

func newForwarder(opts forwarderOptions) *forwarder {
	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}
	if opts.Client == nil {
		opts.Client = &http.Client{Timeout: 10 * time.Second}
	}
	queueSize := opts.QueueSize
	if queueSize <= 0 {
		queueSize = defaultQueueSize
	}
	workers := opts.Workers
	if workers <= 0 {
		workers = defaultForwardWorkers
	}

	f := &forwarder{
		base:    normalizeUpstreamBase(opts.Endpoint),
		headers: opts.Headers,
		client:  opts.Client,
		logger:  opts.Logger,
		queue:   make(chan payload, queueSize),
	}
	if f.base == "" {
		// No upstream configured (local dev, tests): the receiver still decodes
		// and feeds the sink. Enqueue becomes a no-op rather than a queue that
		// nothing drains.
		if strings.TrimSpace(opts.Endpoint) != "" {
			f.logger.Warn("otlp_receiver_upstream_invalid", zap.String("endpoint", opts.Endpoint))
		}
		return f
	}

	for range workers {
		f.wg.Add(1)
		go func() {
			defer f.wg.Done()
			for p := range f.queue {
				f.send(p)
			}
		}()
	}
	return f
}

// Enqueue hands a payload to the forwarder. It NEVER blocks: on a full queue the
// payload is dropped and counted. Callers do not get an error because there is
// nothing useful they could do with one — the turn must proceed either way.
func (f *forwarder) Enqueue(p payload) {
	if f.base == "" {
		return
	}

	f.mu.RLock()
	defer f.mu.RUnlock()
	if f.closed {
		return
	}

	select {
	case f.queue <- p:
	default:
		total := f.dropped.Add(1)
		f.logger.Warn("otlp_receiver_forward_dropped",
			zap.String("signal", string(p.signal)),
			zap.Int("queue_size", cap(f.queue)),
			zap.Int64("dropped_total", total),
		)
	}
}

// Dropped is the number of payloads dropped on a full queue since start. Exposed
// for the caller to surface as a metric — a non-zero, growing value means
// ingestion is losing telemetry and the upstream needs looking at.
func (f *forwarder) Dropped() int64 { return f.dropped.Load() }

func (f *forwarder) send(p payload) {
	req, err := http.NewRequest(http.MethodPost, f.base+string(p.signal), bytes.NewReader(p.body))
	if err != nil {
		f.logger.Warn("otlp_receiver_forward_build_failed", zap.Error(err))
		return
	}
	if p.contentType != "" {
		req.Header.Set("Content-Type", p.contentType)
	}
	if p.contentEncoding != "" {
		req.Header.Set("Content-Encoding", p.contentEncoding)
	}
	for k, v := range f.headers {
		req.Header.Set(k, v)
	}
	// The worker's own credentials win over any configured default — see
	// forwardedAuthHeaders.
	for k, v := range p.auth {
		req.Header.Set(k, v)
	}

	resp, err := f.client.Do(req)
	if err != nil {
		f.logger.Warn("otlp_receiver_forward_failed",
			zap.String("signal", string(p.signal)), zap.Error(err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		f.logger.Warn("otlp_receiver_forward_rejected",
			zap.String("signal", string(p.signal)),
			zap.Int("status", resp.StatusCode),
		)
	}
}

// Shutdown stops accepting payloads and drains what is queued, bounded by ctx.
// Whatever is still queued when ctx expires is dropped: a wedged upstream must
// not eat the pod's graceful window out from under the worker drain.
func (f *forwarder) Shutdown(ctx context.Context) error {
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return nil
	}
	f.closed = true
	close(f.queue)
	f.mu.Unlock()

	drained := make(chan struct{})
	go func() {
		f.wg.Wait()
		close(drained)
	}()

	select {
	case <-drained:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// otlpSignalSuffixes are stripped from a configured endpoint so both an
// `/api/otel` base and a fully-qualified `/api/otel/v1/traces` resolve to the
// same base. Mirrors langytracebridge.normalizeEndpoint's tolerance, adapted:
// there the OTLP SDK wanted a bare host, here we POST ourselves and want the
// full base path.
var otlpSignalSuffixes = []string{string(signalTraces), string(signalLogs), string(signalMetrics)}

// normalizeUpstreamBase turns a configured endpoint into a base URL ready for a
// signal suffix. Returns "" when the endpoint is empty or unusable, which
// disables forwarding — a bad endpoint must not stop the manager booting.
func normalizeUpstreamBase(endpoint string) string {
	trimmed := strings.TrimSpace(endpoint)
	if trimmed == "" {
		return ""
	}
	if !strings.Contains(trimmed, "://") {
		trimmed = "https://" + trimmed
	}

	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return ""
	}

	base := strings.TrimRight(parsed.String(), "/")
	for _, suffix := range otlpSignalSuffixes {
		if strings.HasSuffix(base, suffix) {
			return strings.TrimSuffix(base, suffix)
		}
	}
	return base
}
