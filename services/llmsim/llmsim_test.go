package llmsim

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(NewServer(Config{Stack: "test"}).Handler())
	t.Cleanup(srv.Close)
	return srv
}

func post(t *testing.T, url, body string, headers map[string]string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

type chatCompletion struct {
	Choices []struct {
		Message struct {
			Content   *string `json:"content"`
			ToolCalls []struct {
				ID       string `json:"id"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

func chat(t *testing.T, srv *httptest.Server, body string, headers map[string]string) chatCompletion {
	t.Helper()
	resp, raw := post(t, srv.URL+"/v1/chat/completions", body, headers)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", resp.StatusCode, raw)
	}
	var out chatCompletion
	if err := json.Unmarshal([]byte(raw), &out); err != nil || len(out.Choices) != 1 {
		t.Fatalf("decoding %s: %v", raw, err)
	}
	return out
}

func text(c chatCompletion) string {
	if c.Choices[0].Message.Content == nil {
		return ""
	}
	return *c.Choices[0].Message.Content
}

const hello = `{"model":"markov-small","messages":[{"role":"user","content":"Say something."}]}`

// @scenario "The same prompt gets the same answer"
func TestSamePromptSameAnswer(t *testing.T) {
	srv := newTestServer(t)
	first, second := chat(t, srv, hello, nil), chat(t, srv, hello, nil)
	other := chat(t, srv, `{"model":"markov-small","messages":[{"role":"user","content":"Something else."}]}`, nil)
	if text(first) == "" || text(first) != text(second) {
		t.Fatalf("answers differ: %q vs %q", text(first), text(second))
	}
	if text(first) == text(other) {
		t.Fatalf("different prompts gave the same answer %q", text(first))
	}
	u := first.Usage
	if u.PromptTokens < 1 || u.CompletionTokens < 1 || u.TotalTokens != u.PromptTokens+u.CompletionTokens {
		t.Fatalf("usage %+v", u)
	}
}

// @scenario "A seed header pins or varies the answer"
func TestSeedHeader(t *testing.T) {
	srv := newTestServer(t)
	pinned := map[string]string{HeaderSeed: "42"}
	a := chat(t, srv, hello, pinned)
	b := chat(t, srv, `{"model":"markov-small","messages":[{"role":"user","content":"A different prompt."}]}`, pinned)
	if text(a) != text(b) {
		t.Fatalf("a pinned seed gave %q and %q", text(a), text(b))
	}
	seen := map[string]bool{}
	for range 5 {
		seen[text(chat(t, srv, hello, map[string]string{HeaderSeed: "random"}))] = true
	}
	if len(seen) < 2 {
		t.Fatalf("five random-seed calls gave one answer")
	}
}

// @scenario "max_tokens caps the answer"
func TestMaxTokens(t *testing.T) {
	srv := newTestServer(t)
	out := chat(t, srv, `{"model":"m","max_tokens":3,"messages":[{"role":"user","content":"Talk."}]}`, nil)
	if len(strings.Fields(text(out))) > 3 || out.Usage.CompletionTokens > 3 || out.Choices[0].FinishReason != "length" {
		t.Fatalf("got %q usage %+v finish %s", text(out), out.Usage, out.Choices[0].FinishReason)
	}
}

// sseData reads an SSE body into its event names and data payloads.
func sseData(t *testing.T, body string) (events, data []string) {
	t.Helper()
	sc := bufio.NewScanner(strings.NewReader(body))
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			events = append(events, strings.TrimPrefix(line, "event: "))
		case strings.HasPrefix(line, "data: "):
			data = append(data, strings.TrimPrefix(line, "data: "))
		case line != "":
			t.Fatalf("unexpected SSE line %q", line)
		}
	}
	return events, data
}

// @scenario "Streaming uses each provider's SSE framing"
func TestOpenAIStreamFraming(t *testing.T) {
	srv := newTestServer(t)
	whole := text(chat(t, srv, hello, nil))
	streamed := strings.Replace(hello, `{"model"`, `{"stream":true,"stream_options":{"include_usage":true},"model"`, 1)
	resp, body := post(t, srv.URL+"/v1/chat/completions", streamed, nil)
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type %q", ct)
	}
	_, data := sseData(t, body)
	if data[len(data)-1] != "[DONE]" {
		t.Fatalf("stream does not end in [DONE]: %v", data)
	}
	var joined strings.Builder
	var sawFinish, sawUsage bool
	for _, d := range data[:len(data)-1] {
		var chunk struct {
			Object  string `json:"object"`
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
			Usage *struct {
				TotalTokens int `json:"total_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal([]byte(d), &chunk); err != nil || chunk.Object != "chat.completion.chunk" {
			t.Fatalf("chunk %q: %v", d, err)
		}
		for _, c := range chunk.Choices {
			joined.WriteString(c.Delta.Content)
			sawFinish = sawFinish || (c.FinishReason != nil && *c.FinishReason == "stop")
		}
		sawUsage = sawUsage || (chunk.Usage != nil && chunk.Usage.TotalTokens > 0)
	}
	if joined.String() != whole || !sawFinish || !sawUsage {
		t.Fatalf("stream %q (finish %v usage %v) vs whole %q", joined.String(), sawFinish, sawUsage, whole)
	}
}

func TestAnthropicStreamFraming(t *testing.T) {
	srv := newTestServer(t)
	body := `{"model":"claude-x","max_tokens":200,"stream":true,"system":"Be brief.","messages":[{"role":"user","content":"Hi"}]}`
	_, raw := post(t, srv.URL+"/v1/messages", body, map[string]string{"anthropic-version": "2023-06-01"})
	events, data := sseData(t, raw)
	want := []string{"message_start", "content_block_start", "content_block_delta"}
	for i, e := range want {
		if events[i] != e {
			t.Fatalf("events %v", events)
		}
	}
	if events[len(events)-3] != "content_block_stop" || events[len(events)-2] != "message_delta" || events[len(events)-1] != "message_stop" {
		t.Fatalf("events %v", events)
	}
	if len(events) != len(data) {
		t.Fatalf("%d events for %d data lines", len(events), len(data))
	}
	if !strings.Contains(data[len(data)-2], `"stop_reason":"end_turn"`) {
		t.Fatalf("message_delta %s", data[len(data)-2])
	}
}

const weatherTool = `{"type":"function","function":{"name":"get_weather","parameters":{"type":"object","required":["city","unit"],"properties":{"city":{"type":"string"},"unit":{"enum":["c","f"]},"days":{"type":"integer","minimum":1,"maximum":7}}}}}`

// @scenario "A forced tool is called with arguments built from its schema"
func TestForcedToolCall(t *testing.T) {
	srv := newTestServer(t)
	body := `{"model":"m","tool_choice":"required","tools":[` + weatherTool + `],"messages":[{"role":"user","content":"Weather?"}]}`
	out := chat(t, srv, body, nil)
	calls := out.Choices[0].Message.ToolCalls
	if out.Choices[0].FinishReason != "tool_calls" || len(calls) != 1 || calls[0].Function.Name != "get_weather" || !strings.HasPrefix(calls[0].ID, "call_") {
		t.Fatalf("got %+v", out.Choices[0])
	}
	var args map[string]any
	if err := json.Unmarshal([]byte(calls[0].Function.Arguments), &args); err != nil {
		t.Fatal(err)
	}
	if _, ok := args["city"].(string); !ok || (args["unit"] != "c" && args["unit"] != "f") {
		t.Fatalf("args %v", args)
	}
	if d, ok := args["days"].(float64); ok && (d < 1 || d > 7 || d != float64(int(d))) {
		t.Fatalf("days %v", d)
	}
	if again := chat(t, srv, body, nil); again.Choices[0].Message.ToolCalls[0].Function.Arguments != calls[0].Function.Arguments {
		t.Fatalf("tool arguments are not deterministic")
	}
}

// @scenario "A json_schema response satisfies the schema"
func TestJSONSchemaOutput(t *testing.T) {
	srv := newTestServer(t)
	schema := `{"type":"object","required":["id","when","email","site","score","tags","owner","ok","kind"],"properties":{
		"id":{"type":"string","format":"uuid"},"when":{"type":"string","format":"date-time"},
		"email":{"type":"string","format":"email"},"site":{"type":"string","format":"uri"},
		"score":{"type":"number","minimum":0,"maximum":1},"tags":{"type":"array","items":{"type":"string","maxLength":5},"minItems":2,"maxItems":4},
		"owner":{"$ref":"#/$defs/person"},"ok":{"type":"boolean"},"kind":{"const":"report"},
		"note":{"type":["string","null"],"minLength":20}},
		"$defs":{"person":{"type":"object","required":["name","age"],"properties":{"name":{"type":"string"},"age":{"type":"integer","minimum":18,"maximum":99}}}}}`
	body := `{"model":"markov-json","response_format":{"type":"json_schema","json_schema":{"name":"r","schema":` + schema + `}},"messages":[{"role":"user","content":"Report."}]}`
	var got struct {
		ID    string   `json:"id"`
		When  string   `json:"when"`
		Email string   `json:"email"`
		Site  string   `json:"site"`
		Score float64  `json:"score"`
		Tags  []string `json:"tags"`
		Owner struct {
			Name string `json:"name"`
			Age  int    `json:"age"`
		} `json:"owner"`
		OK   *bool   `json:"ok"`
		Kind string  `json:"kind"`
		Note *string `json:"note"`
	}
	first := text(chat(t, srv, body, nil))
	if err := json.Unmarshal([]byte(first), &got); err != nil {
		t.Fatalf("%q: %v", first, err)
	}
	if _, err := time.Parse(time.RFC3339, got.When); err != nil {
		t.Fatal(err)
	}
	uuid := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	switch {
	case !uuid.MatchString(got.ID), !strings.HasSuffix(got.Email, "@example.com"), !strings.HasPrefix(got.Site, "https://"),
		got.Score < 0 || got.Score > 1, len(got.Tags) < 2 || len(got.Tags) > 4, got.Owner.Name == "",
		got.Owner.Age < 18 || got.Owner.Age > 99, got.OK == nil, got.Kind != "report", got.Note != nil && len(*got.Note) < 20:
		t.Fatalf("does not satisfy the schema: %s", first)
	}
	for _, tag := range got.Tags {
		if len(tag) > 5 {
			t.Fatalf("tag %q passes maxLength", tag)
		}
	}
	if second := text(chat(t, srv, body, nil)); second != first {
		t.Fatalf("same request, different JSON: %s vs %s", first, second)
	}
	other := strings.Replace(body, "Report.", "Another report.", 1)
	if third := text(chat(t, srv, other, nil)); third == first {
		t.Fatalf("different prompts gave the same JSON %s", first)
	}
}

// @scenario "Embeddings come back at the requested dimension"
func TestEmbeddings(t *testing.T) {
	srv := newTestServer(t)
	_, raw := post(t, srv.URL+"/v1/embeddings", `{"model":"e","input":["a","b"],"dimensions":64,"encoding_format":"float"}`, nil)
	var out struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil || len(out.Data) != 2 || len(out.Data[0].Embedding) != 64 {
		t.Fatalf("%s: %v", raw, err)
	}
	_, single := post(t, srv.URL+"/v1/embeddings", `{"model":"e","input":"a","dimensions":64}`, nil)
	var one struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
	}
	_ = json.Unmarshal([]byte(single), &one)
	if one.Data[0].Embedding[0] != out.Data[0].Embedding[0] || out.Data[0].Embedding[0] == out.Data[1].Embedding[0] {
		t.Fatalf("vectors are not a function of the input")
	}
	_, encoded := post(t, srv.URL+"/v1/embeddings", `{"model":"e","input":"a","encoding_format":"base64"}`, nil)
	var b64 struct {
		Data []struct {
			Embedding string `json:"embedding"`
		} `json:"data"`
	}
	_ = json.Unmarshal([]byte(encoded), &b64)
	if bytes, err := base64.StdEncoding.DecodeString(b64.Data[0].Embedding); err != nil || len(bytes) != 4*1536 {
		t.Fatalf("base64 embedding: %d bytes, %v", len(bytes), err)
	}
}

// @scenario "A forced error answers in the provider's shape"
func TestErrorInjection(t *testing.T) {
	srv := newTestServer(t)
	resp, raw := post(t, srv.URL+"/v1/chat/completions", `{"model":"gpt-error-429","messages":[]}`, nil)
	if resp.StatusCode != http.StatusTooManyRequests || resp.Header.Get("Retry-After") == "" || !strings.Contains(raw, `"rate_limit_error"`) {
		t.Fatalf("%d %s", resp.StatusCode, raw)
	}
	resp, raw = post(t, srv.URL+"/v1/messages", `{"model":"claude","max_tokens":5,"messages":[]}`, map[string]string{HeaderError: "500"})
	if resp.StatusCode != http.StatusInternalServerError || !strings.Contains(raw, `"type":"error"`) {
		t.Fatalf("%d %s", resp.StatusCode, raw)
	}
}

func langyTurn(messages string) string {
	return `{"model":"langy-echo","tools":[` + weatherTool + `,{"type":"function","function":{"name":"search_traces","parameters":{"type":"object"}}}],"messages":` + messages + `}`
}

// @scenario "Langy mode echoes a plain message"
func TestLangyEcho(t *testing.T) {
	srv := newTestServer(t)
	out := chat(t, srv, langyTurn(`[{"role":"user","content":"Hello  there,\nLangy!"}]`), nil)
	if text(out) != "Hello  there,\nLangy!" || len(out.Choices[0].Message.ToolCalls) != 0 {
		t.Fatalf("got %+v", out.Choices[0])
	}
	streamed := `{"stream":true,"model":"x","messages":[{"role":"user","content":"echo me"}]}`
	_, body := post(t, srv.URL+"/v1/chat/completions", streamed, map[string]string{HeaderMode: "langy"})
	if !strings.Contains(body, `"echo"`) || !strings.Contains(body, `" me"`) {
		t.Fatalf("stream %s", body)
	}
}

// @scenario "Langy mode makes the tool calls the message names"
func TestLangyToolCalls(t *testing.T) {
	srv := newTestServer(t)
	one := chat(t, srv, langyTurn(`[{"role":"user","content":"/tool search_traces {\"query\":\"x\"}"}]`), nil)
	calls := one.Choices[0].Message.ToolCalls
	if len(calls) != 1 || calls[0].Function.Name != "search_traces" || calls[0].Function.Arguments != `{"query":"x"}` {
		t.Fatalf("got %+v", one.Choices[0])
	}
	two := chat(t, srv, langyTurn(`[{"role":"user","content":"Looking.\n/tool search_traces {\"query\":\"x\"}\n/tool get_weather {\"city\":\"Oslo\",\"unit\":\"c\"}"}]`), nil)
	calls = two.Choices[0].Message.ToolCalls
	if len(calls) != 2 || calls[1].Function.Name != "get_weather" || calls[1].Function.Arguments != `{"city":"Oslo","unit":"c"}` || text(two) != "Looking." {
		t.Fatalf("got %+v", two.Choices[0])
	}
}

// @scenario "Langy mode echoes a tool result back"
func TestLangyToolResultEcho(t *testing.T) {
	srv := newTestServer(t)
	script := `{"role":"user","content":"/tool search_traces {}\n/next\n/tool get_weather {\"city\":\"Oslo\",\"unit\":\"c\"}"}`
	firstCall := `{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"search_traces","arguments":"{}"}}]}`
	followUp := chat(t, srv, langyTurn(`[`+script+`,`+firstCall+`,{"role":"tool","tool_call_id":"call_1","content":"3 traces"}]`), nil)
	if calls := followUp.Choices[0].Message.ToolCalls; len(calls) != 1 || calls[0].Function.Name != "get_weather" {
		t.Fatalf("the /next step did not run: %+v", followUp.Choices[0])
	}
	secondCall := `{"role":"assistant","content":null,"tool_calls":[{"id":"call_2","type":"function","function":{"name":"get_weather","arguments":"{}"}}]}`
	final := chat(t, srv, langyTurn(`[`+script+`,`+firstCall+`,{"role":"tool","tool_call_id":"call_1","content":"3 traces"},`+secondCall+`,{"role":"tool","tool_call_id":"call_2","content":"sunny"}]`), nil)
	if text(final) != "sunny" || final.Choices[0].FinishReason != "stop" {
		t.Fatalf("got %+v", final.Choices[0])
	}

	anthropic := `{"model":"langy-echo","max_tokens":100,"tools":[{"name":"search_traces","input_schema":{"type":"object"}}],"messages":[
		{"role":"user","content":"/tool search_traces {}"},
		{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"search_traces","input":{}}]},
		{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"found 2"}]}]}`
	_, raw := post(t, srv.URL+"/v1/messages", anthropic, nil)
	if !strings.Contains(raw, `"text":"found 2"`) || !strings.Contains(raw, `"stop_reason":"end_turn"`) {
		t.Fatalf("anthropic %s", raw)
	}
}

// @scenario "Langy mode refuses a tool the request does not offer"
func TestLangyUnknownTool(t *testing.T) {
	srv := newTestServer(t)
	out := chat(t, srv, langyTurn(`[{"role":"user","content":"/tool drop_database {}"}]`), nil)
	if len(out.Choices[0].Message.ToolCalls) != 0 || !strings.Contains(text(out), `tool "drop_database" is not offered`) {
		t.Fatalf("got %+v", out.Choices[0])
	}
}

// @scenario "The console lists recent calls and applies its settings"
func TestConsoleRecordsCallsAndSettings(t *testing.T) {
	srv := newTestServer(t)
	chat(t, srv, hello, nil)
	get := func(path string) string {
		req, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+path, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()
		b, _ := io.ReadAll(resp.Body)
		return string(b)
	}
	var list struct {
		Calls []record `json:"calls"`
	}
	_ = json.Unmarshal([]byte(get("/_sim/api/calls")), &list)
	if len(list.Calls) != 1 || list.Calls[0].Mode != "markov" || list.Calls[0].Request != nil {
		t.Fatalf("calls %+v", list.Calls)
	}
	if detail := get("/_sim/api/calls/" + list.Calls[0].ID); !strings.Contains(detail, `"Say something."`) || !strings.Contains(detail, `"response"`) {
		t.Fatalf("detail %s", detail)
	}
	req, _ := http.NewRequestWithContext(t.Context(), http.MethodPut, srv.URL+"/_sim/api/settings", strings.NewReader(`{"forcedError":503}`))
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT settings: %v", err)
	}
	_ = resp.Body.Close()
	if resp, _ := post(t, srv.URL+"/v1/chat/completions", hello, nil); resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("forced error setting not applied: %d", resp.StatusCode)
	}
}

func TestRingKeepsTheNewest(t *testing.T) {
	r := newRing(3)
	for _, m := range []string{"a", "b", "c", "d", "e"} {
		r.add(record{Model: m})
	}
	got := r.newest()
	if len(got) != 3 || got[0].Model != "e" || got[2].Model != "c" {
		t.Fatalf("ring %+v", got)
	}
}
