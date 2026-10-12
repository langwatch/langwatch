package llmsim

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

type geminiResponse struct {
	Candidates []struct {
		Content struct {
			Role  string `json:"role"`
			Parts []struct {
				Text         string `json:"text"`
				FunctionCall *struct {
					Name string          `json:"name"`
					Args json.RawMessage `json:"args"`
				} `json:"functionCall"`
			} `json:"parts"`
		} `json:"content"`
		FinishReason string `json:"finishReason"`
	} `json:"candidates"`
	UsageMetadata *struct {
		PromptTokenCount     int `json:"promptTokenCount"`
		CandidatesTokenCount int `json:"candidatesTokenCount"`
	} `json:"usageMetadata"`
}

func (g geminiResponse) text() string {
	var out strings.Builder
	for _, p := range g.Candidates[0].Content.Parts {
		out.WriteString(p.Text)
	}
	return out.String()
}

const geminiPath = "/v1beta/models/gemini-2.5-flash:generateContent"
const vertexPath = "/v1/projects/p1/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent"

// @scenario "Gemini and Vertex generateContent are answered in Google's shape"
func TestGeminiGenerateContentAnswersDeterministically(t *testing.T) {
	srv := newTestServer(t)
	body := `{"systemInstruction":{"parts":[{"text":"be brief"}]},"contents":[{"role":"user","parts":[{"text":"hello there"}]}]}`
	var answers []string
	for range 2 {
		resp, raw := post(t, srv.URL+geminiPath+"?key=AIza-not-real", body, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status %d: %s", resp.StatusCode, raw)
		}
		var out geminiResponse
		if err := json.Unmarshal([]byte(raw), &out); err != nil || len(out.Candidates) != 1 {
			t.Fatalf("decoding %s: %v", raw, err)
		}
		if out.Candidates[0].Content.Role != "model" || out.Candidates[0].FinishReason != "STOP" || out.UsageMetadata == nil || out.UsageMetadata.PromptTokenCount == 0 {
			t.Fatalf("unexpected shape: %s", raw)
		}
		answers = append(answers, out.text())
	}
	if answers[0] == "" || answers[0] != answers[1] {
		t.Fatalf("the same prompt should answer the same text, got %q and %q", answers[0], answers[1])
	}
	if !strings.Contains(readCalls(t, srv.URL), `"dialect":"gemini"`) {
		t.Fatal("the call should be recorded under the gemini dialect")
	}
}

// @scenario "Gemini and Vertex generateContent are answered in Google's shape"
func TestGeminiStreamsAsSSEOrAnArray(t *testing.T) {
	srv := newTestServer(t)
	body := `{"contents":[{"role":"user","parts":[{"text":"tell me a story"}]}]}`
	streamPath := strings.Replace(geminiPath, ":generateContent", ":streamGenerateContent", 1)
	_, whole := post(t, srv.URL+geminiPath, body, nil)
	var single geminiResponse
	_ = json.Unmarshal([]byte(whole), &single)

	resp, raw := post(t, srv.URL+streamPath+"?alt=sse", body, nil)
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("alt=sse should stream SSE, got %q", ct)
	}
	_, data := sseData(t, raw)
	var joined strings.Builder
	for i, d := range data {
		var chunk geminiResponse
		if err := json.Unmarshal([]byte(d), &chunk); err != nil {
			t.Fatalf("chunk %q: %v", d, err)
		}
		joined.WriteString(chunk.text())
		last := i == len(data)-1
		if (chunk.Candidates[0].FinishReason != "") != last || (chunk.UsageMetadata != nil) != last {
			t.Fatalf("only the last chunk carries finishReason and usage: %s", d)
		}
	}
	if joined.String() != single.text() {
		t.Fatalf("the stream should join to the answer: %q vs %q", joined.String(), single.text())
	}

	_, arr := post(t, srv.URL+streamPath, body, nil)
	var chunks []geminiResponse
	if err := json.Unmarshal([]byte(arr), &chunks); err != nil || len(chunks) != len(data) {
		t.Fatalf("without alt=sse the stream is a JSON array of the same chunks: %v %s", err, arr)
	}
}

// @scenario "Gemini and Vertex generateContent are answered in Google's shape"
func TestGeminiForcedFunctionCallAndSchema(t *testing.T) {
	srv := newTestServer(t)
	tools := `"tools":[{"functionDeclarations":[{"name":"get_weather","parameters":{"type":"OBJECT","properties":{"city":{"type":"STRING"}},"required":["city"]}}]}]`
	body := `{"contents":[{"role":"user","parts":[{"text":"weather?"}]}],` + tools + `,"toolConfig":{"functionCallingConfig":{"mode":"ANY","allowedFunctionNames":["get_weather"]}}}`
	_, raw := post(t, srv.URL+vertexPath, body, nil)
	var out geminiResponse
	_ = json.Unmarshal([]byte(raw), &out)
	parts := out.Candidates[0].Content.Parts
	if len(parts) != 1 || parts[0].FunctionCall == nil || parts[0].FunctionCall.Name != "get_weather" {
		t.Fatalf("mode ANY should call the allowed function: %s", raw)
	}
	var args map[string]any
	if err := json.Unmarshal(parts[0].FunctionCall.Args, &args); err != nil {
		t.Fatalf("args are an object: %v", err)
	}
	if _, ok := args["city"].(string); !ok {
		t.Fatalf("args follow the OBJECT/STRING schema: %s", parts[0].FunctionCall.Args)
	}
	if !strings.Contains(readCalls(t, srv.URL), `"dialect":"vertex"`) {
		t.Fatal("a /projects/ path should be recorded under the vertex dialect")
	}

	schema := `{"contents":[{"role":"user","parts":[{"text":"x"}]}],"generationConfig":{"responseMimeType":"application/json","responseSchema":{"type":"OBJECT","properties":{"n":{"type":"INTEGER"}},"required":["n"]}}}`
	_, raw = post(t, srv.URL+geminiPath, schema, nil)
	_ = json.Unmarshal([]byte(raw), &out)
	var obj map[string]any
	if err := json.Unmarshal([]byte(out.text()), &obj); err != nil {
		t.Fatalf("responseSchema should give JSON text: %v %s", err, raw)
	}
	if _, ok := obj["n"].(float64); !ok {
		t.Fatalf("the JSON follows the schema: %v", obj)
	}
}

// @scenario "A forced error on a path-named model answers in that provider's shape"
func TestGeminiErrorsUseThePathModel(t *testing.T) {
	srv := newTestServer(t)
	path := strings.Replace(geminiPath, "gemini-2.5-flash", "gemini-error-429", 1)
	resp, raw := post(t, srv.URL+path, `{"contents":[{"role":"user","parts":[{"text":"x"}]}]}`, nil)
	var out struct {
		Error struct {
			Code   int    `json:"code"`
			Status string `json:"status"`
		} `json:"error"`
	}
	_ = json.Unmarshal([]byte(raw), &out)
	if resp.StatusCode != http.StatusTooManyRequests || out.Error.Code != 429 || out.Error.Status != "RESOURCE_EXHAUSTED" {
		t.Fatalf("an error-429 model in the path should answer Google's 429: %d %s", resp.StatusCode, raw)
	}
}
