package app

import (
	"context"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/httpmiddleware"
	"github.com/langwatch/langwatch/pkg/ksuid"
	"github.com/langwatch/langwatch/pkg/retry"
	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// --- Result types ---

// DispatchMeta holds metadata accumulated during dispatch for response headers.
type DispatchMeta = pipeline.Meta

// CompletionResult is the result of a non-streaming chat/messages dispatch.
type CompletionResult struct {
	Meta     DispatchMeta
	Response *domain.Response
}

// StreamResult is the result of a streaming chat/messages dispatch.
type StreamResult struct {
	Meta     DispatchMeta
	Iterator domain.StreamIterator
}

// EmbeddingResult is the result of a non-streaming embeddings dispatch.
type EmbeddingResult struct {
	Meta     DispatchMeta
	Response *domain.Response
}

// --- Typed entry points ---

// HandleChat dispatches a non-streaming chat completions request.
func (a *App) HandleChat(ctx context.Context, bundle *domain.Bundle, body []byte) (*CompletionResult, error) {
	call := newCall(ctx, bundle, domain.RequestTypeChat, body, false)
	resp, err := a.pipeline.Sync(ctx, call)
	if err != nil {
		return nil, err
	}
	return &CompletionResult{Meta: *call.Meta, Response: resp}, nil
}

// HandleChatStream dispatches a streaming chat completions request.
func (a *App) HandleChatStream(ctx context.Context, bundle *domain.Bundle, body []byte) (*StreamResult, error) {
	call := newCall(ctx, bundle, domain.RequestTypeChat, body, true)
	iter, err := a.pipeline.Stream(ctx, call)
	if err != nil {
		return nil, err
	}
	return &StreamResult{Meta: *call.Meta, Iterator: iter}, nil
}

// HandleMessages dispatches a non-streaming Anthropic messages request.
func (a *App) HandleMessages(ctx context.Context, bundle *domain.Bundle, body []byte) (*CompletionResult, error) {
	call := newCall(ctx, bundle, domain.RequestTypeMessages, body, false)
	resp, err := a.pipeline.Sync(ctx, call)
	if err != nil {
		return nil, err
	}
	return &CompletionResult{Meta: *call.Meta, Response: resp}, nil
}

// HandleMessagesStream dispatches a streaming Anthropic messages request.
func (a *App) HandleMessagesStream(ctx context.Context, bundle *domain.Bundle, body []byte) (*StreamResult, error) {
	call := newCall(ctx, bundle, domain.RequestTypeMessages, body, true)
	iter, err := a.pipeline.Stream(ctx, call)
	if err != nil {
		return nil, err
	}
	return &StreamResult{Meta: *call.Meta, Iterator: iter}, nil
}

// HandleEmbeddings dispatches an embeddings request (never streams).
func (a *App) HandleEmbeddings(ctx context.Context, bundle *domain.Bundle, body []byte) (*EmbeddingResult, error) {
	call := newCall(ctx, bundle, domain.RequestTypeEmbeddings, body, false)
	resp, err := a.pipeline.Sync(ctx, call)
	if err != nil {
		return nil, err
	}
	return &EmbeddingResult{Meta: *call.Meta, Response: resp}, nil
}

// PeekStream checks the "stream" field in a JSON request body.
// Exported for use by the transport layer.
func PeekStream(body []byte) bool {
	return gjson.GetBytes(body, "stream").Bool()
}

// --- Core dispatch (terminal handlers for the pipeline) ---

func (a *App) coreDispatch(ctx context.Context, call *pipeline.Call) (*domain.Response, error) {
	resp, el, err := retry.Walk(ctx, retryOpts(call.Bundle), credentialIDs(call.Bundle.Credentials),
		func(ctx context.Context, slotID string) (*domain.Response, error) {
			return a.providers.Dispatch(ctx, call.Request, findCredential(call.Bundle.Credentials, slotID))
		}, classifyProviderError)
	call.Meta.FallbackCount = countFallbacks(el)
	el.Release()
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func (a *App) coreDispatchStream(ctx context.Context, call *pipeline.Call) (domain.StreamIterator, error) {
	iter, el, err := retry.Walk(ctx, retryOpts(call.Bundle), credentialIDs(call.Bundle.Credentials),
		func(ctx context.Context, slotID string) (domain.StreamIterator, error) {
			return a.providers.DispatchStream(ctx, call.Request, findCredential(call.Bundle.Credentials, slotID))
		}, classifyProviderError)
	call.Meta.FallbackCount = countFallbacks(el)
	el.Release()
	if err != nil {
		return nil, err
	}
	return iter, nil
}

// --- Helpers ---

func newCall(ctx context.Context, bundle *domain.Bundle, reqType domain.RequestType, body []byte, streaming bool) *pipeline.Call {
	id := httpmiddleware.GetRequestID(ctx)
	if id == "" {
		id = ksuid.Generate(ctx, ksuid.ResourceGatewayRequest).String()
	}
	return &pipeline.Call{
		Bundle:  bundle,
		Request: &domain.Request{Type: reqType, Model: peekModel(body), Body: body, Streaming: streaming},
		Meta:    &pipeline.Meta{GatewayRequestID: id},
	}
}

func retryOpts(bundle *domain.Bundle) retry.Options {
	return retry.Options{MaxAttempts: bundle.Config.Fallback.MaxAttempts}
}

func credentialIDs(creds []domain.Credential) []string {
	ids := make([]string, len(creds))
	for i, c := range creds {
		ids[i] = c.ID
	}
	return ids
}

func findCredential(creds []domain.Credential, id string) domain.Credential {
	for _, c := range creds {
		if c.ID == id {
			return c
		}
	}
	if len(creds) > 0 {
		return creds[0]
	}
	return domain.Credential{}
}

func classifyProviderError(err error) retry.Reason {
	switch {
	case herr.IsCode(err, domain.ErrProviderTimeout):
		return retry.ReasonTimeout
	case herr.IsCode(err, domain.ErrRateLimited):
		return retry.ReasonRateLimit
	case herr.IsCode(err, domain.ErrProviderError):
		return retry.ReasonRetryable5xx
	default:
		return retry.ReasonNonRetryable
	}
}

func countFallbacks(el *retry.EventLog) int {
	n := 0
	for _, e := range el.Events() {
		if e.Reason == retry.ReasonFallback {
			n++
		}
	}
	return n
}

func peekModel(body []byte) string {
	return gjson.GetBytes(body, "model").String()
}
