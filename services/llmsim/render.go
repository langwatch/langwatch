package llmsim

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	mrand "math/rand/v2"
	"net/http"
	"time"
)

func modelName(req request) string {
	if req.model == "" {
		return "llmsim"
	}
	return req.model
}

// writeOpenAI answers a chat-completions call, as one JSON body or as SSE
// chunks ending in [DONE], with a usage chunk when stream_options asks.
func (s *Server) writeOpenAI(w http.ResponseWriter, req request, rep reply) {
	head := openAIHead{id: "chatcmpl-" + rep.ID, created: time.Now().Unix(), model: modelName(req)}
	usage := map[string]int{"prompt_tokens": rep.In, "completion_tokens": rep.Out, "total_tokens": rep.In + rep.Out}
	if !req.stream {
		writeJSON(w, map[string]any{
			"id": head.id, "object": "chat.completion", "created": head.created, "model": head.model,
			"choices": []map[string]any{{"index": 0, "message": openAIMessage(rep), "finish_reason": rep.Finish, "logprobs": nil}},
			"usage":   usage,
		})
		return
	}
	startSSE(w)
	streamOpenAIChunks(w, head, rep)
	if req.includeUsage {
		sse(w, "", map[string]any{"id": head.id, "object": "chat.completion.chunk", "created": head.created, "model": head.model, "choices": []any{}, "usage": usage})
	}
	_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

// openAIHead is what every chat-completions body and chunk of one call repeats.
type openAIHead struct {
	id      string
	created int64
	model   string
}

// chunk is one chat.completion.chunk carrying delta.
func (h openAIHead) chunk(delta map[string]any, finish any) map[string]any {
	return map[string]any{
		"id": h.id, "object": "chat.completion.chunk", "created": h.created, "model": h.model,
		"choices": []map[string]any{{"index": 0, "delta": delta, "finish_reason": finish, "logprobs": nil}},
	}
}

// openAIMessage is the assistant message of a non-streamed reply.
func openAIMessage(rep reply) map[string]any {
	msg := map[string]any{"role": "assistant", "content": nil}
	if rep.Text != "" || len(rep.Calls) == 0 {
		msg["content"] = rep.Text
	}
	if len(rep.Calls) == 0 {
		return msg
	}
	calls := make([]map[string]any, 0, len(rep.Calls))
	for _, c := range rep.Calls {
		calls = append(calls, map[string]any{"id": "call_" + c.ID, "type": "function", "function": map[string]string{"name": c.Name, "arguments": c.Args}})
	}
	msg["tool_calls"] = calls
	return msg
}

// streamOpenAIChunks streams the role, the text, each tool call and the finish.
func streamOpenAIChunks(w http.ResponseWriter, head openAIHead, rep reply) {
	sse(w, "", head.chunk(map[string]any{"role": "assistant", "content": ""}, nil))
	for _, piece := range chunks(rep.Text) {
		sse(w, "", head.chunk(map[string]any{"content": piece}, nil))
	}
	for i, c := range rep.Calls {
		sse(w, "", head.chunk(map[string]any{"tool_calls": []map[string]any{{
			"index": i, "id": "call_" + c.ID, "type": "function", "function": map[string]string{"name": c.Name, "arguments": ""},
		}}}, nil))
		for _, piece := range chunks(c.Args) {
			sse(w, "", head.chunk(map[string]any{"tool_calls": []map[string]any{{"index": i, "function": map[string]string{"arguments": piece}}}}, nil))
		}
	}
	sse(w, "", head.chunk(map[string]any{}, rep.Finish))
}

var anthropicStop = map[string]string{"stop": "end_turn", "length": "max_tokens", "tool_calls": "tool_use"}

// writeAnthropic answers a messages call, as one JSON body or as the
// message_start ... message_stop event sequence.
func (s *Server) writeAnthropic(w http.ResponseWriter, req request, rep reply) {
	id, model, stop := "msg_"+rep.ID, modelName(req), anthropicStop[rep.Finish]
	usage := map[string]int{"input_tokens": rep.In, "output_tokens": rep.Out, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
	if !req.stream {
		blocks := anthropicBlocks(rep)
		writeJSON(w, map[string]any{
			"id": id, "type": "message", "role": "assistant", "model": model, "content": blocks,
			"stop_reason": stop, "stop_sequence": nil, "usage": usage,
		})
		return
	}

	startSSE(w)
	sse(w, "message_start", map[string]any{"type": "message_start", "message": map[string]any{
		"id": id, "type": "message", "role": "assistant", "model": model, "content": []any{},
		"stop_reason": nil, "stop_sequence": nil, "usage": map[string]int{"input_tokens": rep.In, "output_tokens": 1},
	}})
	streamAnthropicBlocks(w, rep)
	sse(w, "message_delta", map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": stop, "stop_sequence": nil}, "usage": map[string]int{"output_tokens": rep.Out}})
	sse(w, "message_stop", map[string]string{"type": "message_stop"})
}

// anthropicBlocks is the content of a non-streamed reply: its text, then its tool calls.
func anthropicBlocks(rep reply) []map[string]any {
	blocks := []map[string]any{}
	if rep.Text != "" {
		blocks = append(blocks, map[string]any{"type": "text", "text": rep.Text})
	}
	for _, c := range rep.Calls {
		blocks = append(blocks, map[string]any{"type": "tool_use", "id": "toolu_" + c.ID, "name": c.Name, "input": json.RawMessage(c.Args)})
	}
	return blocks
}

// streamAnthropicBlocks streams the text block, then one block per tool call.
func streamAnthropicBlocks(w http.ResponseWriter, rep reply) {
	index := 0
	if rep.Text != "" {
		sse(w, "content_block_start", map[string]any{"type": "content_block_start", "index": index, "content_block": map[string]string{"type": "text", "text": ""}})
		for _, piece := range chunks(rep.Text) {
			sse(w, "content_block_delta", map[string]any{"type": "content_block_delta", "index": index, "delta": map[string]string{"type": "text_delta", "text": piece}})
		}
		sse(w, "content_block_stop", map[string]any{"type": "content_block_stop", "index": index})
		index++
	}
	for _, c := range rep.Calls {
		sse(w, "content_block_start", map[string]any{"type": "content_block_start", "index": index, "content_block": map[string]any{
			"type": "tool_use", "id": "toolu_" + c.ID, "name": c.Name, "input": map[string]any{},
		}})
		for _, piece := range chunks(c.Args) {
			sse(w, "content_block_delta", map[string]any{"type": "content_block_delta", "index": index, "delta": map[string]string{"type": "input_json_delta", "partial_json": piece}})
		}
		sse(w, "content_block_stop", map[string]any{"type": "content_block_stop", "index": index})
		index++
	}
}

// chunks splits text for streaming: before each space, and every 24 bytes
// at a rune boundary, so a joined stream is exactly the text.
func chunks(s string) []string {
	var out []string
	start := 0
	for i, c := range s {
		if i > start && (c == ' ' || i-start >= 24) {
			out = append(out, s[start:i])
			start = i
		}
	}
	if start < len(s) {
		out = append(out, s[start:])
	}
	return out
}

// writeEmbeddings answers with one unit vector per input, drawn from a hash
// of the model and that input, at the requested dimensions (default 1536),
// as floats or as base64 little-endian float32 (the SDKs' default).
func writeEmbeddings(w http.ResponseWriter, body map[string]json.RawMessage) {
	model := str(body["model"])
	items := embeddingInputs(body["input"])
	dims := intOf(body["dimensions"])
	if dims <= 0 || dims > 8192 {
		dims = 1536
	}
	encode := str(body["encoding_format"]) == "base64"
	data := make([]map[string]any, 0, len(items))
	total := 0
	for i, item := range items {
		vec := embedding(model+"\x00"+item, dims)
		var out any = vec
		if encode {
			out = base64Floats(vec)
		}
		data = append(data, map[string]any{"object": "embedding", "index": i, "embedding": out})
		total += max(tokens(item), 1)
	}
	writeJSON(w, map[string]any{"object": "list", "data": data, "model": model, "usage": map[string]int{"prompt_tokens": total, "total_tokens": total}})
}

// embeddingInputs reads the input: one string, a list of strings (anything
// else encoded back as JSON), or a token array taken whole as one input.
func embeddingInputs(raw json.RawMessage) []string {
	var input any
	_ = json.Unmarshal(raw, &input)
	switch v := input.(type) {
	case string:
		return []string{v}
	case []any:
		return embeddingList(raw, v)
	}
	return nil
}

func embeddingList(raw json.RawMessage, v []any) []string {
	var items []string
	for _, e := range v {
		if _, numeric := e.(float64); numeric {
			return []string{string(raw)}
		}
		if text, ok := e.(string); ok {
			items = append(items, text)
			continue
		}
		b, _ := json.Marshal(e)
		items = append(items, string(b))
	}
	return items
}

// base64Floats is vec as base64 little-endian float32, the SDKs' default.
func base64Floats(vec []float32) string {
	buf := make([]byte, 4*len(vec))
	for j, f := range vec {
		binary.LittleEndian.PutUint32(buf[4*j:], math.Float32bits(f))
	}
	return base64.StdEncoding.EncodeToString(buf)
}

func embedding(key string, dims int) []float32 {
	sum := sha256.Sum256([]byte(key))
	//nolint:gosec // G404: a deterministic embedding per key, not a secret
	r := mrand.New(mrand.NewPCG(binary.LittleEndian.Uint64(sum[:8]), binary.LittleEndian.Uint64(sum[8:16])))
	vec := make([]float32, dims)
	norm := 0.0
	for i := range vec {
		v := r.NormFloat64()
		vec[i] = float32(v)
		norm += v * v
	}
	n := float32(math.Sqrt(norm))
	for i := range vec {
		vec[i] /= n
	}
	return vec
}
