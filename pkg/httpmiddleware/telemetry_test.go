package httpmiddleware

// Spec: specs/ai-gateway/error-observability.feature

import (
	"context"
	"errors"
	"fmt"
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
)

func completedLevel(t *testing.T, failure error) zapcore.Level {
	t.Helper()
	core, logs := observer.New(zapcore.DebugLevel)
	handler := Telemetry()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		herr.WriteHTTP(w, failure)
	}))
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req = req.WithContext(clog.Set(req.Context(), zap.New(core)))
	handler.ServeHTTP(httptest.NewRecorder(), req)

	entries := logs.FilterMessage("request_completed").All()
	require.Len(t, entries, 1)
	return entries[0].Level
}

/** @scenario A request the client abandoned is logged at info, not as a platform fault */
func TestTelemetry_ClientCancelLogsAtInfo(t *testing.T) {
	assert.Equal(t, zapcore.InfoLevel, completedLevel(t, context.Canceled))
	assert.Equal(t, zapcore.InfoLevel, completedLevel(t, fmt.Errorf("reading body: %w", context.Canceled)))
}

func TestTelemetry_UnhandledErrorStillLogsAtError(t *testing.T) {
	assert.Equal(t, zapcore.ErrorLevel, completedLevel(t, errors.New("boom")))
}
