// Package dispatcheradapter implements services/nlpgo/app.GatewayClient
// by calling the in-process AI Gateway dispatcher (services/aigateway/
// dispatcher) instead of making an HTTP call. This is the "library
// pivot" consumer: nlpgo no longer needs the HTTP gatewayclient or
// HMAC bridge to reach the gateway — it dispatches in-process.
//
// The adapter parses the inline-credentials header that llmexecutor
// already produces (via litellm.InlineCredentials.Encode) into a
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
	resp, err := a.disp.Dispatch(ctx, dispatcher.Request{
		Type:       typ,
		Model:      bareModel(req.Model),
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
	iter, err := a.disp.DispatchStream(ctx, dispatcher.Request{
		Type:       typ,
		Model:      bareModel(req.Model),
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

// inlineCreds mirrors litellm.InlineCredentials. We don't import that
// type to avoid coupling adapter wire format to its package; a small
// duplicate struct here is the right cost.
type inlineCreds struct {
	Provider  string            `json:"provider"`
	OpenAI    map[string]string `json:"openai,omitempty"`
	Anthropic map[string]string `json:"anthropic,omitempty"`
	Azure     map[string]any    `json:"azure,omitempty"`
	Bedrock   map[string]string `json:"bedrock,omitempty"`
	VertexAI  map[string]string `json:"vertex_ai,omitempty"`
	Gemini    map[string]string `json:"gemini,omitempty"`
	Custom    map[string]string `json:"custom,omitempty"`
}

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
	var ic inlineCreds
	if err := json.Unmarshal(decoded, &ic); err != nil {
		return domain.Credential{}, fmt.Errorf("dispatcheradapter: unmarshal inline-credentials: %w", err)
	}
	return toDomainCredential(ic)
}

// toDomainCredential maps the inline-creds JSON shape into a single
// domain.Credential the BifrostRouter understands. The "active" provider
// slot is read; everything else is ignored.
func toDomainCredential(ic inlineCreds) (domain.Credential, error) {
	switch ic.Provider {
	case "openai":
		return openAICred(ic.OpenAI), nil
	case "anthropic":
		return anthropicCred(ic.Anthropic), nil
	case "azure":
		return azureCred(ic.Azure), nil
	case "bedrock":
		return bedrockCred(ic.Bedrock), nil
	case "vertex_ai", "vertex":
		return vertexCred(ic.VertexAI), nil
	case "gemini":
		return geminiCred(ic.Gemini), nil
	case "custom":
		// Custom routes through Bifrost's openai-compat adapter — same
		// credential layout as OpenAI but a different ProviderID so the
		// gateway-side custom-→-openai mapping logic stays applicable.
		return openAICred(ic.Custom), nil
	case "":
		return domain.Credential{}, errors.New("dispatcheradapter: provider is required in inline credentials")
	default:
		return domain.Credential{}, fmt.Errorf("dispatcheradapter: unsupported provider %q", ic.Provider)
	}
}

// inlineCredentialID is the synthetic credential id we put on every
// Credential we build from inline credentials. Bifrost's account
// resolver requires a non-empty id (see services/aigateway/adapters/
// providers/bifrost.go:486). nlpgo only ever sends one credential per
// call so a constant suffices; aigateway's HTTP layer assigns real
// ULIDs because it picks among many configured credentials per VK.
func inlineCredentialID(provider domain.ProviderID) string {
	return "nlpgo-inline-" + string(provider)
}

func openAICred(m map[string]string) domain.Credential {
	return domain.Credential{
		ID:         inlineCredentialID(domain.ProviderOpenAI),
		ProviderID: domain.ProviderOpenAI,
		APIKey:     m["api_key"],
		Extra:      stringExtras(m, "api_key"),
	}
}

func anthropicCred(m map[string]string) domain.Credential {
	return domain.Credential{
		ID:         inlineCredentialID(domain.ProviderAnthropic),
		ProviderID: domain.ProviderAnthropic,
		APIKey:     m["api_key"],
		Extra:      stringExtras(m, "api_key"),
	}
}

func azureCred(m map[string]any) domain.Credential {
	apiKey, _ := m["api_key"].(string)
	extra := make(map[string]string, len(m))
	for k, v := range m {
		if k == "api_key" {
			continue
		}
		switch x := v.(type) {
		case string:
			extra[k] = x
		case map[string]any, []any:
			b, err := json.Marshal(x)
			if err == nil {
				extra[k] = string(b)
			}
		case bool:
			if x {
				extra[k] = "true"
			} else {
				extra[k] = "false"
			}
		default:
			extra[k] = fmt.Sprintf("%v", x)
		}
	}
	return domain.Credential{
		ID:         inlineCredentialID(domain.ProviderAzure),
		ProviderID: domain.ProviderAzure,
		APIKey:     apiKey,
		Extra:      extra,
	}
}

func bedrockCred(m map[string]string) domain.Credential {
	return domain.Credential{
		ID:         inlineCredentialID(domain.ProviderBedrock),
		ProviderID: domain.ProviderBedrock,
		APIKey:     m["aws_access_key_id"],
		Extra:      stringExtras(m, "aws_access_key_id"),
	}
}

func vertexCred(m map[string]string) domain.Credential {
	return domain.Credential{
		ID:         inlineCredentialID(domain.ProviderVertex),
		ProviderID: domain.ProviderVertex,
		APIKey:     m["vertex_credentials"],
		Extra:      stringExtras(m, "vertex_credentials"),
	}
}

func geminiCred(m map[string]string) domain.Credential {
	return domain.Credential{
		ID:         inlineCredentialID(domain.ProviderGemini),
		ProviderID: domain.ProviderGemini,
		APIKey:     m["api_key"],
		Extra:      stringExtras(m, "api_key"),
	}
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

// stringExtras copies a string-map dropping the named keys. Used to
// place provider-specific non-key fields (api_base, api_version, etc.)
// into Credential.Extra without dragging the API key in twice.
func stringExtras(m map[string]string, drop ...string) map[string]string {
	if len(m) == 0 {
		return nil
	}
	out := make(map[string]string, len(m))
	skip := make(map[string]struct{}, len(drop))
	for _, d := range drop {
		skip[d] = struct{}{}
	}
	for k, v := range m {
		if _, found := skip[k]; found {
			continue
		}
		if v == "" {
			continue
		}
		out[k] = v
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
