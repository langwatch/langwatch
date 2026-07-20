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
	"strings"

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
			// Stitch the gateway's customer-facing gen_ai span into the turn's
			// trace. When the worker's native OTel supplied a traceparent, keep
			// its SPAN id (the worker span that made this call — preserved
			// verbatim by ReparentTraces, so it exists in the customer trace)
			// but ALWAYS replace the trace id with the turn's: the worker's
			// native trace id is meaningless post-reparent, and the worker — a
			// model-driven, prompt-injectable process — must never choose which
			// trace its calls land in. Worst-case forgery is a dangling parent
			// span id inside its own turn's trace. No (or a malformed) worker
			// traceparent parents on the turn span itself; no turn context at
			// all stamps nothing and the gateway roots its own trace.
			if sc := entry.turnContext(); sc.IsValid() {
				pr.Out.Header.Set("traceparent",
					stitchedTraceparent(sc, req.Header.Get("traceparent")))
			} else {
				pr.Out.Header.Del("traceparent")
			}
			pr.SetXForwarded()
		},
		// Negative ⇒ flush immediately after each write: SSE pass-through.
		FlushInterval: -1,
		// A failed call answers with the gateway's herr envelope. Decode it back
		// into a herr.E (herr.FromBody — the cross-process continuation) so the
		// turn's terminal error frame carries the REAL typed cause — opencode
		// launders this body into "AI_APICallError" prose the control plane must
		// never trust. The body is restored untouched for the worker's SDK.
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
			var envelope herr.ErrorResponse
			if json.Unmarshal(peeked, &envelope) != nil || envelope.Error.Type == "" {
				return nil // not a herr envelope (e.g. a raw provider body) — skip.
			}
			e := herr.FromBody(envelope.Error)
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

// traceparentHeader renders a W3C traceparent for the turn's span context.
// The sampled flag is forced ON: the customer plane must always receive the
// gateway's gen_ai span for a Langy turn, regardless of the ops-plane
// sampling decision the flag would otherwise carry.
func traceparentHeader(sc trace.SpanContext) string {
	return fmt.Sprintf("00-%s-%s-01", sc.TraceID(), sc.SpanID())
}

// workerTraceparentRe accepts exactly the W3C shape and captures the span id.
var workerTraceparentRe = regexp.MustCompile(
	`^00-[0-9a-f]{32}-([0-9a-f]{16})-[0-9a-f]{2}$`,
)

// stitchedTraceparent is the turn's trace id joined with the worker's calling
// span id when one was supplied (see the Rewrite comment for the trust
// analysis); otherwise the turn span context verbatim.
func stitchedTraceparent(turn trace.SpanContext, workerHeader string) string {
	m := workerTraceparentRe.FindStringSubmatch(strings.TrimSpace(workerHeader))
	if m == nil || m[1] == "0000000000000000" {
		return traceparentHeader(turn)
	}
	return fmt.Sprintf("00-%s-%s-01", turn.TraceID(), m[1])
}
