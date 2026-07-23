package otelrelay

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
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
			// Codex turns run opencode's NATIVE openai provider (the Responses
			// dialect the codex backend speaks), so the worker's request says
			// "gpt-…"; restore the full provider-prefixed id on the wire and
			// the gateway routes it to the codex credential. See provision.go.
			rewriteCodexModelBody(pr.Out, entry.info.Model)
			// Stamp the TURN's traceparent so the gateway's customer-facing
			// gen_ai span joins the turn's trace. The worker's own traceparent
			// is deliberately NOT continued, for two reasons: its trace id is
			// worker-chosen (a prompt-injectable process must never pick which
			// trace its calls land in), and — verified against opencode's real
			// export set — the span id it stamps on outbound calls belongs to
			// an internal fetch span it never exports, so continuing it parents
			// the gateway span under a node that will never exist. The turn
			// span is the one stable ancestor both the worker's re-parented
			// roots and this span share. An invalid (not-yet-set) turn context
			// stamps nothing — the gateway then roots its own trace.
			if sc := entry.turnContext(); sc.IsValid() {
				pr.Out.Header.Set("traceparent", traceparentHeader(sc))
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
		// forwarded verbatim (Anthropic's "credit balance too low", the codex
		// backend's `detail`) is captured best-effort with the provider's
		// message. The body is restored untouched for the worker's SDK.
		ModifyResponse: func(resp *http.Response) error {
			if resp.StatusCode < 400 {
				// A later successful call clears the capture: a transient failure
				// the SDK retried past must not be blamed for an unrelated error
				// the agent reports afterwards.
				entry.clearLLMError()
				return nil
			}
			peeked, err := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes))
			// Chain any unread remainder back on so a >cap body still reaches the
			// worker's SDK intact (truncating against a larger Content-Length
			// would corrupt the response); Close closes the original body.
			rest := resp.Body
			resp.Body = struct {
				io.Reader
				io.Closer
			}{io.MultiReader(bytes.NewReader(peeked), rest), rest}
			if err != nil {
				return nil // capture is best-effort; the proxied response stands.
			}
			e, typed := decodeLLMErrorBody(peeked)
			if !typed {
				clog.Get(r.baseCtx).Info("otelrelay llm error body not a typed envelope; captured best-effort",
					zap.String("conversation", entry.info.ConversationID),
					zap.Int("status", resp.StatusCode),
					zap.Int("body_bytes", len(peeked)),
					zap.String("content_type", resp.Header.Get("Content-Type")))
			}
			if e.Meta == nil {
				e.Meta = herr.M{}
			}
			// The envelope deliberately carries no HTTP status; keep it in meta.
			e.Meta["http_status"] = resp.StatusCode
			entry.setLLMError(e)
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

// llmTargetURL joins the request path BEYOND /w/{token}/llm onto the
// conversation's gateway base URL, preserving the query string. The base URL's
// own path (e.g. /openai/v1) is kept, so SDK-relative paths land where the
// direct OPENAI_BASE_URL wiring used to send them.
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
	out := *base
	out.Path = strings.TrimRight(base.Path, "/") + rest
	out.RawQuery = reqURL.RawQuery
	return &out, nil
}

// llmUpstreamErrorCode marks a failed mediated LLM call whose response body was
// NOT the gateway's typed herr envelope — a provider-native error the gateway
// forwarded verbatim (an Anthropic "credit balance too low", the codex
// backend's `{"detail": ...}`). The provider's message rides Meta["message"]
// so the turn's terminal error frame still names the real failure.
const llmUpstreamErrorCode = herr.Code("llm_upstream_error")

// maxUpstreamMessageBytes bounds the provider message carried on a best-effort
// capture, so a pathological body never bloats the error frame.
const maxUpstreamMessageBytes = 2048

// decodeLLMErrorBody turns a failed LLM response body into the herr.E the turn's
// terminal error frame carries as its cause. Typed gateway envelopes decode
// losslessly (typed=true). Anything else — provider-native error JSON the
// gateway forwards byte-for-byte, or plain text — is captured best-effort as an
// `llm_upstream_error` whose Meta["message"] holds the provider's own message
// (typed=false). Provider error messages are client-facing by design (the same
// body the SDK shows), so carrying the prose is safe.
func decodeLLMErrorBody(peeked []byte) (e herr.E, typed bool) {
	var envelope herr.ErrorResponse
	if json.Unmarshal(peeked, &envelope) == nil &&
		(envelope.Error.Type != "" || envelope.Error.Code != "") {
		return herr.FromBody(envelope.Error), true
	}
	e = herr.E{Code: llmUpstreamErrorCode, Meta: herr.M{}}
	if message := extractUpstreamErrorMessage(peeked); message != "" {
		e.Meta["message"] = message
	}
	return e, false
}

// extractUpstreamErrorMessage pulls the human-readable message out of the known
// provider error dialects: OpenAI/Anthropic `error.message`, the codex
// backend's `detail`, a bare `message`. Falls back to the raw body when it is
// short, printable text. Returns "" when nothing readable is found.
func extractUpstreamErrorMessage(body []byte) string {
	for _, path := range []string{"error.message", "detail", "message"} {
		if v := gjson.GetBytes(body, path); v.Type == gjson.String && v.Str != "" {
			return boundMessage(v.Str)
		}
	}
	trimmed := strings.TrimSpace(string(body))
	if trimmed != "" && !strings.HasPrefix(trimmed, "{") && !strings.HasPrefix(trimmed, "[") {
		return boundMessage(trimmed)
	}
	return ""
}

// boundMessage caps a provider message at maxUpstreamMessageBytes, backing off
// to a rune boundary.
func boundMessage(message string) string {
	if len(message) <= maxUpstreamMessageBytes {
		return message
	}
	cut := message[:maxUpstreamMessageBytes]
	for len(cut) > 0 && !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	return cut + "…"
}

// traceparentHeader renders a W3C traceparent for the turn's span context.
// The sampled flag is forced ON: the customer plane must always receive the
// gateway's gen_ai span for a Langy turn, regardless of the ops-plane
// sampling decision the flag would otherwise carry.
func traceparentHeader(sc trace.SpanContext) string {
	return fmt.Sprintf("00-%s-%s-01", sc.TraceID(), sc.SpanID())
}
