//go:build live_images

package matrix

// Live image cells: bind the @integration scenarios of
// specs/ai-gateway/images-endpoints.feature against a REAL local stack and
// REAL provider keys (no mocks): gateway on :5563, control plane on :5560, a
// VK with the OpenAI credentials bound.
//
//	GATEWAY_URL=http://localhost:5563 \
//	LW_PROJECT_API_KEY=... \
//	TEST_VK_OPENAI=vk-lw-... \
//	  go test -tags=live_images ./services/aigateway/tests/matrix/... -v
//
// The generated image is fed straight back into the edit route, so both
// directions are proven on real pixels rather than on a fixture.

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
	"time"
)

const imagePrompt = "a red bicycle leaning on a white wall, flat illustration"

// pngMagic is the 8-byte PNG signature every real PNG opens with.
var pngMagic = []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}

func imageHTTPClient() *http.Client {
	return &http.Client{Timeout: 300 * time.Second}
}

// imageTraceParent stamps a fresh W3C traceparent on the request and returns
// its trace id, so the call can be read back from the trace API afterwards.
func imageTraceParent(t *testing.T, req *http.Request) string {
	t.Helper()
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		t.Fatalf("generate trace id: %v", err)
	}
	traceID := hex.EncodeToString(raw)
	span := make([]byte, 8)
	if _, err := rand.Read(span); err != nil {
		t.Fatalf("generate span id: %v", err)
	}
	req.Header.Set("traceparent", "00-"+traceID+"-"+hex.EncodeToString(span)+"-01")
	return traceID
}

func imageSnippet(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "…"
}

// imagesResponse is the slice of the OpenAI images JSON these cells assert on.
type imagesResponse struct {
	Data []struct {
		B64JSON string `json:"b64_json"`
	} `json:"data"`
	Usage struct {
		InputTokens         int `json:"input_tokens"`
		OutputTokens        int `json:"output_tokens"`
		OutputTokensDetails struct {
			ImageTokens int `json:"image_tokens"`
		} `json:"output_tokens_details"`
	} `json:"usage"`
}

// decodeFirstImage requires the answer to carry one decodable PNG and returns
// its bytes.
func decodeFirstImage(t *testing.T, parsed imagesResponse) []byte {
	t.Helper()
	if len(parsed.Data) == 0 || parsed.Data[0].B64JSON == "" {
		t.Fatalf("the answer carries no data[0].b64_json, which is what every OpenAI SDK reads")
	}
	png, err := base64.StdEncoding.DecodeString(parsed.Data[0].B64JSON)
	if err != nil {
		t.Fatalf("data[0].b64_json is not base64: %v", err)
	}
	if !bytes.HasPrefix(png, pngMagic) {
		t.Fatalf("the decoded image is not a PNG (first bytes: % x)", png[:min(8, len(png))])
	}
	return png
}

// generateImage fires /v1/images/generations and returns the parsed answer
// together with the trace id the call was billed under.
func generateImage(t *testing.T, vk, model string) (imagesResponse, string) {
	t.Helper()
	body := fmt.Sprintf(`{"model":%q,"prompt":%q,"size":"1024x1024","quality":"low","n":1}`,
		model, imagePrompt)
	req, err := http.NewRequest(http.MethodPost, gatewayURL()+"/v1/images/generations",
		strings.NewReader(body))
	if err != nil {
		t.Fatalf("build generation request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+vk)
	req.Header.Set("Content-Type", "application/json")
	traceID := imageTraceParent(t, req)

	resp, err := imageHTTPClient().Do(req)
	if err != nil {
		t.Fatalf("generation request: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read generation response: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("generation returned %d: %s", resp.StatusCode, imageSnippet(raw, 500))
	}
	var parsed imagesResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("generation response is not the OpenAI JSON shape: %v; body: %s",
			err, imageSnippet(raw, 300))
	}
	return parsed, traceID
}

// editImage fires /v1/images/edits with the source PNG under the SDK's own
// "image[]" field and returns the parsed answer plus its trace id.
func editImage(t *testing.T, vk, model string, png []byte) (imagesResponse, string) {
	t.Helper()
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	fw, err := w.CreateFormFile("image[]", "source.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write(png); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	for field, value := range map[string]string{
		"model":   model,
		"prompt":  "put the bicycle on a sandy beach",
		"size":    "1024x1024",
		"quality": "low",
		"n":       "1",
	} {
		if err := w.WriteField(field, value); err != nil {
			t.Fatalf("write %s field: %v", field, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close multipart: %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, gatewayURL()+"/v1/images/edits", buf)
	if err != nil {
		t.Fatalf("build edit request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+vk)
	req.Header.Set("Content-Type", w.FormDataContentType())
	traceID := imageTraceParent(t, req)

	resp, err := imageHTTPClient().Do(req)
	if err != nil {
		t.Fatalf("edit request: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read edit response: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("edit returned %d: %s", resp.StatusCode, imageSnippet(raw, 500))
	}
	var parsed imagesResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("edit response is not the OpenAI JSON shape: %v; body: %s",
			err, imageSnippet(raw, 300))
	}
	return parsed, traceID
}

// awaitImageTraceCost polls the trace API until the call lands with a cost.
//
// It cannot reuse assertTraceCaptured: that helper also waits for a non-zero
// completion-token count, and an image call reports its answer as image
// tokens, so it would time out on a perfectly billed request.
func awaitImageTraceCost(t *testing.T, traceID string) float64 {
	t.Helper()
	apiKey := requireEnv(t, "LW_PROJECT_API_KEY")

	deadline := time.Now().Add(45 * time.Second)
	backoff := 500 * time.Millisecond
	url := lwBaseURL() + "/api/trace/" + traceID
	for {
		req, _ := http.NewRequest(http.MethodGet, url, nil)
		req.Header.Set("X-Auth-Token", apiKey)
		resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
		if err == nil {
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				var parsed struct {
					Metrics struct {
						TotalCost float64 `json:"total_cost"`
					} `json:"metrics"`
				}
				if json.Unmarshal(body, &parsed) == nil && parsed.Metrics.TotalCost > 0 {
					return parsed.Metrics.TotalCost
				}
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("trace %s did not land with a cost within 45s; an image call that "+
				"measures nothing is billed as free", traceID)
		}
		time.Sleep(backoff)
		if backoff < 4*time.Second {
			backoff *= 2
		}
	}
}

// @scenario "OpenAI-shape image generation returns the images JSON"
// @scenario "The OpenAI SDK's image[] parts carry every source image"
// @scenario "An image call is metered and billed"
func TestImages_OpenAI_GenerateThenEdit(t *testing.T) {
	vk := requireEnv(t, "TEST_VK_OPENAI")
	model := "openai/gpt-image-2"

	generated, generateTrace := generateImage(t, vk, model)
	png := decodeFirstImage(t, generated)
	t.Logf("generation produced %d bytes of PNG for %d output image tokens",
		len(png), generated.Usage.OutputTokensDetails.ImageTokens)
	if generated.Usage.OutputTokensDetails.ImageTokens == 0 {
		t.Fatalf("the answer states no output image tokens, so the call would bill nothing")
	}

	edited, editTrace := editImage(t, vk, model, png)
	editedPNG := decodeFirstImage(t, edited)
	t.Logf("edit produced %d bytes of PNG for %d output image tokens",
		len(editedPNG), edited.Usage.OutputTokensDetails.ImageTokens)
	if edited.Usage.OutputTokensDetails.ImageTokens == 0 {
		t.Fatalf("the edit states no output image tokens, so the call would bill nothing")
	}

	// Both calls have to reach the trace explorer with a cost. Without this
	// the cells prove only that pixels crossed both routes, and metering
	// could be silently zero.
	t.Logf("generation rated $%.9f", awaitImageTraceCost(t, generateTrace))
	t.Logf("edit rated $%.9f", awaitImageTraceCost(t, editTrace))
}

// @scenario "A streamed image request is refused before dispatch"
func TestImages_OpenAI_StreamIsRefused(t *testing.T) {
	vk := requireEnv(t, "TEST_VK_OPENAI")

	body := fmt.Sprintf(`{"model":"openai/gpt-image-2","prompt":%q,"stream":true}`, imagePrompt)
	req, err := http.NewRequest(http.MethodPost, gatewayURL()+"/v1/images/generations",
		strings.NewReader(body))
	if err != nil {
		t.Fatalf("build generation request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+vk)
	req.Header.Set("Content-Type", "application/json")

	resp, err := imageHTTPClient().Do(req)
	if err != nil {
		t.Fatalf("generation request: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("a streamed image request returned %d, want 400: %s",
			resp.StatusCode, imageSnippet(raw, 300))
	}
	if !strings.Contains(string(raw), "streaming image generation is not supported") {
		t.Fatalf("the refusal does not say why: %s", imageSnippet(raw, 300))
	}
}
