package providers

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/bytedance/sonic"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The OpenAI-wire audio routes, dialed directly so the provider's body can be
// relayed as it arrives. Bifrost's speech and transcription calls return one
// complete response, so they stay only for the providers this file cannot
// reach itself.

const (
	openAIAudioDefaultBaseURL = "https://api.openai.com"

	// azureAudioAPIVersion is sent on Azure's deployment-scoped transcription
	// path when the credential names no version of its own.
	azureAudioAPIVersion = "2025-04-01-preview"

	// transcriptionMaxResponseBytes caps a transcript that arrives as one
	// body. A 25 MB upload transcribes to far less.
	transcriptionMaxResponseBytes = 32 << 20
)

// audioEndpoint is where one direct audio call goes and how it authenticates.
type audioEndpoint struct {
	url        string
	authHeader string
	authValue  string
}

// audioCall is one audio request on its way to a provider: the request, the
// model the virtual key resolved, and the credential that serves it.
type audioCall struct {
	req   *domain.Request
	model string
	cred  domain.Credential
}

// directAudioEndpoint resolves the provider URL for an OpenAI-wire audio
// call, for the two credentials that speak that wire natively: OpenAI on its
// own host, and Azure OpenAI with an API key. Anything else reports false.
func (r *BifrostRouter) directAudioEndpoint(call audioCall, resource string) (audioEndpoint, bool) {
	switch call.cred.ProviderID {
	case domain.ProviderOpenAI:
		return r.openAIAudioEndpoint(call.cred, resource)
	case domain.ProviderAzure:
		return azureAudioEndpoint(call, resource)
	default:
		return audioEndpoint{}, false
	}
}

// openAIAudioEndpoint serves an OpenAI credential on OpenAI's own host. One
// that names another base URL is a proxy, which stays on the Bifrost path.
func (r *BifrostRouter) openAIAudioEndpoint(cred domain.Credential, resource string) (audioEndpoint, bool) {
	if credBaseURL(cred) != "" || cred.APIKey == "" {
		return audioEndpoint{}, false
	}
	base := r.openAIBaseURL
	if base == "" {
		base = openAIAudioDefaultBaseURL
	}
	return audioEndpoint{
		url:        strings.TrimRight(base, "/") + "/v1/audio/" + resource,
		authHeader: "Authorization",
		authValue:  "Bearer " + cred.APIKey,
	}, true
}

// azureAudioEndpoint serves an Azure OpenAI credential that holds an API key.
// Speech is on the v1 path; transcription is scoped to a deployment.
func azureAudioEndpoint(call audioCall, resource string) (audioEndpoint, bool) {
	cred := call.cred
	endpoint := strings.TrimRight(credExtra(cred, "endpoint", "api_base"), "/")
	if endpoint == "" || cred.APIKey == "" {
		return audioEndpoint{}, false
	}
	target := endpoint + "/openai/v1/audio/" + resource
	if resource == "transcriptions" {
		deployment := call.model
		if mapped := cred.DeploymentMap[call.model]; mapped != "" {
			deployment = mapped
		}
		version := credExtra(cred, "api_version")
		if version == "" {
			version = azureAudioAPIVersion
		}
		target = endpoint + "/openai/deployments/" + url.PathEscape(deployment) +
			"/audio/transcriptions?api-version=" + url.QueryEscape(version)
	}
	return audioEndpoint{url: target, authHeader: "api-key", authValue: cred.APIKey}, true
}

// elevenLabsSpeechEndpoint is ElevenLabs' synthesis path for a voice, with
// the vendor's own key header. voicePath is the escaped voice id plus any
// streaming suffix.
func elevenLabsSpeechEndpoint(cred domain.Credential, voicePath, rawQuery string) audioEndpoint {
	return audioEndpoint{
		url:        elevenLabsAudioEndpoint(cred, elevenLabsTextToSpeechPath+voicePath, rawQuery),
		authHeader: "xi-api-key",
		authValue:  cred.APIKey,
	}
}

// audioClient is the HTTP client the direct audio lanes share.
func (r *BifrostRouter) audioClient() *http.Client {
	if r.elevenLabsClient != nil {
		return r.elevenLabsClient
	}
	return fallbackElevenLabsAudioClient(r.endpointPolicy)
}

// postAudio sends one body to a provider's audio endpoint and returns the
// response once its head has arrived.
func (r *BifrostRouter) postAudio(ctx context.Context, endpoint audioEndpoint, body audioBody) (*http.Response, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.url, bytes.NewReader(body.bytes))
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{"reason": err.Error()})
	}
	httpReq.Header.Set("Content-Type", body.contentType)
	httpReq.Header.Set(endpoint.authHeader, endpoint.authValue)
	return openAudioStream(ctx, r.audioClient(), httpReq)
}

// audioBody is a request body and the content type it is sent under.
type audioBody struct {
	bytes       []byte
	contentType string
}

func (r *BifrostRouter) postAudioJSON(ctx context.Context, endpoint audioEndpoint, body []byte) (*http.Response, error) {
	return r.postAudio(ctx, endpoint, audioBody{bytes: body, contentType: "application/json"})
}

// speechInput returns the text a speech request asks to be spoken.
func speechInput(ctx context.Context, body []byte) (string, error) {
	if !gjson.ValidBytes(body) {
		return "", herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": "invalid JSON body"})
	}
	input := gjson.GetBytes(body, "input").String()
	if input == "" {
		return "", herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": "missing required field: input"})
	}
	return input, nil
}

// dispatchSpeechStream serves POST /v1/audio/speech as a stream. OpenAI and
// Azure OpenAI are dialed directly and relayed; ElevenLabs goes through its
// own streaming path; every other provider answers through Bifrost in one
// chunk.
func (r *BifrostRouter) dispatchSpeechStream(ctx context.Context, call audioCall) (domain.StreamIterator, error) {
	input, err := speechInput(ctx, call.req.Body)
	if err != nil {
		return nil, err
	}
	sse := gjson.GetBytes(call.req.Body, "stream_format").String() == "sse"
	endpoint, direct := r.directAudioEndpoint(call, "speech")
	switch {
	case sse && !direct:
		return nil, unsupportedStreamFormat(ctx, string(call.cred.ProviderID))
	case call.cred.ProviderID == domain.ProviderElevenLabs:
		return r.dispatchElevenLabsWireSpeech(ctx, call)
	case !direct:
		return r.bufferedSpeech(ctx, call.req, call.cred)
	}

	//nolint:bodyclose // the returned stream owns the body and closes it
	resp, err := r.postAudioJSON(ctx, endpoint, call.req.Body)
	if err != nil {
		return nil, err
	}
	// Characters are charged from here on: the provider accepted the text.
	// Tokens join them when the stream ends with its usage event.
	meter := &audioMeter{cut: domain.Usage{InputChars: utf8.RuneCountInString(input)}}
	if isEventStream(resp.Header) {
		meter.finalEvent, meter.final = speechDoneEvent, speechDoneUsage
	}
	return newAudioStream(resp, forwardedAudioHeaders(resp.Header), meter), nil
}

func unsupportedStreamFormat(ctx context.Context, provider string) error {
	return herr.New(ctx, domain.ErrUnsupportedParameter, herr.M{
		"message": `stream_format "sse" is served on OpenAI and Azure OpenAI credentials only, and this request ` +
			"resolved to " + provider + `. Send stream_format "audio", or omit it, to receive the audio bytes`,
		"fault": "customer",
	})
}

// bufferedSpeech answers through the non-streaming dispatch, which returns
// the whole audio at once, and presents it as a one-chunk stream.
func (r *BifrostRouter) bufferedSpeech(
	ctx context.Context,
	req *domain.Request,
	cred domain.Credential,
) (domain.StreamIterator, error) {
	resp, err := r.Dispatch(ctx, req, cred)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, &domain.UpstreamError{
			StatusCode: resp.StatusCode,
			Body:       resp.Body,
			Message:    upstreamAudioErrorMessage(resp.Body, resp.StatusCode),
			ErrorType:  gjson.GetBytes(resp.Body, "error.type").String(),
			ErrorCode:  gjson.GetBytes(resp.Body, "error.code").String(),
			Headers:    resp.Headers,
		}
	}
	if resp.Usage.InputChars == 0 {
		resp.Usage.InputChars = utf8.RuneCountInString(gjson.GetBytes(req.Body, "input").String())
	}
	return domain.BufferedStream(resp), nil
}

// elevenLabsOutputFormats maps the OpenAI response_format onto ElevenLabs'
// output_format. pcm is 24 kHz, which is what the OpenAI wire means by it and
// what every ElevenLabs tier may request.
var elevenLabsOutputFormats = map[string]string{
	"":     "mp3_44100_128",
	"mp3":  "mp3_44100_128",
	"opus": "opus_48000_128",
	"wav":  "pcm_44100",
	"pcm":  "pcm_24000",
}

// dispatchElevenLabsWireSpeech serves an OpenAI-shaped speech request with an
// ElevenLabs credential, through the vendor's streaming path. The voice field
// carries the ElevenLabs voice id.
func (r *BifrostRouter) dispatchElevenLabsWireSpeech(ctx context.Context, call audioCall) (domain.StreamIterator, error) {
	body := call.req.Body
	voice := gjson.GetBytes(body, "voice")
	voiceID := voice.String()
	if voice.IsObject() {
		voiceID = voice.Get("id").String()
	}
	if voiceID == "" {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{
			"message": "voice is required: on an ElevenLabs model it carries the ElevenLabs voice id",
			"fault":   "customer",
		})
	}
	input := gjson.GetBytes(body, "input").String()
	wireFormat := strings.ToLower(gjson.GetBytes(body, "response_format").String())
	outputFormat, known := elevenLabsOutputFormats[wireFormat]
	if !known {
		outputFormat = wireFormat
	}

	vendorBody := map[string]any{"text": input, "model_id": call.model}
	if speed := gjson.GetBytes(body, "speed"); speed.Exists() {
		vendorBody["voice_settings"] = map[string]any{"speed": speed.Float()}
	}
	payload, err := sonic.Marshal(vendorBody)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrInternal, herr.M{"fault": "gateway"}, err)
	}

	//nolint:bodyclose // the returned stream owns the body and closes it
	resp, err := r.postAudioJSON(ctx, elevenLabsSpeechEndpoint(call.cred,
		url.PathEscape(voiceID)+string(domain.ElevenLabsSpeechStream),
		"output_format="+url.QueryEscape(outputFormat)), payload)
	if err != nil {
		return nil, err
	}
	headers := forwardedAudioHeaders(resp.Header)
	// The answer is labeled by the format the caller asked for on this wire.
	headers["Content-Type"] = audioContentType(wireFormat)
	iter := newAudioStream(resp, headers, &audioMeter{
		cut: domain.Usage{InputChars: utf8.RuneCountInString(input)},
	})
	iter.limit = elevenLabsAudioMaxResponseBytes
	return iter, nil
}

// openAITranscriptionForm rebuilds the multipart body for the provider: the
// model the virtual key resolved, every text part the caller sent, in the
// caller's order and under the caller's names, then the audio.
func openAITranscriptionForm(upload *domain.TranscriptionUpload, model string) (audioBody, error) {
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	fields := append([]domain.FormField{{Name: "model", Value: model}}, upload.Fields...)
	for _, field := range fields {
		if err := w.WriteField(field.Name, field.Value); err != nil {
			return audioBody{}, err
		}
	}
	filename := upload.Filename
	if filename == "" {
		filename = "audio"
	}
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		return audioBody{}, err
	}
	if _, err := part.Write(upload.File); err != nil {
		return audioBody{}, err
	}
	if err := w.Close(); err != nil {
		return audioBody{}, err
	}
	return audioBody{bytes: buf.Bytes(), contentType: w.FormDataContentType()}, nil
}

// openDirectTranscription posts the rebuilt form to the provider and returns
// the response once its head has arrived.
func (r *BifrostRouter) openDirectTranscription(
	ctx context.Context,
	call audioCall,
	endpoint audioEndpoint,
) (*http.Response, error) {
	form, err := openAITranscriptionForm(call.req.Transcription, call.model)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrInternal, herr.M{
			"message": "the transcription upload could not be re-encoded for the provider",
			"fault":   "gateway",
		}, err)
	}
	return r.postAudio(ctx, endpoint, form)
}

// dispatchTranscriptionStream serves POST /v1/audio/transcriptions with
// stream=true: the provider's SSE relayed unchanged, usage read off
// transcript.text.done, and the uploaded audio's own duration charged when
// that event never arrives.
func (r *BifrostRouter) dispatchTranscriptionStream(ctx context.Context, call audioCall) (domain.StreamIterator, error) {
	upload := call.req.Transcription
	if upload == nil || len(upload.File) == 0 {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": "missing required field: file"})
	}
	endpoint, ok := r.directAudioEndpoint(call, "transcriptions")
	if !ok {
		return nil, herr.New(ctx, domain.ErrUnsupportedParameter, herr.M{
			"message": "stream=true is served on OpenAI and Azure OpenAI credentials only, and this request " +
				"resolved to " + string(call.cred.ProviderID) +
				". Send the request without stream to receive the transcript in one body",
			"fault": "customer",
		})
	}
	//nolint:bodyclose // the returned stream owns the body, and the one-body reader closes it
	resp, err := r.openDirectTranscription(ctx, call, endpoint)
	if err != nil {
		return nil, err
	}
	measured := domain.Usage{AudioSeconds: uploadedAudioSeconds(upload.File)}
	if isEventStream(resp.Header) {
		return newAudioStream(resp, forwardedAudioHeaders(resp.Header), &audioMeter{
			cut:        measured,
			finalEvent: transcriptDoneEvent,
			final:      transcriptDoneUsage,
		}), nil
	}
	// A model that ignores stream (whisper-1) answers with one body.
	answer, err := readDirectTranscription(ctx, resp, measured)
	if err != nil {
		return nil, err
	}
	return domain.BufferedStream(answer), nil
}

// dispatchTranscriptionDirect is the non-streaming direct call. The
// provider's body and content type are returned as they came, whatever the
// response format: JSON, diarized JSON, plain text, SRT or VTT.
func (r *BifrostRouter) dispatchTranscriptionDirect(
	ctx context.Context,
	call audioCall,
	endpoint audioEndpoint,
) (*domain.Response, error) {
	//nolint:bodyclose // readDirectTranscription closes the body
	resp, err := r.openDirectTranscription(ctx, call, endpoint)
	if err != nil {
		return nil, err
	}
	return readDirectTranscription(ctx, resp,
		domain.Usage{AudioSeconds: uploadedAudioSeconds(call.req.Transcription.File)})
}

// readDirectTranscription reads a one-body transcript and its usage. The
// measured upload duration is the charge when the body states none, which is
// the case for the text, srt and vtt formats.
func readDirectTranscription(ctx context.Context, resp *http.Response, measured domain.Usage) (*domain.Response, error) {
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, transcriptionMaxResponseBytes+1))
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{
			"reason": "the transcription response could not be read: " + err.Error(),
			"fault":  "provider",
		})
	}
	if len(raw) > transcriptionMaxResponseBytes {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{
			"reason": "the transcription response exceeded the size this gateway relays",
			"fault":  "provider",
		})
	}
	usage := measured
	if gjson.ValidBytes(raw) {
		// verbose_json states the duration the provider measured.
		if seconds := gjson.GetBytes(raw, "duration").Float(); seconds > 0 {
			measured = domain.Usage{AudioSeconds: seconds}
		}
		usage = transcriptionUsage(gjson.GetBytes(raw, "usage"), measured)
	}
	return &domain.Response{
		Body:       raw,
		StatusCode: resp.StatusCode,
		Headers:    forwardedAudioHeaders(resp.Header),
		Usage:      usage,
	}, nil
}
