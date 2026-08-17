package httpapi

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/domain"
)

// herr withholds a non-herr reason from the response body on purpose, so the log
// line is the only place the cause survives. Omitting it left a whole class of
// failure undiagnosable: 49 production occurrences of
// gateway_unavailable/dispatcher_error carried a full middleware stacktrace —
// identical every time, therefore worthless — and nothing about what failed.
//
// @scenario "A failed request logs the reason chain, not just the bucket it fell into"
func TestWriteHandlerErrorLogsTheReasonChain(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	ctx := clog.Set(context.Background(), zap.New(core))
	w := httptest.NewRecorder()

	cause := errors.New("upstream error (status 429): You exceeded your current quota")
	writeHandlerError(ctx, w, herr.New(ctx, domain.ErrGatewayUnavailable, herr.M{
		"reason": "dispatcher_error",
	}, cause))

	entries := logs.FilterMessage("request_failed").All()
	require.Len(t, entries, 1)
	fields := entries[0].ContextMap()

	assert.Equal(t, "dispatcher_error", fields["reason"],
		"the bucket the failure landed in is still logged")
	assert.Contains(t, fields["reasons"], "You exceeded your current quota",
		"the underlying cause must be recoverable from the log line alone")

	// The client still learns nothing it should not: herr collapses a non-herr
	// reason to "unknown" in the body, and that behavior is unchanged.
	assert.NotContains(t, w.Body.String(), "You exceeded your current quota")
}

// A failure with no wrapped cause must not grow an empty field.
func TestWriteHandlerErrorOmitsAnEmptyReasonChain(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	ctx := clog.Set(context.Background(), zap.New(core))
	w := httptest.NewRecorder()

	writeHandlerError(ctx, w, herr.New(ctx, domain.ErrBadRequest, herr.M{
		"reason": "invalid_json_body",
	}))

	entries := logs.FilterMessage("request_failed").All()
	require.Len(t, entries, 1)
	_, present := entries[0].ContextMap()["reasons"]
	assert.False(t, present, "no cause means no reasons field")
}
