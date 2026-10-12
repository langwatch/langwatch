package llmsim

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

type responsesBodyOut struct {
	Object string `json:"object"`
	Status string `json:"status"`
	Output []struct {
		Type      string `json:"type"`
		CallID    string `json:"call_id"`
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
		Content   []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"output"`
	Usage struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
		TotalTokens  int `json:"total_tokens"`
	} `json:"usage"`
}

func responses(t *testing.T, srv string, body string) responsesBodyOut {
	t.Helper()
	resp, raw := post(t, srv+"/v1/responses", body, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", resp.StatusCode, raw)
	}
	var out responsesBodyOut
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestResponsesNonStreamed(t *testing.T) {
	srv := newTestServer(t)
	out := responses(t, srv.URL, `{"model":"m","instructions":"Be brief.","input":"Hello there"}`)
	if out.Object != "response" || out.Status != "completed" || len(out.Output) != 1 || out.Output[0].Type != "message" {
		t.Fatalf("got %+v", out)
	}
	c := out.Output[0].Content
	if len(c) != 1 || c[0].Type != "output_text" || c[0].Text == "" {
		t.Fatalf("content %+v", c)
	}
	if out.Usage.InputTokens == 0 || out.Usage.OutputTokens == 0 || out.Usage.TotalTokens != out.Usage.InputTokens+out.Usage.OutputTokens {
		t.Fatalf("usage %+v", out.Usage)
	}
	again := responses(t, srv.URL, `{"model":"m","instructions":"Be brief.","input":"Hello there"}`)
	if again.Output[0].Content[0].Text != c[0].Text {
		t.Fatal("the answer is not deterministic")
	}
}

func TestResponsesStreamed(t *testing.T) {
	srv := newTestServer(t)
	whole := responses(t, srv.URL, `{"model":"m","input":[{"role":"user","content":[{"type":"input_text","text":"Hi"}]}]}`)
	resp, body := post(t, srv.URL+"/v1/responses", `{"model":"m","stream":true,"input":[{"role":"user","content":[{"type":"input_text","text":"Hi"}]}]}`, nil)
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type %q", ct)
	}
	events, data := sseData(t, body)
	order := []string{"response.created", "response.output_item.added", "response.output_text.delta", "response.output_text.done", "response.output_item.done", "response.completed"}
	at := 0
	for _, e := range events {
		if at < len(order) && e == order[at] {
			at++
		} else if at > 0 && at < len(order) && e == order[at-1] {
			continue
		}
	}
	if at != len(order) || events[len(events)-1] != "response.completed" {
		t.Fatalf("events %v", events)
	}
	var joined strings.Builder
	for i, e := range events {
		if e == "response.output_text.delta" {
			var d struct {
				Delta string `json:"delta"`
			}
			if err := json.Unmarshal([]byte(data[i]), &d); err != nil {
				t.Fatal(err)
			}
			joined.WriteString(d.Delta)
		}
	}
	if joined.String() != whole.Output[0].Content[0].Text {
		t.Fatalf("stream %q vs whole %q", joined.String(), whole.Output[0].Content[0].Text)
	}
	if !strings.Contains(data[len(data)-1], `"total_tokens"`) {
		t.Fatalf("completed event carries no usage: %s", data[len(data)-1])
	}
}

func TestResponsesForcedError(t *testing.T) {
	srv := newTestServer(t)
	resp, raw := post(t, srv.URL+"/v1/responses", `{"model":"gpt-error-429","input":"x"}`, nil)
	if resp.StatusCode != http.StatusTooManyRequests || resp.Header.Get("Retry-After") == "" || !strings.Contains(raw, `"rate_limit_error"`) {
		t.Fatalf("%d %s", resp.StatusCode, raw)
	}
	resp, _ = post(t, srv.URL+"/v1/responses", `{"model":"m","input":"x"}`, map[string]string{HeaderError: "500"})
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

func TestResponsesJSONSchemaAndTools(t *testing.T) {
	srv := newTestServer(t)
	out := responses(t, srv.URL, `{"model":"m","input":"Report","text":{"format":{"type":"json_schema","name":"r","schema":{"type":"object","required":["n","ok"],"properties":{"n":{"type":"integer","minimum":1,"maximum":5},"ok":{"type":"boolean"}}}}}}`)
	var got struct {
		N  int   `json:"n"`
		OK *bool `json:"ok"`
	}
	if err := json.Unmarshal([]byte(out.Output[0].Content[0].Text), &got); err != nil || got.N < 1 || got.N > 5 || got.OK == nil {
		t.Fatalf("schema output %q: %v", out.Output[0].Content[0].Text, err)
	}

	tools := `"tools":[{"type":"function","name":"get_weather","parameters":{"type":"object","required":["city"],"properties":{"city":{"type":"string"}}}}]`
	call := responses(t, srv.URL, `{"model":"m","input":"Weather?","tool_choice":"required",`+tools+`}`)
	if len(call.Output) != 1 || call.Output[0].Type != "function_call" || call.Output[0].Name != "get_weather" || !strings.HasPrefix(call.Output[0].CallID, "call_") {
		t.Fatalf("got %+v", call.Output)
	}
	if !json.Valid([]byte(call.Output[0].Arguments)) {
		t.Fatalf("arguments %q", call.Output[0].Arguments)
	}
	_, body := post(t, srv.URL+"/v1/responses", `{"model":"m","stream":true,"input":"Weather?","tool_choice":"required",`+tools+`}`, nil)
	events, _ := sseData(t, body)
	if !strings.Contains(strings.Join(events, ","), "response.function_call_arguments.done") {
		t.Fatalf("events %v", events)
	}
}
