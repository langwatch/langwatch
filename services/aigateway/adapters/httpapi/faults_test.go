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

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func observedWriteError(t *testing.T, ctx context.Context, err error) *observer.ObservedLogs {
	t.Helper()
	core, logs := observer.New(zapcore.DebugLevel)
	w := httptest.NewRecorder()
	writeError(zap.New(core), w, ctx, err)
	return logs
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
