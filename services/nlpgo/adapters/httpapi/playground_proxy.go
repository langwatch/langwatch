// playground_proxy.go owns the inbound shape for /go/proxy/v1/*: read
// the OpenAI-shape body + x-litellm-* headers, route to the right
// dispatcher request type, stream the response back. This file is the
// HTTP-layer counterpart to gatewayproxy/headers.go (which owns the
// header → domain.Credential mapping).
package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/gatewayproxy"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/litellm"
	nlpgodomain "github.com/langwatch/langwatch/services/nlpgo/domain"
)

// playgroundProxyRequest is the abstracted shape we hand to the
// PlaygroundProxy. We keep this distinct from dispatcher.Request so the
// handler doesn't take a transitive dependency on the aigateway package
// internals.
type playgroundProxyRequest struct {
	Type       domain.RequestType
	Model      string
	Body       []byte
	Credential domain.Credential
	// HTTPPath is the path-after-/v1 (e.g. /chat/completions or
	// /v1beta/models/gemini-2.0-flash:generateContent). Only consulted
	// when Type == RequestTypePassthrough.
	HTTPPath string
}

// playgroundProxyResponse mirrors *domain.Response but kept thin to
// avoid coupling the handler to the dispatcher's internals.
type playgroundProxyResponse struct {
	StatusCode int
	Body       []byte
	Headers    http.Header
}

// playgroundProxyStream is a minimal iterator over SSE chunks. The real
// dispatcher returns *domain.StreamIterator which has a richer API; we
// re-shape it here so the handler stays unaware of the dispatcher type.
type playgroundProxyStream interface {
	Next(ctx context.Context) bool
	Chunk() []byte
	Err() error
	Close() error
}

// playgroundProxyDispatch builds the http.HandlerFunc that runs an
// inbound /go/proxy/v1/* request through the dispatcher.
func playgroundProxyDispatch(proxy PlaygroundProxy) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		cred, err := gatewayproxy.ParseCredentialFromHeaders(r.Header)
		if err != nil {
			herr.WriteHTTP(w, herr.New(ctx, nlpgodomain.ErrBadRequest, herr.M{
				"reason": "missing_provider",
			}, err))
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			herr.WriteHTTP(w, herr.New(ctx, nlpgodomain.ErrBadRequest, herr.M{
				"reason": "read_body",
			}, err))
			return
		}

		// model + stream are pulled from the body so we don't force the
		// caller to duplicate that information in headers.
		model, isStream, err := peekBodyMetadata(body)
		if err != nil {
			herr.WriteHTTP(w, herr.New(ctx, nlpgodomain.ErrBadRequest, herr.M{
				"reason": "invalid_json_body",
			}, err))
			return
		}
		bareModel := gatewayproxy.BareModel(model)

		// Rewrite body.model to the BARE id before dispatch. The TS
		// callsites (Vercel AI SDK in modelProviders/utils.ts, the
		// playground tRPC route, model.factory.ts) ship the body with
		// `"model": "openai/gpt-5.2"` because the langwatch-internal
		// "<provider>/<model>" form is what those callers think in. Bifrost
		// raw-forwards OpenAI-shape bodies to OpenAI to preserve the
		// prompt-prefix auto-cache (bifrost_parser.go:50-58), and OpenAI
		// 400s on a model field with the langwatch prefix
		// (`{"error":"invalid model ID"}`). The bare id matches what the
		// internal-only llmexecutor.translatedModelOrInferred path already
		// puts on the wire for runSignature, which is why runSignature
		// works and /go/proxy/v1 didn't until this edit.
		if model != "" && bareModel != model {
			body, err = rewriteBodyModel(body, bareModel)
			if err != nil {
				herr.WriteHTTP(w, herr.New(ctx, nlpgodomain.ErrBadRequest, herr.M{
					"reason": "rewrite_body_model",
				}, err))
				return
			}
		}

		// OpenAI's reasoning-class models (gpt-5*, o1/o3/o4) reject
		// `max_tokens` ("Unsupported parameter: 'max_tokens' is not
		// supported with this model. Use 'max_completion_tokens'
		// instead.") and pin temperature to 1.0. The internal
		// runSignature path already runs the same migration via
		// litellm.ApplyReasoningOverrides; the playground proxy was
		// raw-forwarding bodies authored by Vercel AI SDK / playground
		// callers that emit `max_tokens`. Mirror the executor here so
		// /go/proxy/v1/chat/completions doesn't 400 on Studio Monaco
		// code-completion / playground / model.factory.ts traffic.
		if litellm.IsReasoningModel(bareModel) {
			body, err = applyReasoningOverridesToBody(body, bareModel)
			if err != nil {
				herr.WriteHTTP(w, herr.New(ctx, nlpgodomain.ErrBadRequest, herr.M{
					"reason": "apply_reasoning_overrides",
				}, err))
				return
			}
		}

		reqType, httpPath := classifyPath(r.URL.Path)

		// /v1beta/* etc. → RequestTypePassthrough. Wiring it through the
		// dispatcher requires constructing dispatcher.PassthroughRequest
		// (HTTP path + method + headers), which the current shimAdapter
		// doesn't surface. Until that's plumbed, return a typed
		// not-implemented error rather than silently calling Dispatch
		// with type=passthrough and letting the provider fail with an
		// opaque "missing path" downstream.
		if reqType == domain.RequestTypePassthrough {
			herr.WriteHTTP(w, herr.New(ctx, nlpgodomain.ErrInternal, herr.M{
				"reason": "passthrough_not_implemented",
				"path":   r.URL.Path,
				"hint":   "/v1beta/* and other raw-forward paths are tracked as a separate follow-up; for now use /v1/chat/completions, /v1/messages, /v1/embeddings, or /v1/responses",
			}))
			return
		}

		req := playgroundProxyRequest{
			Type:       reqType,
			Model:      bareModel,
			Body:       body,
			Credential: cred,
			HTTPPath:   httpPath,
		}

		if isStream {
			handleStream(ctx, w, proxy, req)
			return
		}
		handleSync(ctx, w, proxy, req)
	}
}

// rewriteBodyModel sets body.model = newModel while preserving every
// other field, key ordering, and value formatting. We round-trip
// through encoding/json (decode → re-encode) rather than sjson because
// the proxy already takes that hit for peekBodyMetadata; an extra
// in-place rewrite is not worth a new dependency. JSON key ordering
// changes here are harmless — the prompt-prefix auto-cache hashes the
// `messages` array, not the surrounding envelope.
func rewriteBodyModel(body []byte, newModel string) ([]byte, error) {
	if len(body) == 0 {
		return body, nil
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(newModel)
	if err != nil {
		return nil, err
	}
	raw["model"] = encoded
	return json.Marshal(raw)
}

// applyReasoningOverridesToBody migrates max_tokens → max_completion_tokens
// and pins temperature to 1.0 for OpenAI reasoning-class models, mirroring
// the in-process llmexecutor path. The actual rewrite logic lives in
// litellm.ApplyReasoningOverrides (translator.go) — this is the
// raw-bytes-in / raw-bytes-out wrapper for the playground proxy.
func applyReasoningOverridesToBody(body []byte, modelID string) ([]byte, error) {
	if len(body) == 0 {
		return body, nil
	}
	var generic map[string]any
	if err := json.Unmarshal(body, &generic); err != nil {
		return nil, err
	}
	litellm.ApplyReasoningOverrides(modelID, generic)
	return json.Marshal(generic)
}

// peekBodyMetadata reads the body once to extract the OpenAI-shape
// `model` field and the `stream` boolean. We don't json.Unmarshal into
// a typed struct because some providers add extension fields we want to
// forward verbatim — extra-field tolerance + raw forwarding is the
// whole point of a passthrough.
func peekBodyMetadata(body []byte) (model string, stream bool, err error) {
	if len(body) == 0 {
		return "", false, nil
	}
	var raw map[string]any
	if jsonErr := json.Unmarshal(body, &raw); jsonErr != nil {
		return "", false, jsonErr
	}
	if v, ok := raw["model"].(string); ok {
		model = v
	}
	if v, ok := raw["stream"].(bool); ok {
		stream = v
	}
	return model, stream, nil
}

// classifyPath maps an inbound URL path to a dispatcher RequestType.
// The known set covers OpenAI's /chat/completions, /embeddings,
// /responses, Anthropic's /messages, and a passthrough catch-all for
// Gemini's /v1beta/models/...:generateContent style paths.
func classifyPath(urlPath string) (domain.RequestType, string) {
	suffix := strings.TrimPrefix(urlPath, "/go/proxy")
	suffix = strings.TrimPrefix(suffix, "/v1")
	switch {
	case strings.HasSuffix(suffix, "/chat/completions"):
		return domain.RequestTypeChat, suffix
	case strings.HasSuffix(suffix, "/messages"):
		return domain.RequestTypeMessages, suffix
	case strings.HasSuffix(suffix, "/embeddings"):
		return domain.RequestTypeEmbeddings, suffix
	case strings.HasSuffix(suffix, "/responses"):
		return domain.RequestTypeResponses, suffix
	default:
		return domain.RequestTypePassthrough, suffix
	}
}

func handleSync(ctx context.Context, w http.ResponseWriter, proxy PlaygroundProxy, req playgroundProxyRequest) {
	resp, err := proxy.Dispatch(ctx, req)
	if err != nil {
		herr.WriteHTTP(w, herr.New(ctx, nlpgodomain.ErrGatewayUnavailable, herr.M{
			"reason": "dispatcher_error",
		}, err))
		return
	}
	// Forward the upstream content-type so the playground sees JSON as JSON.
	for k, vv := range resp.Headers {
		// Skip hop-by-hop and length headers — net/http will recompute.
		switch strings.ToLower(k) {
		case "content-length", "transfer-encoding", "connection":
			continue
		}
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	statusCode := resp.StatusCode
	if statusCode == 0 {
		statusCode = http.StatusOK
	}
	w.WriteHeader(statusCode)
	_, _ = w.Write(resp.Body)
}

func handleStream(ctx context.Context, w http.ResponseWriter, proxy PlaygroundProxy, req playgroundProxyRequest) {
	iter, err := proxy.DispatchStream(ctx, req)
	if err != nil {
		herr.WriteHTTP(w, herr.New(ctx, nlpgodomain.ErrGatewayUnavailable, herr.M{
			"reason": "dispatcher_stream_error",
		}, err))
		return
	}
	defer func() { _ = iter.Close() }()

	flusher, _ := w.(http.Flusher)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering
	w.WriteHeader(http.StatusOK)
	if flusher != nil {
		flusher.Flush()
	}

	for iter.Next(ctx) {
		chunk := iter.Chunk()
		// The dispatcher hands us already-framed SSE bytes (data: …\n\n)
		// for OpenAI-shape providers and provider-native chunks for
		// passthrough — either way we forward verbatim. If a chunk
		// somehow lacks a final blank line, we don't try to repair it;
		// the playground parser is tolerant of either shape today.
		if _, err := w.Write(chunk); err != nil {
			return // client disconnected
		}
		if flusher != nil {
			flusher.Flush()
		}
	}
	if err := iter.Err(); err != nil {
		// Stream errored mid-flight — emit a final event the playground
		// parser will surface as a banner. We don't set an HTTP status
		// because headers are already on the wire.
		errFrame := fmt.Sprintf("event: error\ndata: %s\n\n", jsonEscape(err.Error()))
		_, _ = w.Write([]byte(errFrame))
		if flusher != nil {
			flusher.Flush()
		}
	}
}

// jsonEscape produces a JSON string literal (with surrounding quotes)
// suitable for inclusion in an SSE data: line. Any encoding error
// degrades to a generic message rather than panicking — playground
// errors should never silently fail-open.
func jsonEscape(s string) string {
	b, err := json.Marshal(map[string]any{"message": s})
	if err != nil {
		return `{"message":"upstream stream error"}`
	}
	return string(bytes.TrimSpace(b))
}

// guard against unused-imports warnings in the case the dispatcher
// signature evolves
var _ = errors.New

// PlaygroundProxyFromDispatcher adapts the in-process aigateway
// dispatcher to the PlaygroundProxy interface this handler consumes.
// It exists in this file (not cmd/root.go) so the cmd package doesn't
// need access to playgroundProxyRequest/Response which we keep unexported
// to discourage callers outside this package from coupling to those
// internal shapes.
//
// The DispatcherShim type is the minimal contract — *dispatcher.Dispatcher
// (services/aigateway/dispatcher) satisfies it without any wrapping.
type DispatcherShim interface {
	Dispatch(ctx context.Context, req DispatchRequest) (*DispatchResponse, error)
	DispatchStream(ctx context.Context, req DispatchRequest) (DispatchStream, error)
}

// DispatchRequest mirrors dispatcher.Request via re-export-by-shape so
// httpapi doesn't have to import the dispatcher package directly. The
// real dispatcher.Request is structurally identical; the adapter
// constructed in cmd/ does the field-by-field copy.
type DispatchRequest struct {
	Type       domain.RequestType
	Model      string
	Body       []byte
	Credential domain.Credential
}

// DispatchResponse mirrors *domain.Response.
type DispatchResponse struct {
	StatusCode int
	Body       []byte
	Headers    http.Header
}

// DispatchStream mirrors domain.StreamIterator.
type DispatchStream interface {
	Next(ctx context.Context) bool
	Chunk() []byte
	Err() error
	Close() error
}

// shimAdapter adapts a DispatcherShim to PlaygroundProxy. It bridges
// the playgroundProxyRequest (with HTTPPath) → DispatchRequest (without
// — passthrough mode is a future extension that wires HTTPPath in).
type shimAdapter struct {
	shim DispatcherShim
}

// NewPlaygroundProxyFromShim returns a PlaygroundProxy that forwards
// to the given DispatcherShim. cmd/ wires this with a tiny adapter
// over *dispatcher.Dispatcher.
func NewPlaygroundProxyFromShim(shim DispatcherShim) PlaygroundProxy {
	return &shimAdapter{shim: shim}
}

func (a *shimAdapter) Dispatch(ctx context.Context, req playgroundProxyRequest) (*playgroundProxyResponse, error) {
	resp, err := a.shim.Dispatch(ctx, DispatchRequest{
		Type:       req.Type,
		Model:      req.Model,
		Body:       req.Body,
		Credential: req.Credential,
	})
	if err != nil {
		return nil, err
	}
	return &playgroundProxyResponse{
		StatusCode: resp.StatusCode,
		Body:       resp.Body,
		Headers:    resp.Headers,
	}, nil
}

func (a *shimAdapter) DispatchStream(ctx context.Context, req playgroundProxyRequest) (playgroundProxyStream, error) {
	iter, err := a.shim.DispatchStream(ctx, DispatchRequest{
		Type:       req.Type,
		Model:      req.Model,
		Body:       req.Body,
		Credential: req.Credential,
	})
	if err != nil {
		return nil, err
	}
	return iter, nil
}
