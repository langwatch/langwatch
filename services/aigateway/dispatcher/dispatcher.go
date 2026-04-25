// Package dispatcher exposes the AI gateway's provider routing as an
// in-process Go API. Internal services (today: services/nlpgo) can
// import this package and dispatch chat/messages/responses/embeddings
// calls without going through the gateway's HTTP layer — bringing
// their own credentials per-request.
//
// The HTTP layer of services/aigateway stays unchanged; this is an
// additional, narrower entry point. By design it skips:
//
//   - Virtual-key auth (caller supplies a credential directly)
//   - Rate limiting (caller's traffic is internal, not customer)
//   - Budget tracking (no virtual key to debit)
//   - Cache rules (uncached path; caller can wrap if needed)
//   - Guardrails (caller decides whether to evaluate)
//
// What it does NOT skip:
//
//   - Provider routing through Bifrost (real provider HTTP calls)
//   - Per-provider error classification + retry
//   - Streaming pass-through with raw-byte preservation
//
// See specs/nlp-go/_shared/contract.md §8 for the migration rationale.
package dispatcher

import (
	"context"
	"errors"
	"io"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/adapters/providers"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Dispatcher is the in-process entry point that wraps the Bifrost
// provider router. Construct once at process start; safe for
// concurrent use across goroutines.
type Dispatcher struct {
	providers *providers.BifrostRouter
}

// Options configures a Dispatcher.
type Options struct {
	// Logger receives provider-routing telemetry. Optional; defaults to noop.
	Logger *zap.Logger
}

// New constructs a Dispatcher backed by Bifrost. Returns an error if
// Bifrost initialization fails.
func New(ctx context.Context, opts Options) (*Dispatcher, error) {
	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}
	router, err := providers.NewBifrostRouter(ctx, providers.BifrostOptions{
		Logger: opts.Logger,
	})
	if err != nil {
		return nil, err
	}
	return &Dispatcher{providers: router}, nil
}

// Request is the per-call shape. Body is the raw OpenAI-compat (or
// Anthropic /v1/messages, or Responses, etc.) request payload as the
// provider expects to see it. Model is the bare provider model id
// (e.g. "gpt-5-mini" — without the "openai/" prefix; the prefix
// belongs in Credential.ProviderID). Credential carries the customer's
// per-request keys + provider-specific extras (Azure resource_name,
// Bedrock region, Vertex SA JSON, etc.).
type Request struct {
	Type       domain.RequestType
	Model      string
	Body       []byte
	Credential domain.Credential
}

// Dispatch sends a non-streaming request through the provider router.
// Suitable for chat completions, messages, responses, embeddings.
func (d *Dispatcher) Dispatch(ctx context.Context, req Request) (*domain.Response, error) {
	if err := validate(req); err != nil {
		return nil, err
	}
	dr := domainRequest(req, nil)
	return d.providers.Dispatch(ctx, dr, req.Credential)
}

// DispatchStream opens a streaming request. The returned StreamIterator
// is the same shape the gateway HTTP layer uses — chunks arrive verbatim
// from upstream when possible.
func (d *Dispatcher) DispatchStream(ctx context.Context, req Request) (domain.StreamIterator, error) {
	if err := validate(req); err != nil {
		return nil, err
	}
	dr := domainRequest(req, nil)
	return d.providers.DispatchStream(ctx, dr, req.Credential)
}

// PassthroughRequest carries the additional HTTP-shape fields that
// raw-forward endpoints need. Use Passthrough / PassthroughStream when
// the body should be sent to a provider-native path verbatim
// (e.g. Gemini /v1beta/models/{m}:generateContent).
type PassthroughRequest struct {
	Request
	HTTP domain.PassthroughRequest
}

// Passthrough is the non-streaming raw-forward variant.
func (d *Dispatcher) Passthrough(ctx context.Context, req PassthroughRequest) (*domain.Response, error) {
	if err := validate(req.Request); err != nil {
		return nil, err
	}
	req.Request.Type = domain.RequestTypePassthrough
	dr := domainRequest(req.Request, &req.HTTP)
	return d.providers.Dispatch(ctx, dr, req.Credential)
}

// PassthroughStream is the streaming raw-forward variant.
func (d *Dispatcher) PassthroughStream(ctx context.Context, req PassthroughRequest) (domain.StreamIterator, error) {
	if err := validate(req.Request); err != nil {
		return nil, err
	}
	req.Request.Type = domain.RequestTypePassthrough
	dr := domainRequest(req.Request, &req.HTTP)
	return d.providers.DispatchStream(ctx, dr, req.Credential)
}

func validate(req Request) error {
	if req.Type == "" {
		return errors.New("dispatcher: Request.Type is required")
	}
	if req.Credential.ProviderID == "" {
		return errors.New("dispatcher: Request.Credential.ProviderID is required")
	}
	if len(req.Body) == 0 {
		return errors.New("dispatcher: Request.Body is required")
	}
	return nil
}

// domainRequest builds the gateway's internal Request shape. Resolved
// is left nil — the caller already knows the provider; we don't need
// model resolution.
func domainRequest(req Request, passthrough *domain.PassthroughRequest) *domain.Request {
	dr := &domain.Request{
		Type:       req.Type,
		Model:      req.Model,
		Body:       req.Body,
		BodyReader: bytesReader(req.Body),
	}
	if passthrough != nil {
		dr.Passthrough = *passthrough
	}
	return dr
}

// bytesReader returns an io.Reader over a byte slice without pulling
// in bytes.NewReader from the bytes package — keeps the dispatcher
// import surface narrow.
func bytesReader(b []byte) io.Reader {
	return &readerOnce{b: b}
}

type readerOnce struct {
	b   []byte
	pos int
}

func (r *readerOnce) Read(p []byte) (int, error) {
	if r.pos >= len(r.b) {
		return 0, io.EOF
	}
	n := copy(p, r.b[r.pos:])
	r.pos += n
	return n, nil
}
