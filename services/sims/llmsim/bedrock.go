package llmsim

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream"
)

// isBedrockPath is a Bedrock Converse call: /model/<modelId>/converse or /converse-stream.
func isBedrockPath(path string) bool {
	return strings.HasPrefix(path, "/model/") && (strings.HasSuffix(path, "/converse") || strings.HasSuffix(path, "/converse-stream"))
}

// bedrockModel is the model id from the escaped path, so an ARN's slashes stay in it.
func bedrockModel(r *http.Request) string {
	path := strings.TrimSuffix(strings.TrimPrefix(r.URL.EscapedPath(), "/model/"), "/")
	path = path[:strings.LastIndex(path, "/")]
	if id, err := url.PathUnescape(path); err == nil {
		return id
	}
	return path
}

type bedrockBlock struct {
	Text    string `json:"text"`
	ToolUse *struct {
		Name string `json:"name"`
	} `json:"toolUse"`
	ToolResult *struct {
		Content json.RawMessage `json:"content"`
	} `json:"toolResult"`
}

// parseBedrock reads a Converse body.
func parseBedrock(body map[string]json.RawMessage, model string, stream bool) request {
	req := request{model: model, stream: stream, includeUsage: true,
		seedBytes: append(append([]byte{}, body["system"]...), body["messages"]...)}
	var system []bedrockBlock
	_ = json.Unmarshal(body["system"], &system)
	if text, _, _ := bedrockBlocks(system); text != "" {
		req.turns = append(req.turns, turn{role: "system", text: text})
	}
	var msgs []struct {
		Role    string         `json:"role"`
		Content []bedrockBlock `json:"content"`
	}
	_ = json.Unmarshal(body["messages"], &msgs)
	for _, m := range msgs {
		text, calls, results := bedrockBlocks(m.Content)
		role := m.Role
		if role == "user" && len(results) > 0 && text == "" {
			role = "tool"
		}
		req.turns = append(req.turns, turn{role: role, text: text, calls: calls, results: results})
	}

	var inference struct {
		MaxTokens int `json:"maxTokens"`
	}
	_ = json.Unmarshal(body["inferenceConfig"], &inference)
	req.maxTokens = inference.MaxTokens

	var toolConfig struct {
		Tools []struct {
			ToolSpec struct {
				Name        string `json:"name"`
				InputSchema struct {
					JSON map[string]any `json:"json"`
				} `json:"inputSchema"`
			} `json:"toolSpec"`
		} `json:"tools"`
		ToolChoice struct {
			Any  *struct{} `json:"any"`
			Tool *struct {
				Name string `json:"name"`
			} `json:"tool"`
		} `json:"toolChoice"`
	}
	_ = json.Unmarshal(body["toolConfig"], &toolConfig)
	for _, t := range toolConfig.Tools {
		req.tools = append(req.tools, tool{name: t.ToolSpec.Name, schema: t.ToolSpec.InputSchema.JSON})
	}
	switch choice := toolConfig.ToolChoice; {
	case choice.Tool != nil:
		req.forced = choice.Tool.Name
	case choice.Any != nil:
		req.forced = "*"
	}
	return req
}

// bedrockBlocks flattens content blocks the way content does for the other dialects.
func bedrockBlocks(blocks []bedrockBlock) (text string, calls int, results []string) {
	var texts []string
	for _, b := range blocks {
		switch {
		case b.ToolUse != nil:
			calls++
		case b.ToolResult != nil:
			var parts []bedrockBlock
			_ = json.Unmarshal(b.ToolResult.Content, &parts)
			result, _, _ := bedrockBlocks(parts)
			if result == "" {
				result = string(b.ToolResult.Content)
			}
			results = append(results, result)
		case b.Text != "":
			texts = append(texts, b.Text)
		}
	}
	return strings.Join(texts, "\n"), calls, results
}

var bedrockStop = map[string]string{"stop": "end_turn", "length": "max_tokens", "tool_calls": "tool_use"}

// writeBedrock answers Converse with one JSON body, or ConverseStream with
// the AWS event stream (messageStart ... messageStop, then metadata).
func writeBedrock(w http.ResponseWriter, req request, rep reply) {
	usage := map[string]int{"inputTokens": rep.In, "outputTokens": rep.Out, "totalTokens": rep.In + rep.Out}
	metrics := map[string]int{"latencyMs": 0}
	if !req.stream {
		writeJSON(w, map[string]any{
			"output":     map[string]any{"message": map[string]any{"role": "assistant", "content": bedrockReplyBlocks(rep)}},
			"stopReason": bedrockStop[rep.Finish], "usage": usage, "metrics": metrics,
		})
		return
	}
	w.Header().Set("Content-Type", "application/vnd.amazon.eventstream")
	w.WriteHeader(http.StatusOK)
	enc := eventstream.NewEncoder()
	emit := func(event string, payload any) {
		b, _ := json.Marshal(payload)
		headers := eventstream.Headers{}
		headers.Set(":event-type", eventstream.StringValue(event))
		headers.Set(":content-type", eventstream.StringValue("application/json"))
		headers.Set(":message-type", eventstream.StringValue("event"))
		_ = enc.Encode(w, eventstream.Message{Headers: headers, Payload: b})
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
	emit("messageStart", map[string]string{"role": "assistant"})
	index := 0
	if rep.Text != "" {
		for _, piece := range chunks(rep.Text) {
			emit("contentBlockDelta", map[string]any{"contentBlockIndex": index, "delta": map[string]string{"text": piece}})
		}
		emit("contentBlockStop", map[string]int{"contentBlockIndex": index})
		index++
	}
	for _, c := range rep.Calls {
		emit("contentBlockStart", map[string]any{"contentBlockIndex": index, "start": map[string]any{"toolUse": map[string]string{"toolUseId": "tooluse_" + c.ID, "name": c.Name}}})
		for _, piece := range chunks(c.Args) {
			emit("contentBlockDelta", map[string]any{"contentBlockIndex": index, "delta": map[string]any{"toolUse": map[string]string{"input": piece}}})
		}
		emit("contentBlockStop", map[string]int{"contentBlockIndex": index})
		index++
	}
	emit("messageStop", map[string]string{"stopReason": bedrockStop[rep.Finish]})
	emit("metadata", map[string]any{"usage": usage, "metrics": metrics})
}

// bedrockReplyBlocks is a reply's text block, then one toolUse block per call.
func bedrockReplyBlocks(rep reply) []map[string]any {
	blocks := []map[string]any{}
	if rep.Text != "" {
		blocks = append(blocks, map[string]any{"text": rep.Text})
	}
	for _, c := range rep.Calls {
		blocks = append(blocks, map[string]any{"toolUse": map[string]any{"toolUseId": "tooluse_" + c.ID, "name": c.Name, "input": json.RawMessage(c.Args)}})
	}
	return blocks
}

// bedrockErrorType is the exception Bedrock names for a status.
var bedrockErrorType = map[int]string{
	400: "ValidationException", 403: "AccessDeniedException", 404: "ResourceNotFoundException",
	408: "ModelTimeoutException", 424: "ModelErrorException", 429: "ThrottlingException",
	500: "InternalServerException", 503: "ServiceUnavailableException",
}

// writeBedrockError answers as Bedrock does: the exception in X-Amzn-ErrorType, {"message"} in the body.
func writeBedrockError(w http.ResponseWriter, status int, message string) {
	kind, ok := bedrockErrorType[status]
	if !ok {
		kind = map[bool]string{true: "InternalServerException", false: "ValidationException"}[status >= 500]
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Amzn-ErrorType", kind)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": message})
}
