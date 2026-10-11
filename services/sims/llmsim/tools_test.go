package llmsim

import (
	"encoding/json"
	"strings"
	"testing"
)

const searchTool = `{"type":"function","function":{"name":"search_traces","parameters":{"type":"object","required":["query"],"properties":{"query":{"type":"string"}}}}}`

func toolsChat(model, messages string) string {
	return `{"model":"` + model + `","tool_choice":"auto","tools":[` + weatherTool + `,` + searchTool + `],"messages":` + messages + `}`
}

// @scenario "Tools mode calls a tool on an auto tool choice"
func TestToolsModeCallsOnAuto(t *testing.T) {
	srv := newTestServer(t)
	for i, prompt := range []string{"Hi.", "Anything new?", "Tell me more.", "Go on."} {
		body := toolsChat("markov-tools", `[{"role":"user","content":"`+prompt+`"}]`)
		out := chat(t, srv, body, nil)
		calls := out.Choices[0].Message.ToolCalls
		if out.Choices[0].FinishReason != "tool_calls" || len(calls) != 1 {
			t.Fatalf("prompt %d: no tool call: %+v", i, out.Choices[0])
		}
		if !json.Valid([]byte(calls[0].Function.Arguments)) {
			t.Fatalf("arguments %q", calls[0].Function.Arguments)
		}
		if again := chat(t, srv, body, nil); again.Choices[0].Message.ToolCalls[0].Function.Name != calls[0].Function.Name {
			t.Fatalf("tool pick is not deterministic")
		}
	}
	header := chat(t, srv, toolsChat("markov-small", `[{"role":"user","content":"Hi."}]`), map[string]string{HeaderTools: "auto"})
	if len(header.Choices[0].Message.ToolCalls) != 1 {
		t.Fatalf("X-Llmsim-Tools: auto made no call: %+v", header.Choices[0])
	}
}

// @scenario "Tools mode calls the tool the user message names"
func TestToolsModeHonoursANameHint(t *testing.T) {
	srv := newTestServer(t)
	for _, want := range []string{"get_weather", "search_traces"} {
		out := chat(t, srv, toolsChat("markov-tools", `[{"role":"user","content":"Please use `+want+` now."}]`), nil)
		calls := out.Choices[0].Message.ToolCalls
		if len(calls) != 1 || calls[0].Function.Name != want {
			t.Fatalf("want %s, got %+v", want, out.Choices[0])
		}
		var args map[string]any
		if err := json.Unmarshal([]byte(calls[0].Function.Arguments), &args); err != nil {
			t.Fatal(err)
		}
		if want == "search_traces" {
			if _, ok := args["query"].(string); !ok {
				t.Fatalf("args %v", args)
			}
		}
	}
}

// @scenario "Tools mode answers text after a tool result"
func TestToolsModeAnswersTextAfterAResult(t *testing.T) {
	srv := newTestServer(t)
	msgs := `[{"role":"user","content":"Use search_traces."},
		{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"search_traces","arguments":"{}"}}]},
		{"role":"tool","tool_call_id":"call_1","content":"3 traces"}]`
	out := chat(t, srv, toolsChat("markov-tools", msgs), nil)
	if len(out.Choices[0].Message.ToolCalls) != 0 || text(out) == "" {
		t.Fatalf("got %+v", out.Choices[0])
	}

	tools := `"tools":[{"type":"function","name":"search_traces","parameters":{"type":"object","required":["query"],"properties":{"query":{"type":"string"}}}}]`
	call := responses(t, srv.URL, `{"model":"markov-tools","input":"Find them.","tool_choice":"auto",`+tools+`}`)
	if len(call.Output) != 1 || call.Output[0].Type != "function_call" || call.Output[0].Name != "search_traces" {
		t.Fatalf("responses call %+v", call.Output)
	}
	after := responses(t, srv.URL, `{"model":"markov-tools","tool_choice":"auto",`+tools+`,"input":[
		{"role":"user","content":"Find them."},
		{"type":"function_call","call_id":"call_1","name":"search_traces","arguments":"{}"},
		{"type":"function_call_output","call_id":"call_1","output":"3 traces"}]}`)
	if len(after.Output) != 1 || after.Output[0].Type != "message" {
		t.Fatalf("responses after %+v", after.Output)
	}

	anthropicTools := `"tools":[{"name":"search_traces","input_schema":{"type":"object","required":["query"],"properties":{"query":{"type":"string"}}}}]`
	_, raw := post(t, srv.URL+"/v1/messages", `{"model":"markov-tools","max_tokens":100,`+anthropicTools+`,"messages":[{"role":"user","content":"Find them."}]}`, nil)
	if !strings.Contains(raw, `"type":"tool_use"`) || !strings.Contains(raw, `"stop_reason":"tool_use"`) {
		t.Fatalf("anthropic call %s", raw)
	}
	_, raw = post(t, srv.URL+"/v1/messages", `{"model":"markov-tools","max_tokens":100,`+anthropicTools+`,"messages":[
		{"role":"user","content":"Find them."},
		{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"search_traces","input":{}}]},
		{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"found 2"}]}]}`, nil)
	if strings.Contains(raw, `"type":"tool_use"`) || !strings.Contains(raw, `"type":"text"`) {
		t.Fatalf("anthropic after %s", raw)
	}
}
