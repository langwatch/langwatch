package httpapi

import (
	"context"
	"errors"
	"net/http"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Fault attributes a failed request to who it is on, so operators can alert
// on error increases and tell customer-caused failures apart from platform
// problems. Customer faults are still logged (at info) because a spike in
// them can be a false flag for a platform problem.
type Fault string

const (
	// FaultCustomer is caused by the caller: out of credits, invalid key,
	// bad request, model not allowed, payload too large.
	FaultCustomer Fault = "customer"
	// FaultProvider is an upstream LLM provider failure or timeout. A spike
	// here can also mean a gateway misconfiguration (e.g. a too-low timeout),
	// so it warrants a look even though the proximate failure is upstream.
	FaultProvider Fault = "provider"
	// FaultPlatform is our bug or infrastructure problem.
	FaultPlatform Fault = "platform"
)

// level maps fault attribution to log severity: customer→info,
// provider→warn, platform→error.
func (f Fault) level() zapcore.Level {
	switch f {
	case FaultCustomer:
		return zapcore.InfoLevel
	case FaultProvider:
		return zapcore.WarnLevel
	default:
		return zapcore.ErrorLevel
	}
}

// faultForUpstreamStatus attributes a provider's HTTP response status:
// 4xx means the provider rejected this caller (their key, their credits,
// their request), 5xx or no status (transport failure / timeout) means the
// provider side failed.
func faultForUpstreamStatus(status int) Fault {
	if status >= 400 && status < 500 {
		return FaultCustomer
	}
	return FaultProvider
}

// faultForCode attributes the gateway's own error codes.
func faultForCode(code herr.Code) Fault {
	switch code {
	case domain.ErrInvalidAPIKey, domain.ErrBudgetExceeded, domain.ErrRateLimited,
		domain.ErrGuardrailBlocked, domain.ErrPolicyViolation, domain.ErrModelNotAllowed,
		domain.ErrPayloadTooLarge, domain.ErrBadRequest, domain.ErrNotFound,
		domain.ErrKeyRevoked:
		return FaultCustomer
	case domain.ErrProviderError, domain.ErrProviderTimeout,
		domain.ErrChainExhausted, domain.ErrCircuitOpen:
		return FaultProvider
	default:
		// internal_error, auth_upstream_unavailable, anything unrecognized.
		return FaultPlatform
	}
}

// logRequestError emits the single stable failure log line CloudWatch metric
// filters key on: msg="gateway_request_failed" with fault/code/status fields,
// plus the calling identity when the request was authenticated.
func logRequestError(logger *zap.Logger, ctx context.Context, fault Fault, code string, status int, message string) {
	fields := []zap.Field{
		zap.String("fault", string(fault)),
		zap.String("code", code),
		zap.String("message", message),
	}
	if status > 0 {
		fields = append(fields, zap.Int("status", status))
	}
	if bundle := BundleFromContext(ctx); bundle != nil {
		fields = append(fields,
			zap.String("project_id", bundle.ProjectID),
			zap.String("organization_id", bundle.OrganizationID),
			zap.String("virtual_key_id", bundle.VirtualKeyID),
		)
	}
	logger.Log(fault.level(), "gateway_request_failed", fields...)
}

// logWriteError classifies err and logs it; the single logging choke point
// for every error response the gateway writes (writeError).
func logWriteError(logger *zap.Logger, ctx context.Context, err error) {
	var ue *domain.UpstreamError
	if errors.As(err, &ue) {
		status := ue.StatusCode
		if status <= 0 {
			status = http.StatusBadGateway
		}
		logRequestError(logger, ctx, faultForUpstreamStatus(ue.StatusCode), "upstream_error", status, ue.Message)
		return
	}
	var e herr.E
	if errors.As(err, &e) {
		msg := ""
		if m, ok := e.Meta["message"].(string); ok {
			msg = m
		}
		logRequestError(logger, ctx, faultForCode(e.Code), e.Code.String(), 0, msg)
		return
	}
	logRequestError(logger, ctx, FaultPlatform, "unhandled", 0, err.Error())
}
