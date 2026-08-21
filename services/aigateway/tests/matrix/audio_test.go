//go:build live_audio

package matrix

// Live audio cells: bind the @integration scenarios of
// specs/ai-gateway/audio-endpoints.feature against a REAL local stack and
// REAL provider keys (no mocks): gateway on :5563, control plane on :5560, a
// VK with the provider's credentials bound.
//
//	GATEWAY_URL=http://localhost:5563 \
//	TEST_VK_OPENAI=vk-lw-... \
//	  go test -tags=live_audio -run TestAudio_OpenAI ./services/aigateway/tests/matrix/... -v
//
//	TEST_VK_ELEVENLABS=vk-lw-... \
//	ELEVENLABS_VOICE_ID=cjVigY5qzO86Huf0OWal \
//	  go test -tags=live_audio -run TestAudio_ElevenLabs ./services/aigateway/tests/matrix/... -v
//
// TTS→STT round-trip is the assertion where it matters: the transcription
// cells feed the speech cell's own output back in and require the transcript
// to contain the spoken words, proving both directions carried REAL audio.

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

const spokenLine = "The quick brown fox jumps over the lazy dog"

func audioHTTPClient() *http.Client {
	return &http.Client{Timeout: 120 * time.Second}
}

// speak fires /v1/audio/speech and returns the raw audio bytes.
func speak(t *testing.T, vk, model, voice, format string) []byte {
	t.Helper()
	body := fmt.Sprintf(`{"model":%q,"voice":%q,"input":%q,"response_format":%q}`,
		model, voice, spokenLine, format)
	req, err := http.NewRequest(http.MethodPost, gatewayURL()+"/v1/audio/speech", strings.NewReader(body))
	if err != nil {
		t.Fatalf("build speech request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+vk)
	req.Header.Set("Content-Type", "application/json")

	resp, err := audioHTTPClient().Do(req)
	if err != nil {
		t.Fatalf("speech request: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	audio, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read speech response: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("speech returned %d: %s", resp.StatusCode, truncate(audio, 500))
	}
	if len(audio) < 1024 {
		t.Fatalf("speech returned implausibly small audio (%d bytes): %s", len(audio), truncate(audio, 200))
	}
	if json.Valid(audio) {
		t.Fatalf("speech response is JSON, expected raw audio bytes: %s", truncate(audio, 300))
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "audio/") {
		t.Fatalf("speech Content-Type = %q, want audio/*", ct)
	}
	return audio
}

// transcribe fires /v1/audio/transcriptions with the given file bytes and
// returns the transcript text.
func transcribe(t *testing.T, vk, model, filename string, file []byte) string {
	t.Helper()
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	fw, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write(file); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := w.WriteField("model", model); err != nil {
		t.Fatalf("write model field: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close multipart: %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, gatewayURL()+"/v1/audio/transcriptions", buf)
	if err != nil {
		t.Fatalf("build transcription request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+vk)
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := audioHTTPClient().Do(req)
	if err != nil {
		t.Fatalf("transcription request: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read transcription response: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("transcription returned %d: %s", resp.StatusCode, truncate(body, 500))
	}
	var parsed struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("transcription response is not the OpenAI JSON shape: %v; body: %s", err, truncate(body, 300))
	}
	if parsed.Text == "" {
		t.Fatalf("transcription returned empty text: %s", truncate(body, 300))
	}
	return parsed.Text
}

// assertHeardTheFox requires the transcript to carry the distinctive words of
// spokenLine, the proof real audio crossed both directions.
func assertHeardTheFox(t *testing.T, transcript string) {
	t.Helper()
	lower := strings.ToLower(transcript)
	for _, word := range []string{"quick", "brown", "fox", "lazy", "dog"} {
		if !strings.Contains(lower, word) {
			t.Fatalf("transcript %q does not contain %q; the audio did not survive the round trip", transcript, word)
		}
	}
}

// wavFromPCM wraps raw PCM16 mono in a minimal WAV header so a "pcm"
// speech response can be posted to the transcription endpoint, which
// (like OpenAI's) wants a container format it can sniff.
func wavFromPCM(pcm []byte, sampleRate int) []byte {
	buf := &bytes.Buffer{}
	dataLen := uint32(len(pcm))
	_, _ = buf.WriteString("RIFF")
	_ = binary.Write(buf, binary.LittleEndian, 36+dataLen)
	_, _ = buf.WriteString("WAVEfmt ")
	_ = binary.Write(buf, binary.LittleEndian, uint32(16))
	_ = binary.Write(buf, binary.LittleEndian, uint16(1)) // PCM
	_ = binary.Write(buf, binary.LittleEndian, uint16(1)) // mono
	_ = binary.Write(buf, binary.LittleEndian, uint32(sampleRate))
	_ = binary.Write(buf, binary.LittleEndian, uint32(sampleRate*2)) // byte rate
	_ = binary.Write(buf, binary.LittleEndian, uint16(2))            // block align
	_ = binary.Write(buf, binary.LittleEndian, uint16(16))           // bits/sample
	_, _ = buf.WriteString("data")
	_ = binary.Write(buf, binary.LittleEndian, dataLen)
	_, _ = buf.Write(pcm)
	return buf.Bytes()
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "…"
}

// --- OpenAI cells ---

func TestAudio_OpenAI_SpeechToTranscriptionRoundTrip(t *testing.T) {
	vk := requireEnv(t, "TEST_VK_OPENAI")

	// TTS: pcm output so the bytes can be re-containered deterministically.
	pcm := speak(t, vk, "openai/gpt-4o-mini-tts", "nova", "pcm")

	// STT: feed the synthesized speech straight back through the gateway.
	transcript := transcribe(t, vk, "openai/gpt-4o-transcribe", "roundtrip.wav", wavFromPCM(pcm, 24000))
	t.Logf("openai transcript: %q", transcript)
	assertHeardTheFox(t, transcript)
}

func TestAudio_OpenAI_SpeechMP3(t *testing.T) {
	vk := requireEnv(t, "TEST_VK_OPENAI")
	audio := speak(t, vk, "openai/gpt-4o-mini-tts", "nova", "mp3")
	// MP3 sync bytes or ID3 tag, cheap sanity that the format matched.
	if !bytes.HasPrefix(audio, []byte("ID3")) && (len(audio) < 2 || audio[0] != 0xFF) {
		t.Fatalf("mp3 response does not look like MP3 (first bytes: % x)", audio[:8])
	}
}

// --- ElevenLabs cells ---

// @scenario "ElevenLabs TTS through the same OpenAI wire shape"
func TestAudio_ElevenLabs_SpeechToOpenAITranscription(t *testing.T) {
	elVK := requireEnv(t, "TEST_VK_ELEVENLABS")
	voice := os.Getenv("ELEVENLABS_VOICE_ID")
	if voice == "" {
		t.Skip("ELEVENLABS_VOICE_ID not set")
	}
	model := os.Getenv("ELEVENLABS_TTS_MODEL")
	if model == "" {
		model = "eleven_flash_v2"
	}

	// pcm on purpose: the gateway must ask ElevenLabs for pcm_24000 (every
	// tier, OpenAI's 24kHz semantics), not Bifrost's default pcm_44100
	// (Pro-tier-gated, wrong rate). Re-containering at 24kHz and having
	// OpenAI STT still hear the sentence proves both halves.
	audio := speak(t, elVK, "elevenlabs/"+model, voice, "pcm")

	// Cross-provider proof: EL speaks, OpenAI listens. Needs an OpenAI VK too.
	oaVK := requireEnv(t, "TEST_VK_OPENAI")
	transcript := transcribe(t, oaVK, "openai/gpt-4o-transcribe", "el.wav", wavFromPCM(audio, 24000))
	t.Logf("elevenlabs->openai transcript: %q", transcript)
	assertHeardTheFox(t, transcript)
}

// @scenario "ElevenLabs transcription through the same multipart shape"
func TestAudio_ElevenLabs_Transcription(t *testing.T) {
	elVK := requireEnv(t, "TEST_VK_ELEVENLABS")
	oaVK := requireEnv(t, "TEST_VK_OPENAI")

	// OpenAI speaks, ElevenLabs listens (scribe_v1).
	pcm := speak(t, oaVK, "openai/gpt-4o-mini-tts", "nova", "pcm")
	transcript := transcribe(t, elVK, "elevenlabs/scribe_v1", "oa.wav", wavFromPCM(pcm, 24000))
	t.Logf("openai->elevenlabs transcript: %q", transcript)
	assertHeardTheFox(t, transcript)
}

// --- ElevenLabs native cells ---
//
// The vendor's own paths, mirrored by the gateway. These prove the two things
// a unit test cannot: that a real ElevenLabs account answers the request the
// gateway builds, and that the audio survives a round trip through both new
// routes.
//
//	TEST_VK_ELEVENLABS=vk-lw-... \
//	ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL \
//	  go test -tags=live_audio -run TestAudio_ElevenLabsNative ./services/aigateway/tests/matrix/... -v

// speakNative fires the vendor's own synthesis path and returns the audio.
func speakNative(t *testing.T, vk, voice, model string) []byte {
	t.Helper()
	body := fmt.Sprintf(`{"text":%q,"model_id":%q}`, spokenLine, model)
	url := fmt.Sprintf("%s/v1/text-to-speech/%s?output_format=mp3_44100_128", gatewayURL(), voice)
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		t.Fatalf("build native speech request: %v", err)
	}
	// The vendor's own auth header, which is the whole point of mirroring the
	// path: an ElevenLabs SDK changes its base URL and nothing else.
	req.Header.Set("xi-api-key", vk)
	req.Header.Set("Content-Type", "application/json")

	resp, err := audioHTTPClient().Do(req)
	if err != nil {
		t.Fatalf("native speech request: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	audio, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read native speech response: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("native speech returned %d: %s", resp.StatusCode, truncate(audio, 500))
	}
	if len(audio) < 1024 {
		t.Fatalf("native speech returned implausibly small audio (%d bytes): %s",
			len(audio), truncate(audio, 200))
	}
	if json.Valid(audio) {
		t.Fatalf("native speech response is JSON, expected raw audio: %s", truncate(audio, 300))
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "audio/") {
		t.Fatalf("native speech Content-Type = %q, want audio/*", ct)
	}
	return audio
}

// transcribeNative fires the vendor's own transcription path and returns the
// whole answer, which carries the duration the call is billed by.
func transcribeNative(t *testing.T, vk, model, filename string, file []byte) (string, float64) {
	t.Helper()
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	fw, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write(file); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := w.WriteField("model_id", model); err != nil {
		t.Fatalf("write model_id field: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close multipart: %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, gatewayURL()+"/v1/speech-to-text", buf)
	if err != nil {
		t.Fatalf("build native transcription request: %v", err)
	}
	req.Header.Set("xi-api-key", vk)
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := audioHTTPClient().Do(req)
	if err != nil {
		t.Fatalf("native transcription request: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read native transcription response: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("native transcription returned %d: %s", resp.StatusCode, truncate(body, 500))
	}
	var parsed struct {
		Text     string  `json:"text"`
		Duration float64 `json:"audio_duration_secs"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("native transcription answer is not the vendor's JSON shape: %v; body: %s",
			err, truncate(body, 300))
	}
	if parsed.Text == "" {
		t.Fatalf("native transcription returned empty text: %s", truncate(body, 300))
	}
	return parsed.Text, parsed.Duration
}

// @scenario "A native ElevenLabs synthesis call bills the characters it spoke"
// @scenario "A native ElevenLabs transcription call bills the seconds it heard"
func TestAudio_ElevenLabsNative_SpeechToTranscriptionRoundTrip(t *testing.T) {
	vk := requireEnv(t, "TEST_VK_ELEVENLABS")
	voice := os.Getenv("ELEVENLABS_VOICE_ID")
	if voice == "" {
		t.Skip("ELEVENLABS_VOICE_ID not set")
	}
	ttsModel := os.Getenv("ELEVENLABS_TTS_MODEL")
	if ttsModel == "" {
		ttsModel = "eleven_flash_v2_5"
	}

	audio := speakNative(t, vk, voice, ttsModel)
	t.Logf("native TTS produced %d bytes of mp3 for %d characters", len(audio), len(spokenLine))

	transcript, duration := transcribeNative(t, vk, "scribe_v1", "native.mp3", audio)
	t.Logf("native STT transcript: %q over %.4f seconds", transcript, duration)
	assertHeardTheFox(t, transcript)
	if duration <= 0 {
		t.Fatalf("the vendor stated no audio duration, so the call would bill nothing")
	}
}
