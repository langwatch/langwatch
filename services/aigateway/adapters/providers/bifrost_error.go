package providers

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/bytedance/sonic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// --- Error classification ---
//
// Bifrost hands back one type for every failure, *bfschemas.BifrostError, and
// the whole job here is telling apart the four things it can mean. Bifrost
// says which through three fields, and reading them is the difference between
// a useful answer and a lie:
//
//	IsBifrostError  false ⇒ the PROVIDER produced this. Every provider-answered
//	                error goes through HandleProviderAPIError / NewProviderAPIError,
//	                which always set a StatusCode. true ⇒ Bifrost produced it
//	                itself and no provider response exists to forward.
//	StatusCode      the provider's real HTTP status when one was received.
//	                Bifrost also synthesizes two of its own: 504 with
//	                Error.Type=request_timed_out for a genuine timeout, and 499
//	                with RequestCancelled when the caller went away.
//	Error.Error     the wrapped Go error that says WHY. Bifrost's own message
//	                is a category ("error creating auth token source"); the
//	                cause underneath is the sentence an operator needs
//	                ("failed to parse auth credentials JSON: ...").
//
// The rule that follows: forward as an upstream response only what a provider
// actually answered — a real status that Bifrost did not synthesize itself —
// and classify everything else on Bifrost's own signals. IsBifrostError is a
// useful hint but not the discriminant; bfIsProviderAnswer says why.
//
// This replaced a classifier that mapped status 0 to provider_timeout. Nothing
// Bifrost reports with status 0 is a timeout — a real timeout always carries
// 504 and request_timed_out — so every credential, configuration and routing
// failure in the engine was reported to clients as a 504 "Gateway Timeout",
// attributed to the provider, retried through the fallback chain, and fed to
// the circuit breaker. Over one week in production all 23 of them were
// misclassified: "no keys found that support model", "deployments not set",
// "chat_completion is not supported by elevenlabs provider" and "failed to
// retrieve aws credentials". Not one was a timeout, and none of the four is
// something a retry can fix.

// errFromBifrost turns a Bifrost dispatch error into the error the gateway
// surfaces to the client.
//
// A provider-answered error is forwarded verbatim through UpstreamError — its
// status and, when Bifrost captured it, its native body — so a terminal
// upstream 4xx reaches the client as that 4xx instead of a retryable 502 and
// the client can tell terminal from retryable correctly.
//
// Everything else is Bifrost's own verdict about a request that never got an
// answer, and goes to classifyBifrostError. That includes the two statuses
// Bifrost synthesizes (504 timeout, 499 for a caller hang-up): dressing them as
// an UpstreamError would claim an upstream answered when none did, and would
// attribute a caller hanging up to the provider. See bfIsProviderAnswer for why
// the discriminant is the synthesized-status pair rather than IsBifrostError.
//
// This is the streaming-path counterpart to the non-stream
// rawResponseFromBifrostError branch: streaming dispatch can only return an
// error, so the upstream status + body ride on UpstreamError instead of a
// *domain.Response.
func errFromBifrost(ctx context.Context, berr *bfschemas.BifrostError, respHeaders map[string]string) error {
	if berr == nil {
		return herr.New(ctx, domain.ErrProviderError, herr.M{"message": "provider dispatch failed"})
	}
	if !bfIsProviderAnswer(berr) {
		return bfApplyFallbackVerdict(classifyBifrostError(ctx, berr), berr)
	}
	status := bfStatus(berr)
	body, _ := extractRawResponseBytes(berr.ExtraFields.RawResponse)
	errType, errCode := bfErrorTypeCode(berr)
	return bfApplyFallbackVerdict(&domain.UpstreamError{
		StatusCode: status,
		Body:       body,
		Message:    bfErrorMsg(berr),
		ErrorType:  errType,
		ErrorCode:  errCode,
		Provider:   string(berr.ExtraFields.Provider),
		Headers:    forwardableUpstreamHeaders(respHeaders),
	}, berr)
}

// bfApplyFallbackVerdict carries Bifrost's AllowFallbacks=false decision to the
// dispatcher without changing the error the client sees. A no-op when Bifrost
// allows fallback, which is the default and the overwhelmingly common case.
func bfApplyFallbackVerdict(err error, berr *bfschemas.BifrostError) error {
	if bfAllowsFallback(berr) {
		return err
	}
	return domain.WithNoFallback(err)
}

// bfIsProviderAnswer reports whether the error represents an HTTP response a
// provider actually sent, and may therefore be forwarded verbatim.
//
// A status alone is not the test, because Bifrost synthesizes two statuses of
// its own — 504 with request_timed_out when the deadline fires, and 499 with
// RequestCancelled when the caller hangs up — and forwarding either as an
// upstream answer would claim a provider replied when none did.
//
// Nor is IsBifrostError the test, tempting as it looks. Bedrock sets it TRUE on
// a real provider response whose error body it could not unmarshal
// (providers/bedrock/bedrock.go), while still carrying the provider's status and
// its raw body. Reading that flag as "no provider answered" would collapse every
// unparseable Bedrock 4xx into a generic 502 and break the forwarding guarantee
// error-transparency.feature exists to hold — for the one provider whose error
// bodies are least likely to parse.
//
// So the test is the pair Bifrost actually controls: a real status, from
// something it did not synthesize itself.
func bfIsProviderAnswer(berr *bfschemas.BifrostError) bool {
	if bfStatus(berr) <= 0 {
		return false
	}
	switch bfErrorType(berr) {
	case bfschemas.RequestTimedOut, bfschemas.RequestCancelled:
		return false
	}
	return true
}

// bifrostResponseHeaders reads the provider's HTTP response headers that
// Bifrost stashes on the dispatch context (provider handlers call
// ctx.SetValue(BifrostContextKeyProviderResponseHeaders, ...) before returning,
// including on the non-2xx error path). Returns nil when absent.
func bifrostResponseHeaders(bfCtx *bfschemas.BifrostContext) map[string]string {
	if bfCtx == nil {
		return nil
	}
	if v, ok := bfCtx.Value(bfschemas.BifrostContextKeyProviderResponseHeaders).(map[string]string); ok {
		return v
	}
	return nil
}

// forwardableUpstreamHeaders selects the upstream response headers that are
// safe and useful to forward to the client on an error: the retry-signaling
// headers Retry-After (backoff hint on 429/503) and x-should-retry (the
// provider's canonical terminal-vs-retryable signal). Everything else
// (transport headers, content-length, auth echoes) is dropped. Match is
// case-insensitive; output uses canonical names.
func forwardableUpstreamHeaders(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, 2)
	for k, v := range in {
		switch strings.ToLower(k) {
		case "retry-after":
			out["Retry-After"] = v
		case "x-should-retry":
			out["x-should-retry"] = v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// classifyBifrostError maps a Bifrost-origin failure onto the gateway's own
// taxonomy: the code decides the client's HTTP status, whether the dispatcher
// retries and falls over to the next credential, whose fault an operator is
// paged for, and what the customer is told to do about it. Getting it wrong is
// not cosmetic — provider_timeout means "retry me", and a credential that
// cannot mint a token will fail identically on every credential in the chain.
//
// Order matters. The explicit signals Bifrost sets (Error.Type, then its own
// exported message constants) are read before anything is inferred from the
// status, because the status is the weakest of the three and the one most
// often absent.
func classifyBifrostError(ctx context.Context, berr *bfschemas.BifrostError) error {
	if berr == nil {
		return herr.New(ctx, domain.ErrProviderError, herr.M{"message": "provider dispatch failed"})
	}

	code := bfErrorCode(berr)
	meta := herr.M{"message": bfCustomerMessage(code, berr)}
	if status := bfStatus(berr); status > 0 {
		meta["status"] = status
	}
	if provider := string(berr.ExtraFields.Provider); provider != "" {
		meta["provider"] = provider
	}
	if model := berr.ExtraFields.ModelRequested; model != "" {
		meta["model"] = model
	}

	// The wrapped cause travels as a herr reason, never in meta. meta is the
	// client contract; the cause is Bifrost's internal sentence, which can
	// name a credential field, a parse offset or a host, and belongs on the
	// log line and the span instead. bfCause keeps Bifrost's category prefix
	// so the two read as one sentence.
	if cause := bfCause(berr); cause != nil {
		return herr.New(ctx, code, meta, cause)
	}
	return herr.New(ctx, code, meta)
}

// bfErrorCode picks the gateway code for a Bifrost-origin failure.
func bfErrorCode(berr *bfschemas.BifrostError) herr.Code {
	// 1. Bifrost's explicit type. A real timeout and a caller hang-up are the
	//    only two things it names this way, and both are unambiguous.
	switch bfErrorType(berr) {
	case bfschemas.RequestTimedOut:
		return domain.ErrProviderTimeout
	case bfschemas.RequestCancelled:
		return domain.ErrRequestAbandoned
	}

	// 2. Bifrost's own error taxonomy, as its providers set it on the error
	//    type field (documented: authentication_error, authorization_error,
	//    rate_limit_error, invalid_request_error, api_error, network_error).
	switch bfErrorType(berr) {
	case "authentication_error", "authorization_error":
		return domain.ErrProviderCredentialRejected
	case "rate_limit_error":
		return domain.ErrRateLimited
	case "invalid_request_error":
		return domain.ErrBadRequest
	case "network_error":
		return domain.ErrProviderConnectionFailed
	}
	if bfErrorCodeField(berr) == "unsupported_operation" {
		return domain.ErrProviderConfigInvalid
	}

	// 3. Bifrost's exported message constants. These are the failures it
	//    reports with no status and no type at all, which is the whole class
	//    that used to land on provider_timeout.
	if code, ok := bfCodeForMessage(bfErrorMsg(berr)); ok {
		return code
	}

	// 4. Status, last. A synthesized 504/499 was already caught by type; what
	//    reaches here with a status is a provider answer whose type Bifrost
	//    could not parse.
	switch status := bfStatus(berr); {
	case status == http.StatusTooManyRequests:
		return domain.ErrRateLimited
	case status == http.StatusGatewayTimeout || status == http.StatusRequestTimeout:
		return domain.ErrProviderTimeout
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return domain.ErrProviderCredentialRejected
	case status >= 400 && status < 500:
		return domain.ErrBadRequest
	}
	return domain.ErrProviderError
}

// bfMessageRule matches one of Bifrost's failure messages to a gateway code.
// Bifrost states these as prose rather than as a type, so prose is the only
// signal available; each entry names the constant or construction site it
// matches so a Bifrost upgrade that rewords one can be traced back here.
// bifrost_error_test.go asserts every constant below still exists in the
// pinned Bifrost, which is what turns a silent reword into a failing test.
type bfMessageRule struct {
	needle string
	code   herr.Code
}

// bfMessageRules is ordered: the first match wins, so more specific needles
// come first.
var bfMessageRules = []bfMessageRule{
	// Credentials the gateway holds cannot produce an authenticated call at
	// all. Never reaches a provider, so it is neither a timeout nor an
	// upstream verdict, and it fails identically on every retry.
	//   vertex.go   NewBifrostOperationError("error creating auth token source", ...)
	//   bedrock     NewBifrostOperationError("failed to retrieve aws credentials", ...)
	{needle: "auth token source", code: domain.ErrProviderCredentialInvalid},
	{needle: "failed to retrieve aws credentials", code: domain.ErrProviderCredentialInvalid},
	{needle: "error getting token", code: domain.ErrProviderCredentialInvalid},
	{needle: "vertex key config is not set", code: domain.ErrProviderCredentialInvalid},

	// The provider slot is configured in a way that cannot serve THIS request:
	// the key declares no such model, or a deployment map is missing.
	//   bifrost.go  "no keys found that support model[/deployment]: %s"
	//   azure.go    NewConfigurationError("deployments not set")
	{needle: "no keys found", code: domain.ErrProviderConfigInvalid},
	{needle: "deployments not set", code: domain.ErrProviderConfigInvalid},
	{needle: "endpoint not set", code: domain.ErrProviderConfigInvalid},
	{needle: "is not supported by", code: domain.ErrProviderConfigInvalid},

	// Transport never reached the provider (DNS, connection refused).
	//   schemas.ErrProviderNetworkError
	{needle: bfNetworkErrorMessage, code: domain.ErrProviderConnectionFailed},
	{needle: bfDoRequestMessage, code: domain.ErrProviderConnectionFailed},

	// The caller abandoned the request. Neither a provider failure nor ours.
	//   schemas.ErrRequestCancelled
	{needle: bfRequestCancelledMessage, code: domain.ErrRequestAbandoned},

	// Bifrost could not build the request we asked for. Our bug, not the
	// customer's and not the provider's: no retry will change the outcome.
	{needle: bfRequestMarshalMessage, code: domain.ErrInternal},
	{needle: bfRequestBodyConversionMessage, code: domain.ErrInternal},
	{needle: bfCreateRequestMessage, code: domain.ErrInternal},

	// The provider answered with something unusable. Retryable: the next
	// credential, or the same one a moment later, may answer properly.
	{needle: bfResponseDecodeMessage, code: domain.ErrProviderError},
	{needle: bfResponseUnmarshalMessage, code: domain.ErrProviderError},
	{needle: bfResponseEmptyMessage, code: domain.ErrProviderError},
	{needle: bfResponseHTMLMessage, code: domain.ErrProviderError},
	{needle: bfResponseDecompressMessage, code: domain.ErrProviderError},

	// A real timeout that arrived as prose rather than as a type.
	//   schemas.ErrProviderRequestTimedOut
	{needle: "request timed out", code: domain.ErrProviderTimeout},
}

// Bifrost's exported failure messages, pinned here as the needles the rules
// above match on. They are values rather than direct references so a needle
// stays a substring of the constant (Bifrost's timeout message, for one, is a
// whole paragraph of remediation advice) and so the test can assert the
// pinned Bifrost still says what we think it says.
const (
	bfNetworkErrorMessage = "network error occurred while connecting to provider API"
	bfDoRequestMessage    = "failed to execute HTTP request to provider API"
	//nolint:misspell // Bifrost's own wording, matched verbatim against its output.
	bfRequestCancelledMessage      = "request cancelled by caller"
	bfRequestMarshalMessage        = "failed to marshal request body to JSON"
	bfRequestBodyConversionMessage = "failed to convert bifrost request to the expected provider request body"
	bfCreateRequestMessage         = "failed to create HTTP request to provider API"
	bfResponseDecodeMessage        = "failed to decode response body from provider API"
	bfResponseUnmarshalMessage     = "failed to unmarshal response from provider API"
	bfResponseEmptyMessage         = "empty response received from provider"
	bfResponseHTMLMessage          = "HTML response received from provider"
	bfResponseDecompressMessage    = "failed to decompress provider's response"
)

func bfCodeForMessage(msg string) (herr.Code, bool) {
	if msg == "" {
		return "", false
	}
	lowered := strings.ToLower(msg)
	for _, rule := range bfMessageRules {
		if strings.Contains(lowered, strings.ToLower(rule.needle)) {
			return rule.code, true
		}
	}
	return "", false
}

// bfCustomerMessage is what the customer reads. Bifrost's own message is
// engine prose written for whoever is reading a Bifrost stack trace ("no keys
// found that support model: x", "deployments not set"), which states a fact
// about our internals and no action the customer can take. For the codes where
// we know the remediation, say it; for the rest, Bifrost's sentence is still
// the most specific thing available and is safe to relay, because these
// failures happen before a request body is ever sent and so cannot quote it.
func bfCustomerMessage(code herr.Code, berr *bfschemas.BifrostError) string {
	switch code {
	case domain.ErrProviderCredentialInvalid:
		return "The credentials configured for this model provider were not accepted. Check the provider's credentials in your model provider settings."
	case domain.ErrProviderConfigInvalid:
		if model := berr.ExtraFields.ModelRequested; model != "" {
			return fmt.Sprintf("This model provider is not configured to serve %q. Check the models and deployments configured for it in your model provider settings.", model)
		}
		return "This model provider is not configured to serve the requested model. Check the models and deployments configured for it in your model provider settings."
	case domain.ErrInternal:
		return "The gateway could not build the upstream request."
	case domain.ErrRequestAbandoned:
		return "The request was canceled before the provider answered."
	}
	if msg := bfErrorMsg(berr); msg != "" {
		return msg
	}
	return "The model provider did not return a usable response."
}

// bfCause returns Bifrost's wrapped error as a herr reason, prefixed with the
// category message so the two read as the one sentence Bifrost split in half.
// This is the fix for the hole this whole file exists to close: Bifrost puts
// the category in Error.Message and the actual reason in Error.Error, and the
// gateway read only the former. "error creating auth token source" says
// nothing an operator can act on; the cause underneath distinguishes a
// credential that is not JSON from one missing a "type" field from an
// environment with no default credentials at all.
func bfCause(berr *bfschemas.BifrostError) error {
	if berr.Error == nil || berr.Error.Error == nil {
		return nil
	}
	cause := berr.Error.Error
	category := strings.TrimSpace(berr.Error.Message)
	if category == "" || strings.Contains(cause.Error(), category) {
		return cause
	}
	return fmt.Errorf("%s: %w", category, cause)
}

func bfStatus(e *bfschemas.BifrostError) int {
	if e == nil || e.StatusCode == nil {
		return 0
	}
	return *e.StatusCode
}

// bfErrorType reads the error type Bifrost set. Providers set it on the nested
// ErrorField; NewProviderAPIError also copies it to the top level. Read both,
// preferring the nested one, so a provider that sets only one is still
// classified.
func bfErrorType(e *bfschemas.BifrostError) string {
	if e == nil {
		return ""
	}
	if e.Error != nil && e.Error.Type != nil && *e.Error.Type != "" {
		return *e.Error.Type
	}
	if e.Type != nil {
		return *e.Type
	}
	return ""
}

func bfErrorCodeField(e *bfschemas.BifrostError) string {
	if e == nil || e.Error == nil || e.Error.Code == nil {
		return ""
	}
	return *e.Error.Code
}

// bfAllowsFallback reports whether Bifrost permits failing over to another
// credential for this error. Bifrost documents AllowFallbacks as nil-means-true,
// and a plugin (or a provider) setting it false is stating that no other
// credential will do better. The dispatcher honors it; ignoring it spent the
// whole chain on errors Bifrost had already said were terminal.
func bfAllowsFallback(e *bfschemas.BifrostError) bool {
	if e == nil || e.AllowFallbacks == nil {
		return true
	}
	return *e.AllowFallbacks
}

func bfErrorMsg(e *bfschemas.BifrostError) string {
	if e == nil {
		return ""
	}
	if e.Error != nil {
		return e.Error.Message
	}
	return fmt.Sprintf("bifrost error (status %v)", e.StatusCode)
}

// bfErrorTypeCode lifts the provider's own error discriminants (error.type /
// error.code as parsed by Bifrost's provider adapter) off a BifrostError.
// These carry the error's identity (insufficient_quota, overloaded_error,
// ThrottlingException, ...) on lanes where the native body is not captured.
func bfErrorTypeCode(e *bfschemas.BifrostError) (errType, errCode string) {
	if e == nil || e.Error == nil {
		return "", ""
	}
	if e.Error.Type != nil {
		errType = *e.Error.Type
	}
	if e.Error.Code != nil {
		errCode = *e.Error.Code
	}
	return errType, errCode
}

// upstreamStreamError converts a mid-stream BifrostError chunk into a
// structured domain.UpstreamError the SSE writer can forward faithfully.
//
// Providers can fail a 200-established stream with an in-stream error event
// whose detail nests under an `error` OBJECT (OpenAI Responses:
// {"type":"error","error":{"type","code","message","param"}}). Bifrost's
// stream schema maps only the legacy flat `message`/`code`/`param` fields, so
// for the nested shape it hands over an ErrorField with an EMPTY message
// but, on raw-forward paths (rawForwardCtx), the verbatim event body rides
// ExtraFields.RawResponse. Recover the message from there, and keep the raw
// body so the writer can forward the provider's own event bytes unchanged.
func upstreamStreamError(e *bfschemas.BifrostError) *domain.UpstreamError {
	ue := &domain.UpstreamError{Message: bfErrorMsg(e)}
	if e == nil {
		ue.Message = "provider stream error"
		return ue
	}
	ue.ErrorType, ue.ErrorCode = bfErrorTypeCode(e)
	if code := e.StatusCode; code != nil {
		ue.StatusCode = *code
	}
	ue.Provider = string(e.ExtraFields.Provider)
	raw, ok := extractRawResponseBytes(e.ExtraFields.RawResponse)
	if !ok {
		if ue.Message == "" {
			ue.Message = "provider stream error"
		}
		return ue
	}
	var event struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if sonic.Unmarshal(raw, &event) == nil && event.Error != nil {
		// The raw body IS a provider error event, forward it verbatim.
		ue.Body = raw
		if ue.Message == "" {
			ue.Message = event.Error.Message
		}
	}
	if ue.Message == "" {
		ue.Message = "provider stream error"
	}
	return ue
}
