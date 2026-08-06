package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaymetrics"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func observedWriteError(t *testing.T, ctx context.Context, err error) *observer.ObservedLogs {
	t.Helper()
	_, logs := observedWriteErrorResponse(t, ctx, err)
	return logs
}

// observedWriteErrorResponse is observedWriteError's sibling for callers that
// also need to assert on the response writeError actually produced, not just
// what it logged.
func observedWriteErrorResponse(t *testing.T, ctx context.Context, err error) (*httptest.ResponseRecorder, *observer.ObservedLogs) {
	t.Helper()
	core, logs := observer.New(zapcore.DebugLevel)
	w := httptest.NewRecorder()
	writeError(zap.New(core), w, ctx, err)
	return w, logs
}

func requireSingleFailureLog(t *testing.T, logs *observer.ObservedLogs) observer.LoggedEntry {
	t.Helper()
	entries := logs.FilterMessage("gateway_request_failed").All()
	require.Len(t, entries, 1)
	return entries[0]
}

// @scenario "A provider error response is logged with provider fault"
func TestWriteErrorLogsUpstreamServerErrorAsProviderFault(t *testing.T) {
	logs := observedWriteError(t, context.Background(), &domain.UpstreamError{
		StatusCode: 504,
		Message:    "request timed out (default is 30 seconds)",
	})
	entry := requireSingleFailureLog(t, logs)
	assert.Equal(t, zapcore.WarnLevel, entry.Level)
	fields := entry.ContextMap()
	assert.Equal(t, "provider", fields["fault"])
	assert.Equal(t, "upstream_error", fields["code"])
	assert.Equal(t, int64(504), fields["status"])
	assert.Contains(t, fields["message"], "timed out")
}

// @scenario "A customer-caused provider rejection is logged with customer fault"
func TestWriteErrorLogsUpstreamRejectionAsCustomerFault(t *testing.T) {
	logs := observedWriteError(t, context.Background(), &domain.UpstreamError{
		StatusCode: 402,
		Message:    "credit balance too low",
	})
	entry := requireSingleFailureLog(t, logs)
	assert.Equal(t, zapcore.InfoLevel, entry.Level)
	assert.Equal(t, "customer", entry.ContextMap()["fault"])
}

// @scenario "A gateway-classified error is logged by its error code"
func TestWriteErrorLogsHerrCodesWithTheirFault(t *testing.T) {
	cases := []struct {
		code  herr.Code
		fault string
		level zapcore.Level
	}{
		{domain.ErrBudgetExceeded, "customer", zapcore.InfoLevel},
		{domain.ErrProviderTimeout, "provider", zapcore.WarnLevel},
		{domain.ErrInternal, "platform", zapcore.ErrorLevel},
	}
	for _, tc := range cases {
		logs := observedWriteError(t, context.Background(),
			herr.New(context.Background(), tc.code, herr.M{"message": "boom"}))
		entry := requireSingleFailureLog(t, logs)
		assert.Equal(t, tc.level, entry.Level, "code %s", tc.code)
		fields := entry.ContextMap()
		assert.Equal(t, tc.fault, fields["fault"], "code %s", tc.code)
		assert.Equal(t, tc.code.String(), fields["code"])
	}
}

// @scenario "An unexpected error is logged with platform fault"
func TestWriteErrorLogsUnhandledAsPlatformFault(t *testing.T) {
	logs := observedWriteError(t, context.Background(), errors.New("nil pointer somewhere"))
	entry := requireSingleFailureLog(t, logs)
	assert.Equal(t, zapcore.ErrorLevel, entry.Level)
	assert.Equal(t, "platform", entry.ContextMap()["fault"])
}

// meteredContext seeds a recorder the way gatewaymetrics.Middleware does for
// a live request, plus the bundle identity an authenticated call carries.
func meteredContext(rec *gatewaymetrics.Recorder, virtualKeyID string) context.Context {
	ctx := context.WithValue(context.Background(), bundleCtxKey{}, &domain.Bundle{
		ProjectID:      "project_x",
		OrganizationID: "org_y",
		VirtualKeyID:   virtualKeyID,
	})
	return gatewaymetrics.ContextWithRecorder(ctx, rec)
}

// clientRejects reads one client-rejection series back off a real scrape of
// the recorder, which is the only view an operator's alert ever gets. Counters
// are whole numbers, so the value is returned as an int: it keeps the
// assertions exact instead of approximate, and "this counter did not move" is
// a comparison against zero that an epsilon check cannot express.
func clientRejects(t *testing.T, rec *gatewaymetrics.Recorder, code, vkID string) int {
	t.Helper()
	w := httptest.NewRecorder()
	rec.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	require.Equal(t, http.StatusOK, w.Code)

	prefix := fmt.Sprintf("gateway_client_rejects_total{code=%q,vk_id=%q} ", code, vkID)
	for _, line := range strings.Split(w.Body.String(), "\n") {
		if value, ok := strings.CutPrefix(line, prefix); ok {
			parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			require.NoError(t, err)
			return int(parsed)
		}
	}
	return 0
}

// clientRejectSeries is how many distinct series the counter has minted, which
// is the cardinality claim the label set makes.
func clientRejectSeries(t *testing.T, rec *gatewaymetrics.Recorder) int {
	t.Helper()
	count, err := testutil.GatherAndCount(rec.Registry(), "gateway_client_rejects_total")
	require.NoError(t, err)
	return count
}

// @scenario "A customer-fault rejection is counted against the key that sent it"
func TestWriteErrorCountsCustomerRejectionsPerVirtualKey(t *testing.T) {
	rec := gatewaymetrics.New()
	ctx := meteredContext(rec, "vk_flooder")

	cases := []struct {
		name string
		err  error
		code string
	}{
		{"a request with no model", herr.New(context.Background(), domain.ErrMissingModel, herr.M{"message": "choose a model"}), "missing_model"},
		{"a model the key may not use", herr.New(context.Background(), domain.ErrModelNotAllowed, herr.M{"message": "nope"}), "model_not_allowed"},
		{"a payload past the ceiling", herr.New(context.Background(), domain.ErrPayloadTooLarge, herr.M{"message": "too big"}), "payload_too_large"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := clientRejects(t, rec, tc.code, "vk_flooder")
			observedWriteError(t, ctx, tc.err)
			assert.Equal(t, before+1, clientRejects(t, rec, tc.code, "vk_flooder"))
		})
	}

	// The flood this metric exists for is one key repeating one code, which
	// has to accumulate on a single series rather than mint one per request.
	for range 5 {
		observedWriteError(t, ctx, herr.New(context.Background(), domain.ErrMissingModel, herr.M{"message": "choose a model"}))
	}
	assert.Equal(t, 6, clientRejects(t, rec, "missing_model", "vk_flooder"))
	assert.Equal(t, 3, clientRejectSeries(t, rec), "one series per code, not per request")
}

// @scenario "A provider or platform failure is not counted as a client rejection"
func TestWriteErrorDoesNotCountProviderOrPlatformFaults(t *testing.T) {
	cases := []struct {
		name string
		err  error
		code string
	}{
		{"an upstream server error", &domain.UpstreamError{StatusCode: 503, Message: "overloaded"}, "upstream_error"},
		// A provider 4xx is a customer fault by faultForUpstreamStatus, and
		// must still stay off this counter. Counting it would put every
		// OpenAI 429 and Anthropic 402 on a metric named "client rejects", so
		// a provider having a bad hour would read as clients looping on
		// malformed bodies and the per-key alert would be muted with the real
		// signal inside it.
		{"a provider rejecting the caller", &domain.UpstreamError{StatusCode: 429, Message: "rate limited"}, "upstream_error"},
		{"a provider refusing the caller's credit", &domain.UpstreamError{StatusCode: 402, Message: "credit balance too low"}, "upstream_error"},
		{"a gateway timeout on the provider", herr.New(context.Background(), domain.ErrProviderTimeout, herr.M{"message": "slow"}), "provider_timeout"},
		{"our own bug", errors.New("nil pointer somewhere"), "unhandled"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := gatewaymetrics.New()
			observedWriteError(t, meteredContext(rec, "vk_z"), tc.err)
			assert.Equal(t, 0, clientRejects(t, rec, tc.code, "vk_z"))
			assert.Equal(t, 0, clientRejectSeries(t, rec))
		})
	}
}

// @scenario "A rate-limited caller is not counted as a client reject"
func TestWriteErrorDoesNotCountRateLimitedRejections(t *testing.T) {
	// domain.ErrRateLimited is a customer fault by faultForCode — unlike the
	// provider/platform cases above, this exclusion is specific to this one
	// code: a key legitimately sustained at its RPM/RPD ceiling would pin
	// gateway_client_rejects_total and mute the per-key alert it exists for.
	// The rejection is already carried by gateway_rate_limit_denied_total.
	rec := gatewaymetrics.New()
	observedWriteError(t, meteredContext(rec, "vk_ceiling"),
		herr.New(context.Background(), domain.ErrRateLimited, herr.M{"message": "rpm exceeded"}))
	assert.Equal(t, 0, clientRejects(t, rec, "rate_limited", "vk_ceiling"))
	assert.Equal(t, 0, clientRejectSeries(t, rec))
}

// @scenario "A rejection on an unmetered path is still written"
func TestWriteErrorWithoutARecorderStillAnswers(t *testing.T) {
	var w *httptest.ResponseRecorder
	assert.NotPanics(t, func() {
		var logs *observer.ObservedLogs
		w, logs = observedWriteErrorResponse(t, context.Background(),
			herr.New(context.Background(), domain.ErrBadRequest, herr.M{"message": "no model"}))
		assert.Equal(t, "customer", requireSingleFailureLog(t, logs).ContextMap()["fault"])
	})
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), `"code":"bad_request"`)
}

// @scenario "Failure logs identify the calling project"
func TestWriteErrorLogsCarryBundleIdentity(t *testing.T) {
	ctx := context.WithValue(context.Background(), bundleCtxKey{}, &domain.Bundle{
		ProjectID:      "project_x",
		OrganizationID: "org_y",
		VirtualKeyID:   "vk_z",
	})
	logs := observedWriteError(t, ctx, &domain.UpstreamError{StatusCode: 500, Message: "boom"})
	fields := requireSingleFailureLog(t, logs).ContextMap()
	assert.Equal(t, "project_x", fields["project_id"])
	assert.Equal(t, "org_y", fields["organization_id"])
	assert.Equal(t, "vk_z", fields["virtual_key_id"])
}
