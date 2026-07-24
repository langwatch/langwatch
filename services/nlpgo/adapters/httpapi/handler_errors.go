package httpapi

import (
	"context"
	"net/http"

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
	clog.Get(ctx).Log(level, "request_failed", fields...)
	herr.WriteHTTP(w, e)
}
