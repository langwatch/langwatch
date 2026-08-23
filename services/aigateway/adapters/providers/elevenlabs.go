package providers

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// ElevenLabs' own audio wire. Bifrost's ElevenLabs provider answers
// Passthrough with an unsupported-operation error, so these two routes call
// the vendor over plain HTTP the way the session mint does: one bounded
// request, the caller's body forwarded as written, the vendor's own answer
// forwarded back.

const (
	// elevenLabsTextToSpeechPath takes the voice id as its last segment.
	elevenLabsTextToSpeechPath = "/v1/text-to-speech/"
	elevenLabsSpeechToTextPath = "/v1/speech-to-text"

	// elevenLabsAudioMaxResponseBytes caps a synthesis answer. Ten minutes of
	// mp3 is under 10 MiB, so this leaves room for the longest text the vendor
	// accepts and still refuses a body that is a wrong endpoint rather than
	// audio.
	elevenLabsAudioMaxResponseBytes = 32 << 20

	// elevenLabsSTTFileField is the multipart part the vendor reads the audio
	// from. It is rebuilt rather than forwarded because the router already
	// consumed the inbound form.
	elevenLabsSTTFileField = "file"
)

// newElevenLabsAudioClient builds the client for the native audio routes.
// Redirects are never followed and every resolved address is re-checked
// against the endpoint policy at dial time, for the reason the mint client
// gives: the request carries the customer's provider key in a header Go does
// not strip across hosts. The timeout is the gateway-wide provider ceiling,
// because synthesis and transcription are real work rather than a mint.
func newElevenLabsAudioClient(policy customerEndpointPolicy) *http.Client {
	timeout := ProviderRequestTimeoutSeconds * time.Second
	dialer := policyDialer(policy, timeout)
	return &http.Client{
		Timeout:   timeout,
		Transport: &http.Transport{DialContext: dialer.DialContext},
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// fallbackElevenLabsAudioClient serves a zero-value router, which only tests
// build: NewBifrostRouter always sets elevenLabsClient.
var fallbackElevenLabsAudioClient = func() func(customerEndpointPolicy) *http.Client {
	var (
		once   sync.Once
		client *http.Client
	)
	return func(policy customerEndpointPolicy) *http.Client {
		once.Do(func() { client = newElevenLabsAudioClient(policy) })
		return client
	}
}()

// dispatchElevenLabsSpeech posts the caller's own synthesis body to
// ElevenLabs and returns the audio bytes verbatim.
//
// The body is the caller's, forwarded as they wrote it apart from the model
// id, which the resolver already rewrote to what the virtual key's aliases
// and allowlist settled on. Voice settings, language, seed, the
// previous/next text fields and everything else are theirs and reach the
// vendor untouched.
func (r *BifrostRouter) dispatchElevenLabsSpeech(
	ctx context.Context,
	req *domain.Request,
	cred domain.Credential,
) (*domain.Response, error) {
	route := req.ElevenLabs
	if route == nil || route.VoiceID == "" {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{
			"message": "voice_id is required: ElevenLabs synthesis names the voice in the URL path",
			"fault":   "customer",
		})
	}
	endpoint := elevenLabsAudioEndpoint(
		cred, elevenLabsTextToSpeechPath+url.PathEscape(route.VoiceID), route.RawQuery)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(req.Body))
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{"reason": err.Error()})
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("xi-api-key", cred.APIKey)

	resp, err := r.doElevenLabsAudio(ctx, httpReq)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return resp, nil
	}
	resp.Usage = domain.Usage{InputChars: elevenLabsSynthesizedChars(req.Body)}
	return resp, nil
}

// dispatchElevenLabsTranscription posts the caller's audio to ElevenLabs and
// returns the transcript JSON verbatim.
//
// The form is rebuilt rather than relayed because the router already parsed
// the inbound one to reach the model. Every text part the caller sent is
// carried over as written, so this vendor's own settings (diarization,
// timestamp granularity, language, additional formats) keep working; only
// the model part is replaced, with what the virtual key resolved.
func (r *BifrostRouter) dispatchElevenLabsTranscription(
	ctx context.Context,
	req *domain.Request,
	cred domain.Credential,
) (*domain.Response, error) {
	model := elevenLabsDispatchModel(req)
	upload := req.Transcription
	if upload == nil {
		return nil, herr.New(ctx, domain.ErrInternal, herr.M{
			"message": "the ElevenLabs transcription dispatch reached the provider router with no upload",
			"fault":   "gateway",
		})
	}
	form, contentType, err := elevenLabsTranscriptionForm(upload, model)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrInternal, herr.M{
			"message": "the transcription upload could not be re-encoded for the provider",
			"fault":   "gateway",
		}, err)
	}

	rawQuery := ""
	if req.ElevenLabs != nil {
		rawQuery = req.ElevenLabs.RawQuery
	}
	endpoint := elevenLabsAudioEndpoint(cred, elevenLabsSpeechToTextPath, rawQuery)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(form))
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{"reason": err.Error()})
	}
	httpReq.Header.Set("Content-Type", contentType)
	httpReq.Header.Set("xi-api-key", cred.APIKey)

	resp, err := r.doElevenLabsAudio(ctx, httpReq)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return resp, nil
	}
	resp.Usage = domain.Usage{AudioSeconds: elevenLabsTranscribedSeconds(resp.Body)}
	return resp, nil
}

// elevenLabsTranscriptionForm rebuilds the multipart body the vendor reads.
// The model part carries the resolved id, so an alias or a provider-prefixed
// spelling reaches the vendor as the bare model it names. The audio part is
// written only when the caller uploaded bytes: this vendor also accepts a
// cloud_storage_url it fetches itself, which arrives as one more text part.
func elevenLabsTranscriptionForm(upload *domain.TranscriptionUpload, model string) ([]byte, string, error) {
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	if err := writeElevenLabsTextParts(w, upload.Params, model); err != nil {
		return nil, "", err
	}
	if err := writeElevenLabsAudioPart(w, upload); err != nil {
		return nil, "", err
	}
	if err := w.Close(); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), w.FormDataContentType(), nil
}

// writeElevenLabsTextParts carries the caller's own settings over and states
// the resolved model in place of whatever spelling they wrote.
func writeElevenLabsTextParts(w *multipart.Writer, params map[string]string, model string) error {
	for name, value := range params {
		if name == domain.ElevenLabsModelField {
			continue
		}
		if err := w.WriteField(name, value); err != nil {
			return err
		}
	}
	if model == "" {
		return nil
	}
	return w.WriteField(domain.ElevenLabsModelField, model)
}

// writeElevenLabsAudioPart adds the uploaded audio, and nothing at all when
// the caller named a cloud_storage_url for the vendor to fetch instead.
func writeElevenLabsAudioPart(w *multipart.Writer, upload *domain.TranscriptionUpload) error {
	if len(upload.File) == 0 {
		return nil
	}
	filename := upload.Filename
	if filename == "" {
		filename = "audio"
	}
	part, err := w.CreateFormFile(elevenLabsSTTFileField, filename)
	if err != nil {
		return err
	}
	_, err = part.Write(upload.File)
	return err
}

// elevenLabsSynthesizedChars measures what a synthesis call is priced by.
// ElevenLabs bills speech per character of the text it spoke, and the catalog
// carries a per-character rate, so the count is of the request's own text.
//
// Counted in runes, the same measure the OpenAI-wire speech route reports, so
// the identical call bills the same on either wire.
//
// The vendor also states a character-cost response header, and that is
// deliberately not used: it is credits under the account's own plan, not
// characters, and it already carries the model's price factor (the same text
// reported 18 on eleven_multilingual_v2 and 9 on eleven_flash_v2_5, measured
// 2026-08-21). Rating credits at a per-character rate would apply that factor
// twice.
func elevenLabsSynthesizedChars(body []byte) int {
	return utf8.RuneCountInString(gjson.GetBytes(body, "text").String())
}

// elevenLabsTranscribedSeconds measures what a transcription call is priced
// by: the duration of the audio, which the vendor states on its answer as
// audio_duration_secs.
//
// The word timings are the fallback for a response that carries no duration,
// including the multi-channel shape that nests its transcripts. They end at
// the last spoken word rather than at the end of the file, so they under-
// measure any audio with trailing silence; the stated duration is preferred
// wherever it exists for exactly that reason.
func elevenLabsTranscribedSeconds(body []byte) float64 {
	if stated := gjson.GetBytes(body, "audio_duration_secs"); stated.Exists() {
		if seconds := stated.Float(); seconds > 0 {
			return seconds
		}
	}
	longest := 0.0
	for _, path := range []string{"words.#.end", "transcripts.#.words.#.end"} {
		gjson.GetBytes(body, path).ForEach(func(_, value gjson.Result) bool {
			if value.IsArray() {
				value.ForEach(func(_, inner gjson.Result) bool {
					longest = max(longest, inner.Float())
					return true
				})
				return true
			}
			longest = max(longest, value.Float())
			return true
		})
	}
	return longest
}

// elevenLabsAudioEndpoint resolves the vendor host for this credential and
// re-attaches the caller's query. A customer on a residency endpoint stores
// it as the provider's base URL, and calling the default host would send
// their audio to the wrong region.
func elevenLabsAudioEndpoint(cred domain.Credential, path, rawQuery string) string {
	endpoint := realtimeEndpoint(cred, elevenLabsRealtimeDefaultBaseURL, path)
	if rawQuery != "" {
		endpoint += "?" + rawQuery
	}
	return endpoint
}

// doElevenLabsAudio performs the vendor call and shapes the answer. A vendor
// error is returned as a success-shaped Response carrying the upstream status
// and native body, the same contract the other raw-forward lanes use, so the
// caller sees the vendor's own words and the retry walk classifies the status
// itself.
func (r *BifrostRouter) doElevenLabsAudio(
	ctx context.Context,
	httpReq *http.Request,
) (*domain.Response, error) {
	client := r.elevenLabsClient
	if client == nil {
		client = fallbackElevenLabsAudioClient(r.endpointPolicy)
	}
	httpResp, err := client.Do(httpReq) //nolint:gosec // vetted by the endpoint policy at dispatch and again at dial time
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{
			"reason": "the ElevenLabs audio request failed: " + err.Error(),
			"fault":  "provider",
		})
	}
	defer func() { _ = httpResp.Body.Close() }()

	// One byte past the cap, so a truncated answer is distinguishable from
	// one that exactly fills it. Forwarding truncated audio under the
	// vendor's 200 would hand the caller a file that will not play.
	raw, err := io.ReadAll(io.LimitReader(httpResp.Body, elevenLabsAudioMaxResponseBytes+1))
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{
			"reason": "the ElevenLabs audio response could not be read: " + err.Error(),
			"fault":  "provider",
		})
	}
	if len(raw) > elevenLabsAudioMaxResponseBytes {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{
			"reason": fmt.Sprintf(
				"the ElevenLabs audio response exceeded %d bytes", elevenLabsAudioMaxResponseBytes),
			"fault": "provider",
		})
	}
	return &domain.Response{
		Body:       raw,
		StatusCode: httpResp.StatusCode,
		Headers:    elevenLabsResponseHeaders(httpResp.Header),
	}, nil
}

// elevenLabsResponseHeaders keeps the headers a caller needs and drops the
// ones that describe a body this hop re-frames.
//
// Content-Type is what tells an SDK whether it holds mp3, PCM or the
// transcript JSON, so it must survive; the audio format is the caller's own
// query parameter and the answer has to say which one it got. The vendor's
// request-id and its concurrency counters ride along because a customer
// debugging with ElevenLabs support needs the id the vendor logged, and a
// client backing off needs to see its own limit. Content-Length is dropped
// for the reason the passthrough lane drops it.
func elevenLabsResponseHeaders(h http.Header) map[string]string {
	forward := []string{
		"Content-Type",
		"Request-Id",
		"History-Item-Id",
		"Current-Concurrent-Requests",
		"Maximum-Concurrent-Requests",
		"Retry-After",
	}
	out := make(map[string]string, len(forward))
	for _, name := range forward {
		if v := h.Get(name); v != "" {
			out[name] = v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// elevenLabsNativeRoute reports whether this request arrived on one of
// ElevenLabs' own audio paths, which is what sends it to the vendor directly
// instead of through Bifrost.
func elevenLabsNativeRoute(req *domain.Request) bool {
	return req != nil && req.ElevenLabs != nil
}

// elevenLabsDispatchModel is the bare model id to send the vendor. Resolution
// already returns the bare form, so the prefix strip only guards the path
// where nothing resolved and the caller's own spelling is all there is.
func elevenLabsDispatchModel(req *domain.Request) string {
	model := req.Model
	if req.Resolved != nil {
		model = req.Resolved.ModelID
	}
	if _, bare, found := strings.Cut(model, "/"); found {
		return bare
	}
	return model
}
