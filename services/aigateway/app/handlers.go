package app

import (
	"context"
	"io"
	"strconv"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type DispatchMeta = pipeline.Meta
type DispatchMetaAccumulator = pipeline.MetaAccumulator
type CompletionResult = pipeline.SyncResult
type StreamResult = pipeline.StreamResult
type EmbeddingResult = pipeline.SyncResult

// NewDispatchMetaContext seeds ctx with the accumulator this request's
// dispatch writes response metadata into. Transports that may have to commit
// the response header block before dispatch returns need it: without it they
// can only read the metadata once the dispatch is over, by which point the
// headers are already on the wire.
func NewDispatchMetaContext(ctx context.Context) context.Context {
	return pipeline.NewMetaContext(ctx)
}

// DispatchMetaFrom returns the accumulator seeded by NewDispatchMetaContext,
// or nil when the context was never seeded.
func DispatchMetaFrom(ctx context.Context) *DispatchMetaAccumulator {
	return pipeline.MetaFromContext(ctx)
}

func (a *App) HandleChat(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*CompletionResult, error) {
	return a.pipeline.Sync(ctx, bundle, &domain.Request{Type: domain.RequestTypeChat, Model: model, BodyReader: body})
}

func (a *App) HandleChatStream(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*StreamResult, error) {
	return a.pipeline.Stream(ctx, bundle, &domain.Request{Type: domain.RequestTypeChat, Model: model, BodyReader: body})
}

func (a *App) HandleMessages(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*CompletionResult, error) {
	return a.pipeline.Sync(ctx, bundle, &domain.Request{Type: domain.RequestTypeMessages, Model: model, BodyReader: body})
}

func (a *App) HandleMessagesStream(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*StreamResult, error) {
	return a.pipeline.Stream(ctx, bundle, &domain.Request{Type: domain.RequestTypeMessages, Model: model, BodyReader: body})
}

func (a *App) HandleResponses(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*CompletionResult, error) {
	return a.pipeline.Sync(ctx, bundle, &domain.Request{Type: domain.RequestTypeResponses, Model: model, BodyReader: body})
}

func (a *App) HandleResponsesStream(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*StreamResult, error) {
	return a.pipeline.Stream(ctx, bundle, &domain.Request{Type: domain.RequestTypeResponses, Model: model, BodyReader: body})
}

func (a *App) HandleEmbeddings(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*EmbeddingResult, error) {
	return a.pipeline.Sync(ctx, bundle, &domain.Request{Type: domain.RequestTypeEmbeddings, Model: model, BodyReader: body})
}

// HandleSpeech dispatches POST /v1/audio/speech (OpenAI-wire TTS). Same
// pipeline as every sync call; the response body is binary audio with the
// Content-Type attached by the dispatcher.
func (a *App) HandleSpeech(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*CompletionResult, error) {
	return a.pipeline.Sync(ctx, bundle, &domain.Request{Type: domain.RequestTypeSpeech, Model: model, BodyReader: body})
}

// HandleTranscription dispatches POST /v1/audio/transcriptions (OpenAI-wire
// multipart STT). The router already parsed the form; the upload rides on
// req.Transcription and Body carries a small synthesized JSON summary so
// body-reading pipeline stages see well-formed bytes instead of multipart
// framing.
func (a *App) HandleTranscription(ctx context.Context, bundle *domain.Bundle, upload *domain.TranscriptionUpload, model string) (*CompletionResult, error) {
	body := []byte(`{"model":` + strconv.Quote(model) + `}`)
	return a.pipeline.Sync(ctx, bundle, &domain.Request{
		Type:          domain.RequestTypeTranscription,
		Model:         model,
		Body:          body,
		Transcription: upload,
	})
}

// HandlePassthrough dispatches a provider-native request whose wire shape
// the gateway doesn't translate (e.g. Gemini /v1beta/models/{m}:generateContent).
// Body, path, method, query, and forwarded headers ride on req.Passthrough;
// the provider router's raw-forward dispatch hands them to Bifrost's
// Passthrough endpoint verbatim.
func (a *App) HandlePassthrough(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string, meta domain.PassthroughRequest) (*CompletionResult, error) {
	return a.pipeline.Sync(ctx, bundle, &domain.Request{
		Type:        domain.RequestTypePassthrough,
		Model:       model,
		BodyReader:  body,
		Passthrough: meta,
	})
}

// HandlePassthroughStream is the streaming sibling of HandlePassthrough.
// Upstream emits pre-framed SSE (Gemini streamGenerateContent); the
// iterator's RawFraming() returns true so the writer forwards chunks
// unchanged rather than re-wrapping them.
func (a *App) HandlePassthroughStream(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string, meta domain.PassthroughRequest) (*StreamResult, error) {
	return a.pipeline.Stream(ctx, bundle, &domain.Request{
		Type:        domain.RequestTypePassthrough,
		Model:       model,
		BodyReader:  body,
		Passthrough: meta,
	})
}

func PeekStream(body []byte) bool {
	return gjson.GetBytes(body, "stream").Bool()
}

func PeekModel(body []byte) string {
	return gjson.GetBytes(body, "model").String()
}
