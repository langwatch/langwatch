// Package customertracebridge bridges AI completion spans into the customer's
// distributed trace. It captures the customer's traceparent from the inbound
// request (via middleware), then constructs and exports raw OTLP spans to the
// customer's configured endpoint — completely isolated from the gateway's own
// tracing.
package customertracebridge

import (
	"context"
	"encoding/json"
	"strings"

	"go.opentelemetry.io/otel/trace"
)

type ctxKey struct{}
type spanCtxKey struct{}
type clientSessionIDKey struct{}

// WithTraceParent stashes the customer's raw traceparent header value on the
// context. The middleware should call this after extracting (and stripping) the
// header from the inbound request.
func WithTraceParent(ctx context.Context, traceparent string) context.Context {
	if traceparent == "" {
		return ctx
	}
	return context.WithValue(ctx, ctxKey{}, traceparent)
}

// TraceParent retrieves the customer's traceparent from the context.
// Returns empty string if none was set.
func TraceParent(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKey{}).(string); ok {
		return v
	}
	return ""
}

// WithClientSessionID stashes the upstream tool's own session / conversation id
// (lifted from a request header by the middleware) so EndSpan can stamp it as
// gen_ai.conversation.id on the customer span. Without this the gateway path
// has no thread id at all — the wrapped tool (claude-code, codex, opencode)
// sends one on every request but it is otherwise dropped here.
func WithClientSessionID(ctx context.Context, sessionID string) context.Context {
	if sessionID == "" {
		return ctx
	}
	return context.WithValue(ctx, clientSessionIDKey{}, sessionID)
}

// ClientSessionID retrieves the upstream tool session id from the context.
// Returns empty string if none was set.
func ClientSessionID(ctx context.Context) string {
	if v, ok := ctx.Value(clientSessionIDKey{}).(string); ok {
		return v
	}
	return ""
}

type endUserIDKey struct{}
type requestMetadataKey struct{}

// WithEndUserID stashes the caller-declared external end-user id (lifted from
// the x-langwatch-end-user-id header or its x-litellm-end-user-id migration
// alias by the middleware, already sanitized) so EndSpan can stamp it as
// langwatch.end_user_id. Header resolution wins over the body `user` param.
func WithEndUserID(ctx context.Context, endUserID string) context.Context {
	if endUserID == "" {
		return ctx
	}
	return context.WithValue(ctx, endUserIDKey{}, endUserID)
}

// EndUserID retrieves the header-resolved end-user id from the context.
// Returns empty string if none was set.
func EndUserID(ctx context.Context) string {
	if v, ok := ctx.Value(endUserIDKey{}).(string); ok {
		return v
	}
	return ""
}

// WithRequestMetadataJSON stashes the caller's x-langwatch-metadata echo (a
// raw JSON object string, validated by the middleware) so EndSpan can stamp
// it as langwatch.reserved.request_metadata.
func WithRequestMetadataJSON(ctx context.Context, metadataJSON string) context.Context {
	if metadataJSON == "" {
		return ctx
	}
	return context.WithValue(ctx, requestMetadataKey{}, metadataJSON)
}

// RequestMetadataJSON retrieves the caller's metadata echo from the context.
// Returns empty string if none was set.
func RequestMetadataJSON(ctx context.Context) string {
	if v, ok := ctx.Value(requestMetadataKey{}).(string); ok {
		return v
	}
	return ""
}

// endUserIDMaxRunes bounds the attributed end-user id. Ids are opaque caller
// tokens (uuids, emails, numeric ids); 256 covers every sane shape and the
// cap keeps a hostile value from bloating span attributes and budget bucket
// keys downstream.
const endUserIDMaxRunes = 256

// SanitizeEndUserID trims whitespace, strips control characters, and caps the
// id at 256 runes. Applied to every source (headers at the middleware, the
// body `user` param at the emitter) so the stamped value is identical no
// matter where it came from. Returns empty when nothing survives.
func SanitizeEndUserID(raw string) string {
	// Strip control characters FIRST: a control rune at the edge would
	// otherwise shield inner whitespace from the trim, so the result could
	// still carry leading or trailing spaces.
	cleaned := strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, raw))
	if cleaned == "" {
		return ""
	}
	runes := []rune(cleaned)
	if len(runes) > endUserIDMaxRunes {
		return string(runes[:endUserIDMaxRunes])
	}
	return cleaned
}

// requestMetadataMaxBytes caps the x-langwatch-metadata echo. 4KB matches the
// spend event Metadata column's expectation and keeps the echo a join key,
// not a payload channel.
const requestMetadataMaxBytes = 4096

// ValidateRequestMetadataJSON returns the raw metadata string when it is a
// valid JSON object within the size cap, and empty otherwise. Oversized or
// malformed input is dropped (the caller logs at debug), never an error: a
// bad echo must not fail the request carrying it.
func ValidateRequestMetadataJSON(raw string) string {
	if raw == "" || len(raw) > requestMetadataMaxBytes {
		return ""
	}
	trimmed := strings.TrimSpace(raw)
	if !strings.HasPrefix(trimmed, "{") || !json.Valid([]byte(trimmed)) {
		return ""
	}
	return trimmed
}

// withActiveSpan stores the in-flight customer span on the context so EndSpan
// can retrieve and finalize it.
func withActiveSpan(ctx context.Context, span trace.Span) context.Context {
	return context.WithValue(ctx, spanCtxKey{}, span)
}

// activeSpanFrom retrieves the in-flight customer span from context.
func activeSpanFrom(ctx context.Context) trace.Span {
	if v, ok := ctx.Value(spanCtxKey{}).(trace.Span); ok {
		return v
	}
	return nil
}
