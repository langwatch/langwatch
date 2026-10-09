package app

import (
	"context"
	"io"

	"github.com/bytedance/sonic"
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
	return a.pipeline.Sync(ctx, bundle, &domain.Request{
		Type:          domain.RequestTypeTranscription,
		Model:         model,
		Body:          modelOnlyBody("model", model),
		Transcription: upload,
	})
}

// HandleImageGeneration dispatches POST /v1/images/generations (OpenAI-wire
// image generation). Same pipeline as every sync call; the response body is
// the OpenAI images JSON, whose data[] entries carry the base64 images.
//
//nolint:revive // argument-limit: the same four values HandleSpeech beside it takes.
func (a *App) HandleImageGeneration(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*CompletionResult, error) {
	return a.pipeline.Sync(ctx, bundle, &domain.Request{Type: domain.RequestTypeImageGeneration, Model: model, BodyReader: body})
}

// HandleImageEdit dispatches POST /v1/images/edits (OpenAI-wire multipart
// image edit). The router already parsed the form; the upload rides on
// req.ImageEdit and Body carries a synthesized JSON summary so the
// body-reading pipeline stages see well-formed bytes instead of multipart
// framing. The prompt is in that summary because guardrails judge it, and the
// end user because spend attribution reads it.
//
//nolint:revive // argument-limit: the same four values HandleTranscription beside it takes.
func (a *App) HandleImageEdit(ctx context.Context, bundle *domain.Bundle, upload *domain.ImageEditUpload, model string) (*CompletionResult, error) {
	return a.pipeline.Sync(ctx, bundle, &domain.Request{
		Type:      domain.RequestTypeImageEdit,
		Model:     model,
		Body:      imageEditBody(model, upload.Params["prompt"], upload.Params["user"]),
		ImageEdit: upload,
	})
}

// HandleElevenLabsSpeech dispatches POST /v1/text-to-speech/{voice_id},
// ElevenLabs' own synthesis path. Same request type, pipeline and metering as
// the OpenAI-wire TTS route: only the wire differs, and the vendor reads that
// wire directly. The response body is binary audio.
func (a *App) HandleElevenLabsSpeech(ctx context.Context, bundle *domain.Bundle, in ElevenLabsAudioDispatch) (*CompletionResult, error) {
	route := in.Route
	return a.pipeline.Sync(ctx, bundle, &domain.Request{
		Type:       domain.RequestTypeSpeech,
		Model:      in.Model,
		Body:       in.Body,
		ElevenLabs: &route,
		Surface:    domain.ElevenLabsSpeechSurface(),
	})
}

// HandleElevenLabsTranscription dispatches POST /v1/speech-to-text,
// ElevenLabs' own transcription path. The router parsed the multipart form,
// so the upload rides on req.Transcription and Body carries the synthesized
// JSON summary the body-reading pipeline stages need, exactly as the
// OpenAI-wire transcription route does.
func (a *App) HandleElevenLabsTranscription(ctx context.Context, bundle *domain.Bundle, in ElevenLabsAudioDispatch) (*CompletionResult, error) {
	route := in.Route
	return a.pipeline.Sync(ctx, bundle, &domain.Request{
		Type:          domain.RequestTypeTranscription,
		Model:         in.Model,
		Body:          modelOnlyBody(domain.ElevenLabsModelField, in.Model),
		Transcription: in.Upload,
		ElevenLabs:    &route,
		Surface:       domain.ElevenLabsTranscriptionSurface(),
	})
}

// modelOnlyBody is the synthesized JSON a multipart route hands the pipeline,
// so the body-reading stages see a well-formed object instead of multipart
// framing.
//
// Marshaled rather than concatenated, the same rule the realtime mint states:
// the model is a caller-supplied form part, and strconv.Quote emits Go escapes
// such as \x01 for a control byte, which is not JSON. Every stage downstream
// parses this body, including the sjson rewrite that puts the resolved model
// back into it, so one control byte would break resolution rather than the
// request that carried it. A marshal failure cannot happen for a map of two
// strings; an empty object is still valid JSON and the resolver refuses the
// missing model with its own message.
func modelOnlyBody(field, model string) []byte {
	body, err := sonic.Marshal(map[string]string{field: model})
	if err != nil {
		return []byte(`{}`)
	}
	return body
}

// imageEditBody is the synthesized JSON the multipart image edit route hands
// the pipeline. It carries the model, the prompt every guardrail judges, and
// the end user spend attribution reads. The image bytes stay off it: they are
// megabytes of binary that no pipeline stage reads from the body.
//
// Marshaled rather than concatenated, for the reason modelOnlyBody states.
func imageEditBody(model, prompt, user string) []byte {
	fields := map[string]string{"model": model, "prompt": prompt}
	if user != "" {
		fields["user"] = user
	}
	body, err := sonic.Marshal(fields)
	if err != nil {
		return []byte(`{}`)
	}
	return body
}

// ElevenLabsAudioDispatch is one ElevenLabs-native audio call: the model it
// bills under, the vendor-shaped body or upload, and the URL-level parameters
// the vendor's own path carries.
type ElevenLabsAudioDispatch struct {
	Model  string
	Body   []byte
	Upload *domain.TranscriptionUpload
	Route  domain.ElevenLabsAudioRequest
}

// HandlePassthrough dispatches a provider-native request whose wire shape
// the gateway doesn't translate (e.g. Gemini /v1beta/models/{m}:generateContent).
// Body, path, method, query, and forwarded headers ride on req.Passthrough;
// the provider router's raw-forward dispatch hands them to Bifrost's
// Passthrough endpoint verbatim.
func (a *App) HandlePassthrough(ctx context.Context, bundle *domain.Bundle, in PassthroughDispatch) (*CompletionResult, error) {
	return a.pipeline.Sync(ctx, bundle, in.request())
}

// HandlePassthroughStream is the streaming sibling of HandlePassthrough.
// Upstream emits pre-framed SSE (Gemini streamGenerateContent); the
// iterator's RawFraming() returns true so the writer forwards chunks
// unchanged rather than re-wrapping them.
func (a *App) HandlePassthroughStream(ctx context.Context, bundle *domain.Bundle, in PassthroughDispatch) (*StreamResult, error) {
	return a.pipeline.Stream(ctx, bundle, in.request())
}

// PassthroughDispatch is one raw-forward request: the body, the model the
// route named, the HTTP context the vendor call is rebuilt from, and the
// providers that route may reach.
type PassthroughDispatch struct {
	Body    io.Reader
	Model   string
	Meta    domain.PassthroughRequest
	Surface domain.Surface
}

func (in PassthroughDispatch) request() *domain.Request {
	return &domain.Request{
		Type:        domain.RequestTypePassthrough,
		Model:       in.Model,
		BodyReader:  in.Body,
		Passthrough: in.Meta,
		Surface:     in.Surface,
	}
}

// HandleRealtimeSession dispatches a realtime voice session mint (ADR-097).
// The gateway checks the budget, mints the vendor's own short-lived session
// credential and hands it back; the media socket runs client to vendor and
// never touches this process.
//
// Both mint routes come through here. The OpenAI one forwards the caller's
// session body with the resolved model written back into it; the ElevenLabs
// one carries a synthesized body, the same way HandleTranscription does, so
// the body-reading stages of the pipeline see well-formed JSON instead of a
// bare query string.
func (a *App) HandleRealtimeSession(ctx context.Context, bundle *domain.Bundle, in RealtimeMintDispatch) (*CompletionResult, error) {
	session := in.Session
	return a.pipeline.Sync(ctx, bundle, &domain.Request{
		Type:            domain.RequestTypeRealtimeSession,
		Model:           in.Model,
		Body:            in.Body,
		RealtimeSession: &session,
		Surface:         in.Surface,
	})
}

// RealtimeMintDispatch is one session mint: the body the vendor receives,
// the model it bills under, which family to mint for, and the providers the
// route may reach.
type RealtimeMintDispatch struct {
	Body    []byte
	Model   string
	Session domain.RealtimeSessionRequest
	Surface domain.Surface
}

// RealtimeUsagePost is a usage report a client read off its own socket.
type RealtimeUsagePost struct {
	SessionID string
	Body      []byte
}

func PeekStream(body []byte) bool {
	return gjson.GetBytes(body, "stream").Bool()
}

func PeekModel(body []byte) string {
	return gjson.GetBytes(body, "model").String()
}
