package httpmiddleware

// A Twilio relay id is the whole credential on the Twilio leg of a media
// relay, and it sits in the request path. Wherever the path is recorded (the
// access log, the recover log, the server span) only a short prefix of it may
// land.
//
// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/clog"
)

const (
	redactTestID   = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6"
	redactTestPath = "/v1/voice/twilio/" + redactTestID
)

// @scenario "A relay id in a path is cut to a short prefix where the path is recorded"
func TestRedactPath(t *testing.T) {
	t.Parallel()

	for name, tc := range map[string]struct{ in, want string }{
		"a Twilio stream path": {redactTestPath, "/v1/voice/twilio/Zm9vYmFy..."},
		"a relay hop path":     {"/relay-hop/" + redactTestID, "/relay-hop/Zm9vYmFy..."},
		"a chat route":         {"/v1/chat/completions", "/v1/chat/completions"},
		"the relay open route": {"/v1/voice/relay", "/v1/voice/relay"},
		"a signed relay open":  {"/v1/voice/relay/org_123", "/v1/voice/relay/org_123"},
		"the Twilio prefix":    {"/v1/voice/twilio/", "/v1/voice/twilio/"},
		"the root":             {"/", "/"},
		"empty":                {"", ""},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tc.want, RedactPath(tc.in))
		})
	}
}

// @scenario "A relay id in a path is cut to a short prefix where the path is recorded"
func TestRecoverLogsTheRedactedPath(t *testing.T) {
	core, logs := observer.New(zap.DebugLevel)
	handler := Recover()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(errors.New("boom"))
	}))
	req := httptest.NewRequest(http.MethodGet, redactTestPath, nil)
	req = req.WithContext(clog.Set(testCtx(), zap.New(core)))
	defer func() {
		_ = recover() // Recover re-panics so net/http closes the connection.
		assert.NotContains(t, observedText(logs), redactTestID)
	}()

	handler.ServeHTTP(httptest.NewRecorder(), req)
}

// @scenario "A relay id in a path is cut to a short prefix where the path is recorded"
func TestTelemetryLogsTheRedactedPath(t *testing.T) {
	core, logs := observer.New(zap.DebugLevel)
	handler := Telemetry()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, redactTestPath, nil)
	req = req.WithContext(clog.Set(testCtx(), zap.New(core)))

	handler.ServeHTTP(httptest.NewRecorder(), req)

	text := observedText(logs)
	require.NotEmpty(t, logs.All(), "the access log wrote nothing")
	assert.NotContains(t, text, redactTestID)
	assert.Contains(t, text, "/v1/voice/twilio/Zm9vYmFy...")
}

// @scenario "A relay id in a path is cut to a short prefix where the path is recorded"
func TestTracingSpanHoldsTheRedactedPath(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder)))
	t.Cleanup(func() { otel.SetTracerProvider(previous) })
	handler := Tracing("test")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, redactTestPath, nil))

	spans := recorder.Ended()
	require.Len(t, spans, 1)
	var text strings.Builder
	text.WriteString(spans[0].Name())
	for _, attribute := range spans[0].Attributes() {
		text.WriteString(" " + string(attribute.Key) + "=" + attribute.Value.String())
	}
	assert.NotContains(t, text.String(), redactTestID)
	assert.Contains(t, text.String(), "/v1/voice/twilio/Zm9vYmFy...")
}

func observedText(logs *observer.ObservedLogs) string {
	var text strings.Builder
	entries := logs.All()
	for i := range entries {
		fmt.Fprint(&text, entries[i].Message, entries[i].ContextMap(), "\n")
	}
	return text.String()
}
