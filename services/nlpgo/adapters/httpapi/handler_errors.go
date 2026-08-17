package httpapi

import (
	"context"
	"net/http"
	"strings"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/domain"
)

// handlerFault attributes an HTTP-layer failure by its error code:
// customer (their request/workflow/code) logs at info, platform (our bug or
// our infrastructure, including the gateway being unreachable) logs at
// error. Customer faults are still logged because a spike in them can be a
// false flag for a platform problem. Node-level failures inside a run carry
// the finer-grained attribution (see app/engine/faults.go); this covers the
// request envelope.
func handlerFault(code herr.Code) (string, zapcore.Level) {
	switch code {
	case domain.ErrBadRequest, domain.ErrInvalidWorkflow, domain.ErrInvalidDataset,
		domain.ErrUnsupportedNodeKind, domain.ErrUnauthorized, domain.ErrNotFound,
		domain.ErrCodeBlockTimeout, domain.ErrSSRFBlocked:
		return "customer", zapcore.InfoLevel
	default:
		// internal_error, idle_timeout, gateway_unavailable, unknown.
		return "platform", zapcore.ErrorLevel
	}
}

// writeHandlerError logs the failure with fault attribution, then writes the
// herr response. The single choke point for handler error responses so every
// failed request leaves a log line (herr.WriteHTTP itself does not log). The
// ctx logger carries project_id, trace_id and origin when the request got far
// enough to be decoded.
func writeHandlerError(ctx context.Context, w http.ResponseWriter, e herr.E) {
	fault, level := handlerFault(e.Code)
	fields := []zap.Field{
		zap.String("fault", fault),
		zap.String("code", e.Code.String()),
	}
	if reason, ok := e.Meta["reason"].(string); ok {
		fields = append(fields, zap.String("reason", reason))
	}
	if msg, ok := e.Meta["message"].(string); ok {
		fields = append(fields, zap.String("message", msg))
	}
	// The reason chain is the ONLY place the underlying cause survives: herr's
	// HTTP body deliberately collapses non-herr reasons to "unknown" so we
	// never leak internals to a caller, and the code+reason pair above names
	// only the bucket the failure landed in. Omitting it here meant a
	// gateway_unavailable/dispatcher_error logged a full middleware stacktrace
	// — identical on every occurrence, so worthless — and nothing whatsoever
	// about what actually failed. A whole class of production failures was
	// undiagnosable as a result.
	if reasons := joinReasons(e.Reasons); reasons != "" {
		fields = append(fields, zap.String("reasons", reasons))
	}
	clog.Get(ctx).Log(level, "request_failed", fields...)
	herr.WriteHTTP(w, e)
}

// joinReasons renders the herr reason chain for the log line. Server-side only
// — this is the text herr withholds from the response body on purpose.
//
// Returned as ONE joined string rather than a []string field because the log
// agent destroys a bare string-valued `error` field in transit, and a slice of
// them fares no better; a single named field survives.
func joinReasons(reasons []error) string {
	parts := make([]string, 0, len(reasons))
	for _, reason := range reasons {
		if reason == nil {
			continue
		}
		if msg := reason.Error(); msg != "" {
			parts = append(parts, msg)
		}
	}
	return strings.Join(parts, "; ")
}
