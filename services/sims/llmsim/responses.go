package llmsim

import (
	"encoding/json"
	"net/http"
	"time"
)

// parseResponses reads an OpenAI Responses API body: input is a string or a
// list of messages, function calls and function call outputs.
func parseResponses(body map[string]json.RawMessage) request {
	req := request{
		model:        str(body["model"]),
		seedBytes:    append(append([]byte{}, body["instructions"]...), body["input"]...),
		maxTokens:    intOf(body["max_output_tokens"]),
		stream:       boolOf(body["stream"]),
		includeUsage: true,
	}
	if system := str(body["instructions"]); system != "" {
		req.turns = append(req.turns, turn{role: "system", text: system})
	}
	req.turns = append(req.turns, responsesTurns(body["input"])...)

	var tools []struct {
		Type       string         `json:"type"`
		Name       string         `json:"name"`
		Parameters map[string]any `json:"parameters"`
	}
	_ = json.Unmarshal(body["tools"], &tools)
	for _, t := range tools {
		if t.Type == "function" {
			req.tools = append(req.tools, tool{name: t.Name, schema: t.Parameters})
		}
	}
	applyResponsesToolChoice(&req, body["tool_choice"])

	var text struct {
		Format struct {
			Type   string         `json:"type"`
			Schema map[string]any `json:"schema"`
		} `json:"format"`
	}
	_ = json.Unmarshal(body["text"], &text)
	switch text.Format.Type {
	case "json_schema":
		req.schema = text.Format.Schema
		req.jsonObject = req.schema == nil
	case "json_object":
		req.jsonObject = true
	}
	return req
}

func responsesTurns(raw json.RawMessage) []turn {
	if s := str(raw); s != "" {
		return []turn{{role: "user", text: s}}
	}
	var items []struct {
		Type    string          `json:"type"`
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
		Output  json.RawMessage `json:"output"`
	}
	_ = json.Unmarshal(raw, &items)
	var turns []turn
	for _, it := range items {
		switch it.Type {
		case "function_call":
			turns = append(turns, turn{role: "assistant", calls: 1})
		case "function_call_output":
			out, _, _ := content(it.Output)
			turns = append(turns, turn{role: "tool", results: []string{out}})
		default:
			text, _, _ := content(it.Content)
			role := it.Role
			if role == "developer" {
				role = "system"
			}
			turns = append(turns, turn{role: role, text: text})
		}
	}
	return turns
}

// applyResponsesToolChoice forces a tool ("required" or a named function) or
// withdraws them all ("none").
func applyResponsesToolChoice(req *request, raw json.RawMessage) {
	var choice any
	_ = json.Unmarshal(raw, &choice)
	switch c := choice.(type) {
	case string:
		switch c {
		case "required":
			req.forced = "*"
		case "none":
			req.tools = nil
		}
	case map[string]any:
		req.forced, _ = c["name"].(string)
	}
}

// responsesItems are the output items of a reply: its message, then its function calls.
func responsesItems(rep reply, status string) []map[string]any {
	items := []map[string]any{}
	if rep.Text != "" || len(rep.Calls) == 0 {
		items = append(items, responsesMessage(rep, status))
	}
	for _, c := range rep.Calls {
		items = append(items, responsesCall(c, status))
	}
	return items
}

func responsesMessage(rep reply, status string) map[string]any {
	return map[string]any{
		"id": "msg_" + rep.ID, "type": "message", "role": "assistant", "status": status,
		"content": []map[string]any{{"type": "output_text", "text": rep.Text, "annotations": []any{}}},
	}
}

func responsesCall(c call, status string) map[string]any {
	return map[string]any{"id": "fc_" + c.ID, "type": "function_call", "call_id": "call_" + c.ID, "name": c.Name, "arguments": c.Args, "status": status}
}

// responsesOutput is the output and status a response object carries.
type responsesOutput struct {
	items  []any
	status string
}

// responsesBody is the response object, with the given output and status.
func responsesBody(req request, rep reply, out responsesOutput) map[string]any {
	output, status := out.items, out.status
	body := map[string]any{
		"id": "resp_" + rep.ID, "object": "response", "created_at": time.Now().Unix(), "status": status,
		"model": modelName(req), "output": output, "error": nil, "incomplete_details": nil,
		"parallel_tool_calls": true, "tool_choice": "auto", "tools": []any{},
	}
	if status == "completed" || status == "incomplete" {
		body["usage"] = map[string]any{
			"input_tokens": rep.In, "input_tokens_details": map[string]int{"cached_tokens": 0},
			"output_tokens": rep.Out, "output_tokens_details": map[string]int{"reasoning_tokens": 0},
			"total_tokens": rep.In + rep.Out,
		}
	}
	if status == "incomplete" {
		body["incomplete_details"] = map[string]string{"reason": "max_output_tokens"}
	}
	return body
}

// writeResponses answers a Responses call, as one JSON body or as the
// response.created ... response.completed event sequence.
func (s *Server) writeResponses(w http.ResponseWriter, req request, rep reply) {
	status := "completed"
	if rep.Finish == "length" {
		status = "incomplete"
	}
	items := responsesItems(rep, status)
	output := make([]any, len(items))
	for i, it := range items {
		output[i] = it
	}
	if !req.stream {
		writeJSON(w, responsesBody(req, rep, responsesOutput{output, status}))
		return
	}
	startSSE(w)
	seq := 0
	emit := func(typ string, fields map[string]any) {
		fields["type"], fields["sequence_number"] = typ, seq
		seq++
		sse(w, typ, fields)
	}
	emit("response.created", map[string]any{"response": responsesBody(req, rep, responsesOutput{[]any{}, "in_progress"})})
	emit("response.in_progress", map[string]any{"response": responsesBody(req, rep, responsesOutput{[]any{}, "in_progress"})})
	for i, it := range items {
		streamResponsesItem(emit, i, it)
	}
	emit("response.completed", map[string]any{"response": responsesBody(req, rep, responsesOutput{output, status})})
}

// streamResponsesItem streams one output item: a message's text pieces, or a
// function call's argument pieces.
func streamResponsesItem(emit func(string, map[string]any), index int, item map[string]any) {
	inProgress := map[string]any{}
	for k, v := range item {
		inProgress[k] = v
	}
	inProgress["status"] = "in_progress"
	id, _ := item["id"].(string)
	if item["type"] == "function_call" {
		inProgress["arguments"] = ""
		emit("response.output_item.added", map[string]any{"output_index": index, "item": inProgress})
		args, _ := item["arguments"].(string)
		for _, piece := range chunks(args) {
			emit("response.function_call_arguments.delta", map[string]any{"output_index": index, "item_id": id, "delta": piece})
		}
		emit("response.function_call_arguments.done", map[string]any{"output_index": index, "item_id": id, "arguments": args})
		emit("response.output_item.done", map[string]any{"output_index": index, "item": item})
		return
	}
	inProgress["content"] = []any{}
	emit("response.output_item.added", map[string]any{"output_index": index, "item": inProgress})
	var text string
	if parts, ok := item["content"].([]map[string]any); ok && len(parts) > 0 {
		text, _ = parts[0]["text"].(string)
	}
	empty := map[string]any{"type": "output_text", "text": "", "annotations": []any{}}
	full := map[string]any{"type": "output_text", "text": text, "annotations": []any{}}
	emit("response.content_part.added", map[string]any{"output_index": index, "item_id": id, "content_index": 0, "part": empty})
	for _, piece := range chunks(text) {
		emit("response.output_text.delta", map[string]any{"output_index": index, "item_id": id, "content_index": 0, "delta": piece})
	}
	emit("response.output_text.done", map[string]any{"output_index": index, "item_id": id, "content_index": 0, "text": text})
	emit("response.content_part.done", map[string]any{"output_index": index, "item_id": id, "content_index": 0, "part": full})
	emit("response.output_item.done", map[string]any{"output_index": index, "item": item})
}
