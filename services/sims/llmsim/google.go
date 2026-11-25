package llmsim

import (
	"encoding/json"
	"net/http"
	"strings"
)

// isGooglePath is a Gemini (/v1beta/models/<m>:generateContent) or Vertex
// (/v1/projects/<p>/locations/<l>/publishers/google/models/<m>:generateContent) call.
func isGooglePath(path string) bool {
	return strings.HasSuffix(path, ":generateContent") || strings.HasSuffix(path, ":streamGenerateContent")
}

// modelInPath is the model a Gemini, Vertex or Bedrock path names; those
// wires carry it in the URL, not the body.
func modelInPath(r *http.Request) string {
	path := strings.TrimSuffix(r.URL.Path, "/")
	switch {
	case isGooglePath(path):
		name := path[strings.LastIndex(path, "/models/")+len("/models/"):]
		return name[:strings.LastIndex(name, ":")]
	case isBedrockPath(path):
		return bedrockModel(r)
	}
	return ""
}

type geminiPart struct {
	Text             string          `json:"text"`
	FunctionCall     *struct{}       `json:"functionCall"`
	FunctionResponse json.RawMessage `json:"functionResponse"`
}

// parseGemini reads a generateContent body; role "model" is the assistant.
func parseGemini(body map[string]json.RawMessage, model string, stream bool) request {
	req := request{model: model, stream: stream, includeUsage: true,
		seedBytes: append(append([]byte{}, body["systemInstruction"]...), body["contents"]...)}
	req.turns = geminiTurns(body)
	req.tools = geminiTools(body["tools"])
	applyGeminiToolConfig(&req, body["toolConfig"])
	applyGeminiGeneration(&req, body["generationConfig"])
	return req
}

// geminiTurns reads the system instruction and the contents.
func geminiTurns(body map[string]json.RawMessage) []turn {
	var turns []turn
	var system struct {
		Parts []geminiPart `json:"parts"`
	}
	_ = json.Unmarshal(body["systemInstruction"], &system)
	if text, _, _ := geminiParts(system.Parts); text != "" {
		turns = append(turns, turn{role: "system", text: text})
	}
	var contents []struct {
		Role  string       `json:"role"`
		Parts []geminiPart `json:"parts"`
	}
	_ = json.Unmarshal(body["contents"], &contents)
	for _, c := range contents {
		text, calls, results := geminiParts(c.Parts)
		role := c.Role
		switch {
		case role == "model":
			role = "assistant"
		case len(results) > 0:
			role = "tool"
		case role == "":
			role = "user"
		}
		turns = append(turns, turn{role: role, text: text, calls: calls, results: results})
	}
	return turns
}

// geminiTools reads functionDeclarations, in either schema spelling.
func geminiTools(raw json.RawMessage) []tool {
	var decls []struct {
		FunctionDeclarations []struct {
			Name                 string         `json:"name"`
			Parameters           map[string]any `json:"parameters"`
			ParametersJSONSchema map[string]any `json:"parametersJsonSchema"`
		} `json:"functionDeclarations"`
	}
	_ = json.Unmarshal(raw, &decls)
	var tools []tool
	for _, t := range decls {
		for _, f := range t.FunctionDeclarations {
			schema := f.ParametersJSONSchema
			if schema == nil {
				schema = lowerSchemaTypes(f.Parameters)
			}
			tools = append(tools, tool{name: f.Name, schema: schema})
		}
	}
	return tools
}

// applyGeminiToolConfig maps functionCallingConfig: ANY forces a call, NONE drops the tools.
func applyGeminiToolConfig(req *request, raw json.RawMessage) {
	var toolConfig struct {
		FunctionCallingConfig struct {
			Mode                 string   `json:"mode"`
			AllowedFunctionNames []string `json:"allowedFunctionNames"`
		} `json:"functionCallingConfig"`
	}
	_ = json.Unmarshal(raw, &toolConfig)
	switch fc := toolConfig.FunctionCallingConfig; strings.ToUpper(fc.Mode) {
	case "ANY":
		req.forced = "*"
		if len(fc.AllowedFunctionNames) == 1 {
			req.forced = fc.AllowedFunctionNames[0]
		}
	case "NONE":
		req.tools = nil
	}
}

// applyGeminiGeneration reads the token cap and structured output.
func applyGeminiGeneration(req *request, raw json.RawMessage) {
	var gen struct {
		MaxOutputTokens    int            `json:"maxOutputTokens"`
		ResponseMimeType   string         `json:"responseMimeType"`
		ResponseSchema     map[string]any `json:"responseSchema"`
		ResponseJSONSchema map[string]any `json:"responseJsonSchema"`
	}
	_ = json.Unmarshal(raw, &gen)
	req.maxTokens = gen.MaxOutputTokens
	req.schema = gen.ResponseJSONSchema
	if req.schema == nil && gen.ResponseSchema != nil {
		req.schema = lowerSchemaTypes(gen.ResponseSchema)
	}
	req.jsonObject = req.schema == nil && gen.ResponseMimeType == "application/json"
}

// geminiParts flattens parts the way content does for the other dialects.
func geminiParts(parts []geminiPart) (text string, calls int, results []string) {
	var texts []string
	for _, p := range parts {
		switch {
		case p.FunctionCall != nil:
			calls++
		case len(p.FunctionResponse) > 0:
			results = append(results, string(p.FunctionResponse))
		case p.Text != "":
			texts = append(texts, p.Text)
		}
	}
	return strings.Join(texts, "\n"), calls, results
}

// lowerSchemaTypes turns Gemini's OpenAPI subset (type "OBJECT") into the
// JSON Schema spelling the generator reads, all the way down.
func lowerSchemaTypes(schema map[string]any) map[string]any {
	if schema == nil {
		return nil
	}
	out, _ := lowerTypes(schema).(map[string]any)
	return out
}

func lowerTypes(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			out[k] = lowerTypes(val)
		}
		if s, ok := t["type"].(string); ok {
			out["type"] = strings.ToLower(s)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			out[i] = lowerTypes(val)
		}
		return out
	}
	return v
}

var geminiFinish = map[string]string{"stop": "STOP", "length": "MAX_TOKENS", "tool_calls": "STOP"}

// writeGemini answers generateContent with one GenerateContentResponse, or a
// stream of them: SSE when ?alt=sse, else a JSON array, as the API does.
func writeGemini(w http.ResponseWriter, req request, rep reply) {
	usage := map[string]int{"promptTokenCount": rep.In, "candidatesTokenCount": rep.Out, "totalTokenCount": rep.In + rep.Out}
	chunk := func(parts []map[string]any, final bool) map[string]any {
		candidate := map[string]any{"content": map[string]any{"role": "model", "parts": parts}, "index": 0}
		out := map[string]any{"candidates": []map[string]any{candidate}, "modelVersion": modelName(req), "responseId": rep.ID}
		if final {
			candidate["finishReason"] = geminiFinish[rep.Finish]
			out["usageMetadata"] = usage
		}
		return out
	}
	if !req.stream {
		writeJSON(w, chunk(geminiReplyParts(rep), true))
		return
	}
	// One chunk per text piece, then one carrying the calls; the last says how it ended.
	var pieces [][]map[string]any
	for _, piece := range chunks(rep.Text) {
		pieces = append(pieces, []map[string]any{{"text": piece}})
	}
	if calls := geminiReplyParts(reply{Calls: rep.Calls}); len(calls) > 0 || len(pieces) == 0 {
		pieces = append(pieces, calls)
	}
	stream := make([]map[string]any, len(pieces))
	for i, parts := range pieces {
		stream[i] = chunk(parts, i == len(pieces)-1)
	}
	if !req.altSSE {
		writeJSON(w, stream)
		return
	}
	startSSE(w)
	for _, c := range stream {
		sse(w, "", c)
	}
}

// geminiReplyParts is a reply's text part, then one functionCall part per call.
func geminiReplyParts(rep reply) []map[string]any {
	parts := []map[string]any{}
	if rep.Text != "" {
		parts = append(parts, map[string]any{"text": rep.Text})
	}
	for _, c := range rep.Calls {
		parts = append(parts, map[string]any{"functionCall": map[string]any{"id": c.ID, "name": c.Name, "args": json.RawMessage(c.Args)}})
	}
	return parts
}

// googleStatus is the canonical status name Google's error body carries.
var googleStatus = map[int]string{
	400: "INVALID_ARGUMENT", 401: "UNAUTHENTICATED", 403: "PERMISSION_DENIED", 404: "NOT_FOUND",
	409: "ABORTED", 429: "RESOURCE_EXHAUSTED", 499: "CANCELLED", 500: "INTERNAL", 501: "NOT_IMPLEMENTED",
	503: "UNAVAILABLE", 504: "DEADLINE_EXCEEDED",
}

// writeGoogleError answers {"error": {code, message, status}}, Google's shape.
func writeGoogleError(w http.ResponseWriter, status int, message string) {
	name, ok := googleStatus[status]
	if !ok {
		name = map[bool]string{true: "INTERNAL", false: "FAILED_PRECONDITION"}[status >= 500]
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": status, "message": message, "status": name}})
}
