package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/tidwall/gjson"
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
		domain.ErrProviderNotBound, domain.ErrModelNotRecognized,
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
		domain.ErrChainExhausted, domain.ErrCircuitOpen:
		return FaultProvider
	default:
		// internal_error, auth_upstream_unavailable, anything unrecognized.
		return FaultPlatform
	}
}

// requestError is one failure, as the log line states it.
type requestError struct {
	fault   Fault
	code    string
	status  int
	message string
	// reason is the provider's own words for a forwarded rejection, when its
	// body states something our message does not.
	reason string
}

// logRequestError emits the single stable failure log line CloudWatch metric
// filters key on: msg="gateway_request_failed" with fault/code/status fields,
// plus the calling identity when the request was authenticated.
func logRequestError(logger *zap.Logger, ctx context.Context, failure requestError) {
	fields := []zap.Field{
		zap.String("fault", string(failure.fault)),
		zap.String("code", failure.code),
		zap.String("message", failure.message),
	}
	if failure.status > 0 {
		fields = append(fields, zap.Int("status", failure.status))
	}
	if failure.reason != "" {
		fields = append(fields, zap.String("upstream_reason", failure.reason))
	}
	if bundle := BundleFromContext(ctx); bundle != nil {
		fields = append(fields,
			zap.String("project_id", bundle.ProjectID),
			zap.String("organization_id", bundle.OrganizationID),
			zap.String("virtual_key_id", bundle.VirtualKeyID),
		)
	}
	logger.Log(failure.fault.level(), "gateway_request_failed", fields...)
}

// upstreamReasonLimit caps the reason field: long enough for any provider's
// rejection sentence, short enough that a body in a shape we do not know
// cannot put a request payload on the line.
const upstreamReasonLimit = 256

// upstreamReason reads the provider's own explanation out of a forwarded error
// body. Providers state it in different places: OpenAI and Anthropic use
// error.message, the codex backend answers "detail", several others use a bare
// message or a plain error string. A body in none of those shapes (an HTML
// edge page, a text response) is reported by its first line, so the operator
// still learns who answered and roughly what they said.
func upstreamReason(body []byte) string {
	for _, path := range []string{"error.message", "detail", "message", "error"} {
		if value := gjson.GetBytes(body, path); value.Type == gjson.String && value.Str != "" {
			return cappedReason(value.Str)
		}
	}
	return cappedReason(firstLine(body))
}

// unstatedReason is upstreamReason minus what the message already says, so a
// provider whose words we forwarded as the message is not quoted twice.
func unstatedReason(message string, body []byte) string {
	reason := upstreamReason(body)
	if reason == "" || strings.Contains(message, reason) {
		return ""
	}
	return reason
}

func cappedReason(text string) string {
	text = strings.TrimSpace(text)
	if len(text) <= upstreamReasonLimit {
		return text
	}
	const ellipsis = "..."
	return strings.ToValidUTF8(text[:upstreamReasonLimit-len(ellipsis)], "") + ellipsis
}

func firstLine(body []byte) string {
	text := strings.TrimSpace(string(body))
	if end := strings.IndexByte(text, '\n'); end >= 0 {
		text = text[:end]
	}
	return text
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
		logRequestError(logger, ctx, requestError{
			fault:   faultForUpstreamStatus(ue.StatusCode),
			code:    "upstream_error",
			status:  status,
			message: ue.Message,
			reason:  unstatedReason(ue.Message, ue.Body),
		})
		return
	}
	var e herr.E
	if errors.As(err, &e) {
		msg := ""
		if m, ok := e.Meta["message"].(string); ok {
			msg = m
		}
		logRequestError(logger, ctx, requestError{
			fault:   faultForCode(e.Code),
			code:    e.Code.String(),
			message: msg,
		})
		recordClientReject(ctx, e.Code)
		return
	}
	logRequestError(logger, ctx, requestError{
		fault:   FaultPlatform,
		code:    "unhandled",
		message: err.Error(),
	})
}
