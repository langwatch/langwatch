// Package langytracebridge tees the langyagent manager's own OTel spans to a
// static INTERNAL LangWatch project, so the team that builds Langy can observe
// how it behaves in the wild (ADR-044 part 4). It mirrors the AI gateway's
// customertracebridge dual-export: the user's project export is untouched; this
// adds a SECOND sink for the manager's operational spans (spawn, turn
// lifecycle, reconcile, egress).
//
// Content governance: the internal sink STRIPS message-content attributes
// (`gen_ai.input.messages` / `gen_ai.output.messages`) by default, keeping only
// structural/behavioural signal (span shape, tool names, model, token counts,
// latency, status, egress). Teeing a customer's actual conversation body into
// LangWatch's own project would be a separate, explicit, consented switch.
//
// Wiring: `Install` registers an additional span processor on the global
// TracerProvider (the one pkg/otelsetup installed). When the internal endpoint
// is unset — self-hosted, or the tee disabled — Install is a no-op and nothing
// is teed anywhere. Fanning the per-worker OPENCODE gen-AI/tool spans through
// the manager too (the ADR "target") needs a manager-local OTLP receiver; that
// is the one genuinely-new piece of Go infra and is a follow-up — this ships the
// recommended stepping stone (manager spans only).
package langytracebridge

import (
	"context"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"github.com/langwatch/langwatch/pkg/otelsetup"
)

// strippedContentKeys are the span attributes dropped before the internal
// export — the customer's actual conversation content.
var strippedContentKeys = map[string]struct{}{
	"gen_ai.input.messages":  {},
	"gen_ai.output.messages": {},
	"gen_ai.prompt":          {},
	"gen_ai.completion":      {},
}

// dropContentExporter wraps a SpanExporter and strips message-content
// attributes before delegating. The precedent is the gateway's
// dropFilterExporter: started/ended in-process, attribute-filtered before
// export.
type dropContentExporter struct {
	inner sdktrace.SpanExporter
}

func (e *dropContentExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	filtered := make([]sdktrace.ReadOnlySpan, len(spans))
	for i, s := range spans {
		filtered[i] = strippedSpan{ReadOnlySpan: s, attrs: filterAttrs(s.Attributes())}
	}
	return e.inner.ExportSpans(ctx, filtered)
}

func (e *dropContentExporter) Shutdown(ctx context.Context) error {
	return e.inner.Shutdown(ctx)
}

func filterAttrs(in []attribute.KeyValue) []attribute.KeyValue {
	out := in[:0:0]
	for _, kv := range in {
		if _, drop := strippedContentKeys[string(kv.Key)]; drop {
			continue
		}
		out = append(out, kv)
	}
	return out
}

// strippedSpan embeds a ReadOnlySpan and overrides only Attributes(), so the
// exporter sees behavioural shape without customer content. All other span data
// (name, timing, status, resource, scope) passes through unchanged.
type strippedSpan struct {
	sdktrace.ReadOnlySpan
	attrs []attribute.KeyValue
}

func (s strippedSpan) Attributes() []attribute.KeyValue { return s.attrs }

// parseHeaders turns "k1=v1,k2=v2" into the OTLP header map (the internal
// project's ingest key rides here as e.g. `authorization=Bearer <key>`).
func parseHeaders(raw string) map[string]string {
	h := map[string]string{}
	for _, pair := range strings.Split(raw, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		if k, v, ok := strings.Cut(pair, "="); ok {
			h[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return h
}

// normalizeEndpoint mirrors the gateway's helper: OTLP/HTTP wants a bare
// host[:port]; strip a scheme and any trailing path so a `https://host/v1/traces`
// value and a bare `host:4318` both work.
func normalizeEndpoint(endpoint string) (host string, insecure bool) {
	insecure = strings.HasPrefix(endpoint, "http://")
	e := strings.TrimPrefix(strings.TrimPrefix(endpoint, "http://"), "https://")
	if i := strings.IndexByte(e, '/'); i >= 0 {
		e = e[:i]
	}
	return e, insecure
}

// Install registers the internal-project tee on the global TracerProvider and
// returns a shutdown func. When endpoint is empty it is a no-op (no tee).
func Install(ctx context.Context, endpoint, headers string) (func(context.Context) error, error) {
	noop := func(context.Context) error { return nil }
	if strings.TrimSpace(endpoint) == "" {
		return noop, nil
	}

	host, insecure := normalizeEndpoint(endpoint)
	opts := []otlptracehttp.Option{otlptracehttp.WithEndpoint(host)}
	if insecure {
		opts = append(opts, otlptracehttp.WithInsecure())
	}
	if h := parseHeaders(headers); len(h) > 0 {
		opts = append(opts, otlptracehttp.WithHeaders(h))
	}

	exp, err := otlptrace.New(ctx, otlptracehttp.NewClient(opts...))
	if err != nil {
		return noop, err
	}
	// Match the main pipeline's short scheduled delay so the tee's own loss
	// window on an uncatchable SIGKILL/OOM is the same ~2s. The SIGTERM early
	// flush covers this processor too: it is registered on the same global
	// TracerProvider that otelsetup.ForceFlushGlobal flushes.
	bsp := sdktrace.NewBatchSpanProcessor(&dropContentExporter{inner: exp},
		sdktrace.WithBatchTimeout(otelsetup.BatchScheduledDelay),
	)

	// Tee onto the global provider if it is the SDK type (the common case —
	// pkg/otelsetup installs an *sdktrace.TracerProvider). If it is not (a
	// wrapped / no-op provider), we cannot register a processor; the tee then
	// needs the manager-local OTLP receiver (ADR-044 target, follow-up).
	if tp, ok := otel.GetTracerProvider().(*sdktrace.TracerProvider); ok {
		tp.RegisterSpanProcessor(bsp)
	}

	return func(ctx context.Context) error { return bsp.Shutdown(ctx) }, nil
}
