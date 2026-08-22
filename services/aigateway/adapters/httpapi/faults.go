package httpapi

import (
	"context"
	"errors"
	"net/http"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaymetrics"
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
//
// Every code the gateway AUTHORS belongs in one of the two named cases. The
// default is for codes that genuinely are our problem, so a customer-caused
// code left out of the list here does not read as unattributed — it reads as
// a platform incident, at error level, on the one log line operators alert
// on. That is the trap ErrCodexSessionExpired fell into when it stopped
// being a forwarded provider 401 and became a handled error of our own:
// faultForUpstreamStatus had been answering "customer" for it by reading the
// status off the response it no longer has.
func faultForCode(code herr.Code) Fault {
	switch code {
	case domain.ErrInvalidAPIKey, domain.ErrBudgetExceeded, domain.ErrRateLimited,
		domain.ErrGuardrailBlocked, domain.ErrPolicyViolation, domain.ErrModelNotAllowed,
		domain.ErrProviderNotBound,
		domain.ErrPayloadTooLarge, domain.ErrBadRequest, domain.ErrMissingModel, domain.ErrNotFound,
		domain.ErrKeyRevoked, domain.ErrKeyDisabled, domain.ErrKeyExpired,
		domain.ErrNoProviderConfigured,
		domain.ErrEndUserRequired,
		// The customer's own OpenAI sign-in died and only they can restore it,
		// so it is their fault in the only sense this attribution means: whose
		// action fixes it. Counted per key too, which is what shows an
		// operator a key wedged in a re-authenticate loop.
		domain.ErrCodexSessionExpired:
		return FaultCustomer
	case domain.ErrProviderError, domain.ErrProviderTimeout,
		domain.ErrChainExhausted, domain.ErrCircuitOpen,
		// The provider row is missing a field only its owner can fill in, so
		// it is theirs by the sense this attribution means — whose action
		// fixes it. It is warn rather than info, and off the client-reject
		// counter, because it is a slot that cannot serve any request rather
		// than a caller being turned away: the same signal a provider outage
		// gives, from a cause an operator can act on.
		domain.ErrProviderMisconfigured:
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

// recordClientReject counts a rejection the GATEWAY issued against the caller.
//
// Scoped to faultForCode deliberately, with two exclusions on top of that.
// faultForUpstreamStatus also answers FaultCustomer, for any provider 4xx, so
// counting every customer fault would put every OpenAI 429 and Anthropic 402
// on a counter named "client rejects". A provider having a bad hour would
// then read as clients looping on malformed bodies, for keys doing nothing
// wrong, and the per-key alert this metric exists for would be muted with the
// real signal inside it. Provider rejections are already carried by
// gateway_provider_attempts_total.
//
// domain.ErrRateLimited is excluded too, for the same "keys doing nothing
// wrong" reason: a key legitimately sustained at its RPM/RPD ceiling would
// pin this counter and mute the alert it exists for, and that rejection is
// already carried by gateway_rate_limit_denied_total.
func recordClientReject(ctx context.Context, code herr.Code) {
	if faultForCode(code) != FaultCustomer || code == domain.ErrRateLimited {
		return
	}
	virtualKeyID := ""
	if bundle := BundleFromContext(ctx); bundle != nil {
		virtualKeyID = bundle.VirtualKeyID
	}
	gatewaymetrics.RecorderFromContext(ctx).RecordClientReject(code.String(), virtualKeyID)
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
		recordClientReject(ctx, e.Code)
		return
	}
	logRequestError(logger, ctx, FaultPlatform, "unhandled", 0, err.Error())
}
