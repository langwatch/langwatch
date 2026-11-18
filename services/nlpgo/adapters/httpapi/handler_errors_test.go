package httpapi

import (
	"context"
	"errors"
	"net/http"
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

// @scenario "A failed request is logged before the error response is written"
func TestWriteHandlerErrorLogsWithFaultAttribution(t *testing.T) {
	cases := []struct {
		code  herr.Code
		fault string
		level zapcore.Level
	}{
		{domain.ErrBadRequest, "customer", zapcore.InfoLevel},
		{domain.ErrInternal, "platform", zapcore.ErrorLevel},
	}
	for _, tc := range cases {
		core, logs := observer.New(zapcore.DebugLevel)
		ctx := clog.Set(context.Background(), zap.New(core))
		w := httptest.NewRecorder()

		writeHandlerError(ctx, w, herr.New(ctx, tc.code, herr.M{"reason": "engine_error"}))

		entries := logs.FilterMessage("request_failed").All()
		require.Len(t, entries, 1, "code %s", tc.code)
		assert.Equal(t, tc.level, entries[0].Level)
		fields := entries[0].ContextMap()
		assert.Equal(t, tc.fault, fields["fault"])
		assert.Equal(t, tc.code.String(), fields["code"])
		assert.Equal(t, "engine_error", fields["reason"])
		// The herr response still reaches the client.
		assert.GreaterOrEqual(t, w.Code, http.StatusBadRequest)
	}
}

// @scenario "A failed request logs the errors it wraps"
func TestWriteHandlerErrorLogsWrappedReasons(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	ctx := clog.Set(context.Background(), zap.New(core))
	w := httptest.NewRecorder()
	cause := errors.New("upstream error (status 400): messages: Field required")

	writeHandlerError(ctx, w, herr.New(ctx, domain.ErrGatewayUnavailable,
		herr.M{"reason": "dispatcher_stream_error"}, cause))

	entries := logs.FilterMessage("request_failed").All()
	require.Len(t, entries, 1)
	assert.Equal(t, []any{cause.Error()}, entries[0].ContextMap()["reasons"])
	// The operator reads the cause; the client still does not.
	assert.NotContains(t, w.Body.String(), "Field required")
}
