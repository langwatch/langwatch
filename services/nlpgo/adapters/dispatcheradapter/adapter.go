// Package dispatcheradapter implements services/nlpgo/app.GatewayClient
// by calling the in-process AI Gateway dispatcher (services/aigateway/
// dispatcher) instead of making an HTTP call. This is the "library
// pivot" consumer: nlpgo no longer needs the HTTP gatewayclient or
// HMAC bridge to reach the gateway — it dispatches in-process.
//
// The adapter parses the inline-credentials header that llmexecutor
// already produces (via litellmparams.InlineCredentials.Encode) into a
// domain.Credential and hands it to the dispatcher. This keeps
// llmexecutor unchanged through the migration; once we're confident
// the adapter is the only path, we can flatten the encode/decode and
// have llmexecutor pass a Credential directly.
package dispatcheradapter

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/langwatch/langwatch/services/aigateway/dispatcher"
	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/litellmparams"
)

// Adapter implements app.GatewayClient.
type Adapter struct {
	disp *dispatcher.Dispatcher
}

// New builds an Adapter wrapping the given dispatcher.
func New(disp *dispatcher.Dispatcher) *Adapter {
	return &Adapter{disp: disp}
}

// Compile-time interface check.
var _ app.GatewayClient = (*Adapter)(nil)

// Inline-credentials header — the same name the HTTP gatewayclient used
// for compatibility. Once llmexecutor switches to passing Credential
// directly we can drop this and the parse step.
const headerInlineCredentials = "X-LangWatch-Inline-Credentials"

// ChatCompletions dispatches a chat-completion call in-process.
func (a *Adapter) ChatCompletions(ctx context.Context, req app.GatewayRequest) (*app.GatewayResponse, error) {
	return a.dispatch(ctx, req, domain.RequestTypeChat)
}

// ChatCompletionsStream dispatches a streaming chat-completion call.
func (a *Adapter) ChatCompletionsStream(ctx context.Context, req app.GatewayRequest) (app.StreamIterator, error) {
	return a.dispatchStream(ctx, req, domain.RequestTypeChat)
}

// Messages dispatches an Anthropic-shape /v1/messages call.
func (a *Adapter) Messages(ctx context.Context, req app.GatewayRequest) (*app.GatewayResponse, error) {
	return a.dispatch(ctx, req, domain.RequestTypeMessages)
}

// MessagesStream dispatches a streaming /v1/messages call.
func (a *Adapter) MessagesStream(ctx context.Context, req app.GatewayRequest) (app.StreamIterator, error) {
	return a.dispatchStream(ctx, req, domain.RequestTypeMessages)
}

// Responses dispatches an OpenAI Responses-API call.
func (a *Adapter) Responses(ctx context.Context, req app.GatewayRequest) (*app.GatewayResponse, error) {
	return a.dispatch(ctx, req, domain.RequestTypeResponses)
}

// ResponsesStream dispatches a streaming Responses-API call.
func (a *Adapter) ResponsesStream(ctx context.Context, req app.GatewayRequest) (app.StreamIterator, error) {
	return a.dispatchStream(ctx, req, domain.RequestTypeResponses)
}

// Embeddings dispatches an embeddings call.
func (a *Adapter) Embeddings(ctx context.Context, req app.GatewayRequest) (*app.GatewayResponse, error) {
	return a.dispatch(ctx, req, domain.RequestTypeEmbeddings)
}

func (a *Adapter) dispatch(ctx context.Context, req app.GatewayRequest, typ domain.RequestType) (*app.GatewayResponse, error) {
	cred, err := credentialFromHeaders(req.Headers)
	if err != nil {
		return nil, err
	}
	bare := bareModel(req.Model)
	cred = domain.WithDeploymentSelfMap(cred, bare)
	resp, err := a.disp.Dispatch(ctx, dispatcher.Request{
		Type:       typ,
		Model:      bare,
		Body:       req.Body,
		Credential: cred,
	})
	if err != nil {
		return nil, err
	}
	return &app.GatewayResponse{
		StatusCode: resp.StatusCode,
		Body:       resp.Body,
		Headers:    resp.Headers,
	}, nil
}

func (a *Adapter) dispatchStream(ctx context.Context, req app.GatewayRequest, typ domain.RequestType) (app.StreamIterator, error) {
	cred, err := credentialFromHeaders(req.Headers)
	if err != nil {
		return nil, err
	}
	bare := bareModel(req.Model)
	cred = domain.WithDeploymentSelfMap(cred, bare)
	iter, err := a.disp.DispatchStream(ctx, dispatcher.Request{
		Type:       typ,
		Model:      bare,
		Body:       req.Body,
		Credential: cred,
	})
	if err != nil {
		return nil, err
	}
	return &streamIteratorAdapter{inner: iter}, nil
}

// streamIteratorAdapter bridges domain.StreamIterator → app.StreamIterator.
// Both interfaces have the same shape (Next/Chunk/Err/Close) so it's a
// pure pass-through.
type streamIteratorAdapter struct {
	inner domain.StreamIterator
}

func (s *streamIteratorAdapter) Next(ctx context.Context) bool { return s.inner.Next(ctx) }
func (s *streamIteratorAdapter) Chunk() []byte                 { return s.inner.Chunk() }
func (s *streamIteratorAdapter) Err() error                    { return s.inner.Err() }
func (s *streamIteratorAdapter) Close() error                  { return s.inner.Close() }

// credentialFromHeaders reads the inline-credentials header that
// llmexecutor sets, base64-decodes it, and builds a domain.Credential
// the dispatcher can use.
func credentialFromHeaders(headers map[string]string) (domain.Credential, error) {
	raw := headers[headerInlineCredentials]
	if raw == "" {
		return domain.Credential{}, errors.New("dispatcheradapter: missing inline-credentials header")
	}
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return domain.Credential{}, fmt.Errorf("dispatcheradapter: decode inline-credentials: %w", err)
	}
	var ic litellmparams.InlineCredentials
	if err := json.Unmarshal(decoded, &ic); err != nil {
		return domain.Credential{}, fmt.Errorf("dispatcheradapter: unmarshal inline-credentials: %w", err)
	}
	return ic.Credential()
}

// bareModel strips the langwatch-internal provider prefix
// ("openai/", "anthropic/", "gemini/", …) from a model id before
// passing it to Bifrost. The provider is already routed via
// Credential.ProviderID; downstream provider APIs reject the prefixed
// form (Anthropic returns 404, OpenAI 400). When no slash is present
// the input is returned verbatim.
func bareModel(modelID string) string {
	if i := indexByte(modelID, '/'); i >= 0 {
		return modelID[i+1:]
	}
	return modelID
}

// indexByte avoids pulling in strings just for ByteIndex; tiny adapter
// scope.
func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}
