package providers

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bytedance/sonic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// speechWireRequest is the OpenAI /v1/audio/speech wire shape. Bifrost's
// SpeechRequest takes a structured input, so the gateway parses the JSON
// here (unlike /v1/messages, which raw-forwards).
type speechWireRequest struct {
	Model          string   `json:"model"`
	Input          string   `json:"input"`
	Voice          string   `json:"voice"`
	Instructions   string   `json:"instructions,omitempty"`
	ResponseFormat string   `json:"response_format,omitempty"`
	Speed          *float64 `json:"speed,omitempty"`
}

// audioContentTypes maps OpenAI response_format values to the MIME type the
// binary response is served under. Matches what api.openai.com itself emits.
var audioContentTypes = map[string]string{
	"mp3":  "audio/mpeg",
	"opus": "audio/ogg",
	"aac":  "audio/aac",
	"flac": "audio/flac",
	"wav":  "audio/wav",
	"pcm":  "audio/pcm",
}

func audioContentType(format string) string {
	if ct, ok := audioContentTypes[strings.ToLower(format)]; ok {
		return ct
	}
	// Default format is mp3, both on OpenAI and on Bifrost's speech path.
	return "audio/mpeg"
}

// speechResponseFormatFor maps the OpenAI wire response_format onto what the
// provider should actually be asked for. OpenAI's "pcm" means raw PCM16 @
// 24kHz, but Bifrost translates pcm to ElevenLabs pcm_44100, which is gated
// to the ElevenLabs Pro tier AND the wrong sample rate for the OpenAI
// contract; pcm_24000 is available on every tier and matches OpenAI's
// semantics. Bifrost passes formats outside its translation table through to
// output_format verbatim, so the rewrite lands on the ElevenLabs API as-is.
// The response Content-Type stays keyed on the wire format ("pcm" ->
// audio/pcm) regardless.
func speechResponseFormatFor(provider bfschemas.ModelProvider, wireFormat string) string {
	if provider == bfschemas.Elevenlabs && strings.EqualFold(wireFormat, "pcm") {
		return "pcm_24000"
	}
	return wireFormat
}

// dispatchSpeech routes /v1/audio/speech traffic through Bifrost's
// SpeechRequest endpoint (openai + elevenlabs providers). The inbound body is
// OpenAI-shape; ElevenLabs callers put their voice id in the same `voice`
// field. The success body is the raw audio bytes with the Content-Type
// attached here, so the HTTP writer forwards it without a JSON envelope.
func (r *BifrostRouter) dispatchSpeech(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (*domain.Response, error) {
	var wire speechWireRequest
	if err := sonic.Unmarshal(req.Body, &wire); err != nil {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": "invalid JSON body: " + err.Error()})
	}
	if wire.Input == "" {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": "missing required field: input"})
	}

	params := &bfschemas.SpeechParameters{
		Instructions:   wire.Instructions,
		ResponseFormat: speechResponseFormatFor(provider, wire.ResponseFormat),
		Speed:          wire.Speed,
	}
	if wire.Voice != "" {
		voice := wire.Voice
		params.VoiceConfig = &bfschemas.SpeechVoiceInput{Voice: &voice}
	}

	bfReq := &bfschemas.BifrostSpeechRequest{
		Provider: provider,
		Model:    model,
		Input:    &bfschemas.SpeechInput{Input: wire.Input},
		Params:   params,
	}
	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	resp, berr := r.bf.SpeechRequest(bfCtx, bfReq)
	if berr != nil {
		if answer, ok := r.responseFromBifrostError(berr, bfCtx); ok {
			return answer, nil
		}
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}

	return &domain.Response{
		Body:       resp.Audio,
		StatusCode: http.StatusOK,
		Headers:    map[string]string{"Content-Type": audioContentType(wire.ResponseFormat)},
		Usage:      extractSpeechUsage(resp),
	}, nil
}

// dispatchTranscription routes /v1/audio/transcriptions traffic through
// Bifrost's TranscriptionRequest endpoint (openai + elevenlabs providers).
// The router already parsed the multipart form into req.Transcription.
func (r *BifrostRouter) dispatchTranscription(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (*domain.Response, error) {
	upload := req.Transcription
	if upload == nil || len(upload.File) == 0 {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": "missing required field: file"})
	}

	params := &bfschemas.TranscriptionParameters{}
	if v := upload.Params["language"]; v != "" {
		params.Language = &v
	}
	if v := upload.Params["prompt"]; v != "" {
		params.Prompt = &v
	}
	if v := upload.Params["response_format"]; v != "" {
		params.ResponseFormat = &v
	}
	if v := upload.Params["temperature"]; v != "" {
		if temp, err := strconv.ParseFloat(v, 64); err == nil {
			params.Temperature = &temp
		}
	}

	bfReq := &bfschemas.BifrostTranscriptionRequest{
		Provider: provider,
		Model:    model,
		Input: &bfschemas.TranscriptionInput{
			File:     upload.File,
			Filename: upload.Filename,
		},
		Params: params,
	}
	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	resp, berr := r.bf.TranscriptionRequest(bfCtx, bfReq)
	if berr != nil {
		if answer, ok := r.responseFromBifrostError(berr, bfCtx); ok {
			return answer, nil
		}
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}

	body, _ := sonic.Marshal(resp)
	return &domain.Response{
		Body:       body,
		StatusCode: http.StatusOK,
		Usage:      extractTranscriptionUsage(resp),
	}, nil
}

// extractSpeechUsage maps Bifrost speech usage onto the domain measure. TTS
// providers that report token usage (gpt-4o-mini-tts) fill the token fields;
// InputChars is Bifrost's backfill from the request text, the measure
// character-priced providers (ElevenLabs, tts-1) bill by.
func extractSpeechUsage(resp *bfschemas.BifrostSpeechResponse) domain.Usage {
	if resp == nil || resp.Usage == nil {
		return domain.Usage{}
	}
	u := domain.Usage{
		PromptTokens:     resp.Usage.InputTokens,
		CompletionTokens: resp.Usage.OutputTokens,
		TotalTokens:      resp.Usage.TotalTokens,
		InputChars:       resp.Usage.InputChars,
	}
	var split domain.AudioTokenSplit
	if d := resp.Usage.InputTokenDetails; d != nil {
		split.InputAudio = d.AudioTokens
		split.InputText = d.TextTokens
	}
	return u.SplitAudioTokens(split)
}

// extractTranscriptionUsage maps Bifrost transcription usage onto the domain
// measure. gpt-4o-transcribe reports token usage ("tokens" type); whisper-1
// and ElevenLabs report duration ("duration" type), and the response-level
// Duration field is the fallback when usage is absent entirely.
func extractTranscriptionUsage(resp *bfschemas.BifrostTranscriptionResponse) domain.Usage {
	if resp == nil {
		return domain.Usage{}
	}
	u := domain.Usage{}
	if resp.Duration != nil {
		u.AudioSeconds = *resp.Duration
	}
	if resp.Usage == nil {
		return u
	}
	if resp.Usage.InputTokens != nil {
		u.PromptTokens = *resp.Usage.InputTokens
	}
	if resp.Usage.OutputTokens != nil {
		u.CompletionTokens = *resp.Usage.OutputTokens
	}
	if resp.Usage.TotalTokens != nil {
		u.TotalTokens = *resp.Usage.TotalTokens
	}
	if resp.Usage.Seconds != nil {
		u.AudioSeconds = float64(*resp.Usage.Seconds)
	}
	// The gpt-4o transcribe family states how much of the input was audio
	// ("input_token_details":{"text_tokens":0,"audio_tokens":65}). Taking the
	// audio out of the prompt total is what lets a caller see the measure the
	// model actually consumed, and prices it at the audio rate where the
	// provider charges one.
	if d := resp.Usage.InputTokenDetails; d != nil {
		u = u.SplitAudioTokens(domain.AudioTokenSplit{
			InputAudio: d.AudioTokens,
			InputText:  d.TextTokens,
		})
	}
	return u
}
