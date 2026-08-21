package otelrelay

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
)

// llmPrefix is the path segment separating the routing token from the
// LLM-relative path the worker's SDK appended (e.g. /chat/completions).
const llmPrefix = "/llm"

// maxErrorBodyBytes caps how much of a failed LLM response is buffered to
// decode the gateway's herr envelope. Real envelopes are tiny; the cap keeps
// a pathological upstream from ballooning proxy memory.
const maxErrorBodyBytes = 64 * 1024

// codexModelPrefix marks a turn whose model is served by the gateway's codex
// provider. The worker itself never sees the prefix (opencode runs its native
// openai provider); the proxy restores it request-side so the gateway routes
// to the codex credential.
const codexModelPrefix = "openai_codex/"

// rewriteCodexModelBody swaps the outbound request body's "model" field for
// the turn's full provider-prefixed id on codex turns. A no-op for every
// other turn (checked before any read) and for bodies without a model field
// (the proxied request stands untouched).
//
// The body IS buffered once: rewriting a JSON field and re-stamping
// Content-Length both need the complete document, and a request body is
// bounded by the model's context window anyway. The swap itself is a
// surgical gjson/sjson field set — the messages payload is never decoded —
// and the SSE response path streams through untouched.
func rewriteCodexModelBody(out *http.Request, turnModel string) {
	if !strings.HasPrefix(turnModel, codexModelPrefix) || out.Body == nil {
		return
	}
	raw, err := io.ReadAll(out.Body)
	_ = out.Body.Close()
	if err != nil {
		out.Body = io.NopCloser(bytes.NewReader(nil))
		out.ContentLength = 0
		return
	}
	rewritten := raw
	if gjson.GetBytes(raw, "model").Exists() {
		if b, err := sjson.SetBytes(raw, "model", turnModel); err == nil {
			rewritten = b
		}
	}
	out.Body = io.NopCloser(bytes.NewReader(rewritten))
	out.ContentLength = int64(len(rewritten))
	out.Header.Set("Content-Length", strconv.Itoa(len(rewritten)))
}

// handleLLM mediates one worker LLM call (phase 2): the worker's
// OPENAI_BASE_URL points at /w/{token}/llm, so the OpenAI-compatible path it
// requested is re-joined onto the conversation's AI gateway base URL, the
// virtual key is injected as the Bearer credential (it never enters the worker
// env), and the turn's traceparent is stamped on so the gateway's gen_ai span
// continues the SAME trace as the app -> manager -> worker spans.
//
// Streaming is passed through UNBUFFERED: FlushInterval < 0 makes the reverse
// proxy flush every write immediately, so SSE token deltas reach the worker as
// they arrive rather than in transfer-buffer batches.
func (r *Relay) handleLLM(w http.ResponseWriter, req *http.Request) {
	entry := r.entryFor(w, req)
	if entry == nil {
		return
	}
	// A prior call's 200 stream ended in a hard in-stream error event (see the
	// SSE sniffer below). Every retry re-opens a fresh 200 stream and dies
	// identically, so status-based cutting never fires, answer this retry
	// terminally with the provider's own payload instead of proxying it.
	if body, ok := entry.takeLLMStreamCut(); ok {
		clog.Get(r.baseCtx).Info("otelrelay llm in-stream failure retry cut",
			zap.String("conversation", entry.info.ConversationID))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write(body)
		return
	}
	// pi workers export no OTLP of their own: the relay retells each mediated
	// LLM call as one gen_ai span into the customer's trace (see genai.go).
	// nil for every other harness, and for calls with no turn to parent under.
	genAI := newGenAICall(r, entry, req)
	target, err := llmTargetURL(entry.info.GatewayBaseURL, req.PathValue("token"), req.URL)
	if err != nil {
		clog.Get(r.baseCtx).Warn("otelrelay llm target resolution failed",
			zap.String("conversation", entry.info.ConversationID),
			zap.Error(err),
		)
		http.Error(w, "bad gateway base url", http.StatusBadGateway)
		return
	}

	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.Out.URL = target
			pr.Out.Host = target.Host
			// The worker authenticated to US with a placeholder (its env holds no
			// virtual key). Replace it with the real credential.
			pr.Out.Header.Set("Authorization", "Bearer "+entry.info.LLMVirtualKey)
			// The Anthropic-native dialect (pi's anthropic-messages lane)
			// authenticates with x-api-key instead of a Bearer header, and the
			// gateway's /v1/messages accepts the virtual key there. Replace the
			// placeholder wherever the client put it, so it never travels.
			if pr.In.Header.Get("x-api-key") != "" {
				pr.Out.Header.Set("x-api-key", entry.info.LLMVirtualKey)
			}
			// Codex turns run opencode's NATIVE openai provider (the Responses
			// dialect the codex backend speaks), so the worker's request says
			// "gpt-…"; restore the full provider-prefixed id on the wire and
			// the gateway routes it to the codex credential. See provision.go.
			rewriteCodexModelBody(pr.Out, entry.info.Model)
			// Stamp a traceparent so the gateway's customer-facing gen_ai span
			// joins the turn's trace, nested where the call really happened.
			// The worker's own traceparent is never continued verbatim: its
			// trace id is worker-chosen (a prompt-injectable process must
			// never pick which trace its calls land in). It is TRANSLATED
			// through the same remap the span re-parenting applies: every
			// worker trace id collapses onto the turn's trace id while span
			// ids ride through unchanged, so the gateway span parents under
			// the exported copy of the worker span that made the call (the AI
			// SDK's active doStream span). A worker with no injected
			// traceparent parents on the turn span, the one ancestor
			// guaranteed to exist. An invalid (not-yet-set) turn context
			// stamps nothing; the gateway then roots its own trace.
			if sc := entry.turnContext(); sc.IsValid() {
				parent := remapWorkerParent(pr.In.Header.Get("Traceparent"), sc)
				if parent.SpanID() != sc.SpanID() {
					// Diagnostic for the nesting behavior: present exactly when
					// the worker injected a traceparent and the gateway span
					// will nest under that worker span; absent means the
					// worker sent none and the turn span is the parent.
					clog.Get(r.baseCtx).Info("otelrelay llm parent remapped from worker traceparent",
						zap.String("conversation", entry.info.ConversationID),
						zap.String("parent_span_id", parent.SpanID().String()))
				}
				pr.Out.Header.Set("traceparent", traceparentHeader(parent))
			} else {
				pr.Out.Header.Del("traceparent")
			}
			pr.SetXForwarded()
		},
		// Negative ⇒ flush immediately after each write: SSE pass-through.
		FlushInterval: -1,
		// EVERY failed call is captured so the turn's terminal error frame
		// carries the REAL cause — opencode launders this body into
		// "AI_APICallError" prose the control plane must never trust. A typed
		// gateway herr envelope decodes losslessly (herr.FromBody — the
		// cross-process continuation); a provider-native body the gateway
		// forwarded verbatim is reduced to bounded classification (reason code,
		// status, and body kind), never provider prose. The body is restored
		// untouched for the worker's SDK.
		ModifyResponse: func(resp *http.Response) error {
			if err := r.captureLLMFailure(entry, resp); err != nil {
				return err
			}
			// Wraps OUTSIDE the failure capture's own body wrapping, so both
			// observations ride the same untouched pass-through.
			if genAI != nil {
				genAI.observeResponse(resp)
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			clog.Get(r.baseCtx).Warn("otelrelay llm proxy error",
				zap.String("conversation", entry.info.ConversationID),
				zap.Error(err),
			)
			w.WriteHeader(http.StatusBadGateway)
		},
	}
	proxy.ServeHTTP(w, req)
}

// captureLLMFailure is handleLLM's ModifyResponse body, pulled out to a named
// method so its branching is not charged against handleLLM's own cognitive
// complexity. See the ModifyResponse call site for what it is responsible
// for.
func (r *Relay) captureLLMFailure(entry *workerEntry, resp *http.Response) error {
	if resp.StatusCode < 400 {
		if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
			// A 200 stream can still fail: providers signal hard limits
			// (OpenAI's insufficient_quota) as an in-stream error event
			// after the stream opens. Watch the frames as they pass through
			// untouched; a clean end clears the capture, an error event
			// captures and latches (see llmStreamSniffer).
			resp.Body = newLLMStreamSniffer(resp.Body, entry, clog.Get(r.baseCtx))
			return nil
		}
		// A later successful call clears the capture: a transient failure
		// the SDK retried past must not be blamed for an unrelated error
		// the agent reports afterwards.
		entry.clearLLMError()
		return nil
	}
	peeked, err := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes))
	// Chain any unread remainder back on so a >cap body still reaches the
	// worker's SDK intact (truncating against a larger Content-Length would
	// corrupt the response); Close closes the original body.
	rest := resp.Body
	resp.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytes.NewReader(peeked), rest), rest}
	if err != nil {
		return nil //nolint:nilerr // capture is best-effort; the proxied response stands.
	}
	e, typed := decodeLLMErrorBody(peeked, upstreamResponse{
		handledCode: resp.Header.Get(herr.HandledErrorHeader),
		status:      resp.StatusCode,
		contentType: resp.Header.Get("Content-Type"),
	})
	if !typed {
		r.warnIfMarkerLooksStripped(entry, resp, peeked)
		r.logUntypedLLMFailure(entry, failureBody{resp: resp, peeked: peeked}, &e)
	}
	if typed {
		if e.Meta == nil {
			e.Meta = herr.M{}
		}
		// Gateway envelopes deliberately carry no HTTP status.
		e.Meta["http_status"] = resp.StatusCode
		scrubUpstreamRelayedProse(&e)
	}
	entry.setLLMError(e)
	r.cutRetryLoopOnHardLimit(entry, resp, e)
	return nil
}

// warnIfMarkerLooksStripped diagnoses a specific mid-rollout failure mode: a
// body carrying the exact triplet shape a herr envelope always has (code ==
// type, both non-empty, a non-empty message) that nonetheless failed
// isGatewayEnvelope's marker check, because the header was absent or did not
// match the body's own code. That shape is unlikely by coincidence, so it is
// worth a warn even though the untyped/no-prose trust decision does not
// change — logs only the two codes being compared, never the message.
func (r *Relay) warnIfMarkerLooksStripped(entry *workerEntry, resp *http.Response, peeked []byte) {
	var envelope herr.ErrorResponse
	if json.Unmarshal(peeked, &envelope) != nil {
		return
	}
	body := envelope.Error
	if body.Code == "" || body.Type != body.Code || body.Message == "" {
		return
	}
	handledCode := resp.Header.Get(herr.HandledErrorHeader)
	if handledCode == body.Code {
		return // isGatewayEnvelope would have trusted this; nothing stripped.
	}
	clog.Get(r.baseCtx).Warn("otelrelay llm handled-error marker missing or mismatched",
		zap.String("conversation", entry.info.ConversationID),
		zap.String("body_code", body.Code),
		zap.String("marker", handledCode))
}

// failureBody is the raw response plus the bytes captureLLMFailure already
// peeked off it, bundled so logUntypedLLMFailure stays under the repo's
// 3-argument limit (revive argument-limit).
type failureBody struct {
	resp   *http.Response
	peeked []byte
}

// logUntypedLLMFailure records the bounded, safe-to-log classification of a
// provider-native failure body: never the provider's own prose, which can
// echo credentials (an invalid-key response quoting the key back).
func (r *Relay) logUntypedLLMFailure(entry *workerEntry, body failureBody, e *herr.E) {
	bodyKind, _ := e.Meta["body_kind"].(string)
	if bodyKind == "" {
		bodyKind = "unknown"
	}
	// The gateway sets this header itself on the errors it authors
	// (writeUpstreamError); it names which provider the failure came from,
	// not anything the provider wrote, so it is safe to carry into the
	// capture even though the body around it is not.
	provider := body.resp.Header.Get("X-LangWatch-Provider")
	if provider != "" {
		if e.Meta == nil {
			e.Meta = herr.M{}
		}
		e.Meta["provider"] = provider
	}
	clog.Get(r.baseCtx).Info("otelrelay llm error normalized as handled upstream error",
		zap.String("conversation", entry.info.ConversationID),
		zap.Int("status", body.resp.StatusCode),
		zap.Int("body_bytes", len(body.peeked)),
		zap.String("body_kind", bodyKind),
		zap.String("upstream_code", string(firstHandledReasonCode(*e))),
		zap.String("provider", provider))
}

// cutRetryLoopOnHardLimit answers a rate-limited retry terminally once the
// conversation has hit rateLimitCutAfter consecutive 429s, or immediately on
// a hard plan-limit discriminant — see cutRateLimitRetry and
// hasHardLimitReason for why a 429 alone is not enough to cut on.
//
// The count is of UNINTERRUPTED 429s: any other answer, a 500 included,
// resets it (without touching the capture already set on entry). A mixed
// flap is not a deterministic limit, and only a limit that answers every
// backoff identically should be cut.
func (r *Relay) cutRetryLoopOnHardLimit(entry *workerEntry, resp *http.Response, e herr.E) {
	if resp.StatusCode != http.StatusTooManyRequests {
		entry.resetRateLimitStrikes()
		return
	}
	hard := hasHardLimitReason(e)
	strikes := entry.strikeRateLimit()
	if hard || strikes >= rateLimitCutAfter {
		cutRateLimitRetry(resp)
		clog.Get(r.baseCtx).Info("otelrelay llm rate-limit retry loop cut",
			zap.String("conversation", entry.info.ConversationID),
			zap.Bool("hard_limit", hard),
			zap.Int("consecutive", strikes))
	}
}

// llmTargetURL joins the request path BEYOND /w/{token}/llm onto the
// conversation's gateway base URL, preserving the query string. The base URL's
// own path (e.g. /openai/v1) is kept, so SDK-relative paths land where the
// direct OPENAI_BASE_URL wiring used to send them.
//
// One join rule beyond concatenation: a client speaking a version-rooted
// dialect (pi's anthropic-messages lane appends /v1/messages to its base URL)
// sends a path that starts with /v1 while the gateway base URL already ends in
// /v1, the segment is deduplicated so the forward lands on the gateway's
// /v1/messages, not /v1/v1/messages. The OpenAI-relative dialects
// (/chat/completions, /responses) never start with /v1 and are unaffected.
func llmTargetURL(gatewayBaseURL, token string, reqURL *url.URL) (*url.URL, error) {
	base, err := url.Parse(gatewayBaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse gateway base url: %w", err)
	}
	if base.Scheme == "" || base.Host == "" {
		return nil, fmt.Errorf("gateway base url %q has no scheme/host", gatewayBaseURL)
	}
	prefix := "/w/" + token + llmPrefix
	rest := strings.TrimPrefix(reqURL.Path, prefix)
	basePath := strings.TrimRight(base.Path, "/")
	if strings.HasSuffix(basePath, "/v1") && strings.HasPrefix(rest, "/v1/") {
		rest = strings.TrimPrefix(rest, "/v1")
	}
	out := *base
	out.Path = basePath + rest
	out.RawQuery = reqURL.RawQuery
	return &out, nil
}

// llmUpstreamErrorCode marks a failed mediated LLM call whose response body was
// NOT the gateway's typed herr envelope — a provider-native error the gateway
// forwarded verbatim (an Anthropic "credit balance too low", the codex
// backend's `{"detail": ...}`). The provider's own error type rides as a typed
// reason so the control plane can name the failure; the provider's prose does
// not travel with it (see decodeLLMErrorBody).
const llmUpstreamErrorCode = herr.Code("llm_upstream_error")

// rateLimitCutAfter is how many CONSECUTIVE 429s a conversation's mediated LLM
// calls may accumulate before the proxy converts the next one into a
// non-retryable failure. A genuine burst (tokens-per-minute) clears within a
// retry or two; only a limit that answers every backoff identically reaches
// three in a row.
const rateLimitCutAfter = 3

// hardLimitReasonCodes are the provider discriminants that mark a failure as a
// PLAN limit, deterministic until the provider's window or billing resets
// rather than a burst. These cut the retry loop on the FIRST strike: every
// retry would be answered identically, and the panel already has bespoke copy
// for them (langyErrorExplainer promotes `usage_limit_reached` to the
// plan-limit card). Applies to rejected calls (429) and to in-stream error
// events on 200 streams alike.
var hardLimitReasonCodes = map[herr.Code]bool{
	"usage_limit_reached":        true,
	"codex_plan_limit":           true,
	"insufficient_quota":         true,
	"billing_hard_limit_reached": true,
}

// hasHardLimitReason walks a captured LLM error's code and reason chain for a
// hard plan-limit discriminant.
func hasHardLimitReason(e herr.E) bool {
	if hardLimitReasonCodes[e.Code] {
		return true
	}
	for _, reason := range e.Reasons {
		if nested, ok := reason.(herr.E); ok && hasHardLimitReason(nested) {
			return true
		}
	}
	return false
}

// cutRateLimitRetry rewrites an upstream 429 into a response the worker SDK
// treats as FINAL. The body — the provider's own error JSON — passes through
// untouched, so the agent's error event and the captured herr both still name
// the real cause; only the status stops being an invitation to retry. The
// retry-steering headers go with it so no SDK second-guesses the status.
func cutRateLimitRetry(resp *http.Response) {
	resp.StatusCode = http.StatusBadRequest
	resp.Status = "400 Bad Request"
	resp.Header.Del("Retry-After")
	resp.Header.Del("x-should-retry")
	resp.Header.Del("retry-after-ms")
}

// maxProviderCodeBytes bounds a provider discriminant carried as a typed
// reason. Longer strings are prose, not codes anyone should dispatch on.
const maxProviderCodeBytes = 128

// providerCodePattern deliberately admits identifiers rather than arbitrary
// strings. Provider prose can contain credentials and belongs neither in the
// handled-error wire contract nor in logs.
var providerCodePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_.:-]*$`)

// providerCodePaths cover the provider JSON dialects observed in production
// and the common OpenAI/Anthropic/JSON:API variants. Prefer a semantic `code`
// over a broad `type` whenever both exist.
var providerCodePaths = []string{
	"error.code",
	"error.error.code",
	"errors.0.code",
	"code",
	// Google's dialect: error.code is a NUMBER (HTTP status), and the string
	// discriminant lives under status/error.status instead ("RESOURCE_EXHAUSTED").
	"error.status",
	"error.error.status",
	"status",
	"error.type",
	"error.error.type",
	"errors.0.type",
	"type",
}

// decodeLLMErrorBody turns a failed LLM response body into the herr.E the turn's
// terminal error frame carries as its cause. Typed gateway envelopes (see
// isGatewayEnvelope) decode losslessly (typed=true) — that message is OUR own,
// written by the gateway for a cause it named, so it travels as it always has.
//
// Anything else, whether provider-native error JSON the gateway forwards
// byte-for-byte or plain text, becomes an `llm_upstream_error` carrying the
// provider's DISCRIMINANT and no prose (typed=false).
//
// It used to carry the prose too, in Meta["message"], reasoning that provider
// error messages are client-facing by design because they are the same body the
// SDK shows. The flaw is who "the client" is: that body is written for whoever
// holds the API key, and on a mediated call the key holder is LangWatch.
// OpenAI rejects a bad key with `Incorrect API key provided: sk-proj-…`, so
// forwarding the sentence hands a customer a platform credential — and because
// Meta is a client contract, it does that whether or not any UI renders it.
// Filtering the prose instead was considered and rejected: matching credential
// shapes only catches the shapes someone enumerated.
//
// What remains is strictly better structured. When a provider-native body names
// its own error type, that discriminant rides as a typed reason under the
// `llm_upstream_error`, and the control plane classifies the ones it knows by
// exact reason code (the codex backend's `usage_limit_reached` becomes the
// plan-limit card) while the top-level cause still says the failure came from
// upstream. A discriminant is a value from a set the provider enumerates, so it
// cannot smuggle a key the way free text can.
//
// Unknown prose is intentionally not retained. The caller logs the safe
// handled classification (status, body kind, and discriminant) instead.
// upstreamResponse carries the response metadata decodeLLMErrorBody needs
// beyond the body bytes, collapsed into one param to stay under the
// repo's 3-argument limit (revive argument-limit).
type upstreamResponse struct {
	handledCode string
	status      int
	contentType string
}

func decodeLLMErrorBody(peeked []byte, resp upstreamResponse) (e herr.E, typed bool) {
	var envelope herr.ErrorResponse
	if err := json.Unmarshal(peeked, &envelope); err == nil {
		if isGatewayEnvelope(envelope.Error, resp.handledCode) {
			return herr.FromBody(envelope.Error), true
		}
	} else if resp.handledCode != "" {
		// The marker header is gateway-minted and stripped from anything the
		// gateway did not author (writeJSONResponse, writeUpstreamError), so
		// its presence is trustworthy even when the body itself failed to
		// parse (truncated by a proxy, transport-mangled). Trust the code,
		// carry nothing else: there is no message to lose.
		//
		// herrgen:external — this reads whichever of OUR OWN codes the marker
		// names; the code itself is already declared (and generated) at its
		// origin, this is just a dynamic read of that value off a header.
		return herr.E{Code: herr.Code(resp.handledCode)}, true
	}
	return decodeProviderErrorBody(peeked, resp.status, resp.contentType), false
}

// decodeProviderErrorBody captures a body KNOWN to be provider-native, skipping
// the gateway-envelope test that decodeLLMErrorBody opens with.
//
// Callers that already know which side a body came from should use this rather
// than paying for a shape guess they do not need. An SSE error event inside a
// 200 stream is the case in point: the gateway reports its own failures as
// non-200 JSON responses through herr.WriteHTTP, so nothing arriving mid-stream
// is ever its envelope — and the guess is not free, because a provider dialect
// CAN satisfy it by coincidence. OpenAI's quota body sets type and code to the
// same `insufficient_quota` with a message alongside, which is precisely the
// shape isGatewayEnvelope reads as ours; routing it through here keeps its
// prose out of the frame on the strength of where it came from rather than
// what it looks like.
func decodeProviderErrorBody(peeked []byte, status int, contentType string) herr.E {
	e := herr.E{Code: llmUpstreamErrorCode, Meta: herr.M{
		"body_kind": providerBodyKind(peeked, contentType),
	}}
	if status > 0 {
		e.Meta["http_status"] = status
	}

	code := providerErrorCode(peeked)
	if code == "" {
		code = upstreamHTTPReasonCode(status)
	}
	if code != "" {
		// herrgen:external — provider and upstream-HTTP discriminants are
		// relayed as reasons so clients can branch on them. They are not our
		// top-level error codes and do not belong in the generated code list.
		e.Reasons = []error{herr.E{Code: code}}
	}
	return e
}

func providerErrorCode(body []byte) herr.Code {
	if !json.Valid(body) {
		return ""
	}
	// A hard-limit discriminant wins regardless of path order. providerCodePaths
	// prefers a semantic `code` over a broad `type`, but a body carrying BOTH (a
	// plan-limit `type` alongside an unrelated `code`) must not let the generic
	// code bury the plan-limit signal — it is what disables the first-strike
	// retry cut in hasHardLimitReason.
	for _, path := range providerCodePaths {
		if candidate, ok := providerCodeCandidate(body, path); ok && hardLimitReasonCodes[candidate] {
			return candidate
		}
	}
	for _, path := range providerCodePaths {
		if candidate, ok := providerCodeCandidate(body, path); ok {
			return candidate
		}
	}
	return ""
}

// providerCodeCandidate reads path out of body and reports whether it is a
// well-formed provider discriminant (a short identifier, not prose).
func providerCodeCandidate(body []byte, path string) (herr.Code, bool) {
	value := gjson.GetBytes(body, path)
	if value.Type != gjson.String || len(value.Str) > maxProviderCodeBytes ||
		!providerCodePattern.MatchString(value.Str) {
		return "", false
	}
	// herrgen:external — this is the provider's identifier, not ours.
	return herr.Code(value.Str), true
}

// upstreamReasonCodes name the upstream HTTP status when the provider's own
// body carries no discriminant of its own (see providerErrorCode for that
// case). Status 0 is never a real HTTP status; decodeProviderErrorBody passes
// it for the SSE lane, where a terminal in-stream event has no status at all,
// so every capture still carries exactly one reason.
var upstreamReasonCodes = map[int]herr.Code{
	0:                              "upstream_stream_error",
	http.StatusBadRequest:          "upstream_bad_request",
	http.StatusUnauthorized:        "upstream_unauthorized",
	http.StatusForbidden:           "upstream_forbidden",
	http.StatusNotFound:            "upstream_not_found",
	http.StatusRequestTimeout:      "upstream_timeout",
	http.StatusGatewayTimeout:      "upstream_timeout",
	http.StatusConflict:            "upstream_conflict",
	http.StatusUnprocessableEntity: "upstream_unprocessable_entity",
	http.StatusTooManyRequests:     "upstream_rate_limited",
}

func upstreamHTTPReasonCode(status int) herr.Code {
	if code, ok := upstreamReasonCodes[status]; ok {
		return code
	}
	if status >= 500 {
		return "upstream_unavailable"
	}
	return "upstream_http_error"
}

func providerBodyKind(body []byte, contentType string) string {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return "empty"
	}
	if json.Valid(trimmed) {
		return "json"
	}
	if !utf8.Valid(trimmed) {
		return "binary"
	}
	lower := strings.ToLower(string(trimmed))
	declaredHTML := strings.HasPrefix(strings.ToLower(strings.TrimSpace(contentType)), "text/html")
	if declaredHTML || strings.HasPrefix(lower, "<!doctype html") || strings.HasPrefix(lower, "<html") {
		return "html"
	}
	return "text"
}

func firstHandledReasonCode(e herr.E) herr.Code {
	for _, reason := range e.Reasons {
		if nested, ok := reason.(herr.E); ok {
			return nested.Code
		}
	}
	return e.Code
}

// upstreamRelayCodes carry a message classifyBifrostError built from the
// provider's own error text — typed (gateway-authored, marker-verified)
// but not OUR prose, so it must not reach the customer turn span.
var upstreamRelayCodes = map[herr.Code]bool{
	"provider_error":   true,
	"provider_timeout": true,
	"rate_limited":     true,
	"chain_exhausted":  true,
}

// scrubUpstreamRelayedProse deletes the upstream-derived message (and any
// tips) from every node of a typed envelope whose code relays provider text,
// so the relay never trusts what the gateway itself only forwarded.
//
// It walks the reason chain rather than stopping at the top, because the
// wrapper codes are precisely the ones that carry the prose one level down:
// chain_exhausted's own message says the chain ran out, and it is the
// per-attempt provider_error REASONS underneath that hold what each provider
// said. Scrubbing only the root would delete the harmless sentence and keep
// the ones written for whoever holds the API key.
func scrubUpstreamRelayedProse(e *herr.E) {
	if upstreamRelayCodes[e.Code] {
		delete(e.Meta, "message")
		delete(e.Meta, "tips")
	}
	for i, reason := range e.Reasons {
		nested, ok := reason.(herr.E)
		if !ok {
			continue
		}
		// herr.E is a value type, so the scrubbed copy has to be written
		// back over the slot it came from or the edit is lost.
		scrubUpstreamRelayedProse(&nested)
		e.Reasons[i] = nested
	}
}

// isGatewayEnvelope reports whether a failed response body is the gateway's
// own herr envelope rather than provider-native error JSON. Shape alone is not
// provenance: a provider can emit the same type/code/message triplet. The
// explicit herr response marker must match the body's code before its message
// and metadata are trusted.
func isGatewayEnvelope(body herr.ErrorBody, handledCode string) bool {
	return handledCode != "" && body.Code == handledCode && body.Type == body.Code && body.Message != ""
}

// remapWorkerParent translates the worker's outbound trace context into the
// turn's trace: the turn's trace id with the WORKER's span id. Span ids
// survive the relay's re-parenting unchanged, so the worker-side active span
// id (the AI SDK's doStream span wrapping the call) names the exact node the
// exported batch will carry, and the gateway's gen_ai span nests under it
// instead of landing as a sibling of the whole call tree. A missing or
// malformed worker traceparent falls back to the turn span itself.
//
// The worker chooses only WHERE inside its own turn's trace the gateway span
// hangs; a forged span id can at worst dangle its own turn's model call, the
// same self-harm surface as any other span-id lie in its exports.
func remapWorkerParent(workerTraceparent string, turn trace.SpanContext) trace.SpanContext {
	spanID, ok := traceparentSpanID(workerTraceparent)
	if !ok {
		return turn
	}
	return trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    turn.TraceID(),
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
	})
}

// traceparentSpanID extracts the parent span id from a W3C traceparent
// ("00-<32 hex trace id>-<16 hex span id>-<flags>"). ok is false for a
// missing, malformed, or all-zero span id.
func traceparentSpanID(header string) (trace.SpanID, bool) {
	parts := strings.Split(header, "-")
	if len(parts) < 4 || len(parts[2]) != 16 {
		return trace.SpanID{}, false
	}
	spanID, err := trace.SpanIDFromHex(parts[2])
	if err != nil || !spanID.IsValid() {
		return trace.SpanID{}, false
	}
	return spanID, true
}

// traceparentHeader renders a W3C traceparent for the turn's span context.
// The sampled flag is forced ON: the customer plane must always receive the
// gateway's gen_ai span for a Langy turn, regardless of the ops-plane
// sampling decision the flag would otherwise carry.
func traceparentHeader(sc trace.SpanContext) string {
	return fmt.Sprintf("00-%s-%s-01", sc.TraceID(), sc.SpanID())
}
