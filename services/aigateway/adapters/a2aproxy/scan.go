package a2aproxy

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Direction says which way the scanned text travels.
type Direction string

// Directions, named as the guardrail config names them.
const (
	DirectionRequest  Direction = "request"
	DirectionResponse Direction = "response"
)

// ScanInput is the text of one A2A payload and who sent it.
type ScanInput struct {
	Bundle    *domain.Bundle
	Direction Direction
	Texts     []string
}

// Scanner checks the text parts of A2A messages. A block verdict stops the hop.
type Scanner interface {
	Scan(ctx context.Context, in ScanInput) (domain.GuardrailVerdict, error)
}

// NoopScanner allows everything.
type NoopScanner struct{}

// Scan allows the text.
func (NoopScanner) Scan(context.Context, ScanInput) (domain.GuardrailVerdict, error) {
	return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, nil
}

// guardrailEvaluator is the part of app.GuardrailEvaluator the scanner uses.
type guardrailEvaluator interface {
	EvaluatePre(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (domain.GuardrailVerdict, error)
	EvaluatePost(ctx context.Context, bundle *domain.Bundle, req *domain.Request, resp *domain.Response) (domain.GuardrailVerdict, error)
}

// GuardrailScanner runs the caller key's model-call guardrails over A2A text,
// presented as a chat message so the same policies apply unchanged.
type GuardrailScanner struct {
	Evaluator guardrailEvaluator
}

// Scan runs the key's request or response guardrails over the text. A key
// with no guardrail in that direction is allowed without a call.
func (s GuardrailScanner) Scan(ctx context.Context, in ScanInput) (domain.GuardrailVerdict, error) {
	bundle, dir, texts := in.Bundle, in.Direction, in.Texts
	allow := domain.GuardrailVerdict{Action: domain.GuardrailAllow}
	if len(bundle.Config.Guardrails.IDs(string(dir))) == 0 {
		return allow, nil
	}
	text := strings.Join(texts, "\n")
	if dir == DirectionRequest {
		body, _ := json.Marshal(map[string]any{"messages": []map[string]string{{"role": "user", "content": text}}})
		return s.Evaluator.EvaluatePre(ctx, bundle, &domain.Request{Body: body})
	}
	body, _ := json.Marshal(map[string]any{"choices": []map[string]any{{"message": map[string]string{"role": "assistant", "content": text}}}})
	return s.Evaluator.EvaluatePost(ctx, bundle, &domain.Request{}, &domain.Response{Body: body})
}

// collectTexts returns the text of every part found anywhere in an A2A
// payload: message parts, task history and artifacts, in v1.0 and v0.3 shapes.
func collectTexts(body []byte) []string {
	var v any
	if json.Unmarshal(body, &v) != nil {
		return nil
	}
	var out []string
	walkTexts(v, false, &out)
	return out
}

func walkTexts(node any, inParts bool, out *[]string) {
	switch n := node.(type) {
	case map[string]any:
		if t, ok := n["text"].(string); inParts && ok && t != "" {
			*out = append(*out, t)
		}
		for k, child := range n {
			walkTexts(child, k == "parts", out)
		}
	case []any:
		for _, child := range n {
			walkTexts(child, inParts, out)
		}
	}
}

// readEvents splits an SSE body into events, each with its trailing blank
// line, and stops when fn returns false.
func readEvents(r io.Reader, fn func(event []byte) bool) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64<<10), maxEventBytes)
	var event bytes.Buffer
	for sc.Scan() {
		if line := sc.Bytes(); len(line) > 0 {
			event.Write(line)
			event.WriteByte('\n')
			continue
		}
		if event.Len() == 0 {
			continue
		}
		event.WriteByte('\n')
		if !fn(append([]byte(nil), event.Bytes()...)) {
			return nil
		}
		event.Reset()
	}
	if event.Len() > 0 {
		fn(event.Bytes())
	}
	return sc.Err()
}

// eventData joins the data lines of one SSE event.
func eventData(event []byte) []byte {
	var data bytes.Buffer
	for _, line := range bytes.Split(event, []byte("\n")) {
		if v, ok := bytes.CutPrefix(line, []byte("data:")); ok {
			data.Write(bytes.TrimPrefix(v, []byte(" ")))
			data.WriteByte('\n')
		}
	}
	return data.Bytes()
}

func lookup(v any, path ...string) any {
	for _, p := range path {
		m, ok := v.(map[string]any)
		if !ok {
			return nil
		}
		v = m[p]
	}
	return v
}

func setString(span trace.Span, key string, v any) {
	if s, ok := v.(string); ok && s != "" {
		span.SetAttributes(attribute.String(key, s))
	}
}

// setMessageAttrs records the ids of the outgoing message.
func setMessageAttrs(span trace.Span, body []byte) {
	var v any
	if json.Unmarshal(body, &v) != nil {
		return
	}
	msg := lookup(v, "params", "message")
	if msg == nil {
		msg = lookup(v, "message")
	}
	setString(span, attrMessageID, lookup(msg, "messageId"))
	setString(span, attrContextID, lookup(msg, "contextId"))
	setString(span, attrTaskID, lookup(msg, "taskId"))
}

// setResultAttrs records the task the reply names, for JSON-RPC and
// HTTP+JSON replies and stream events alike.
func setResultAttrs(span trace.Span, body []byte) {
	var v any
	if json.Unmarshal(body, &v) != nil {
		return
	}
	if r := lookup(v, "result"); r != nil {
		v = r
	}
	for _, key := range []string{"task", "statusUpdate", "artifactUpdate"} {
		if inner := lookup(v, key); inner != nil {
			v = inner
			break
		}
	}
	id := lookup(v, "taskId")
	if id == nil {
		id = lookup(v, "id")
	}
	setString(span, attrTaskID, id)
	setString(span, attrContextID, lookup(v, "contextId"))
	setString(span, attrTaskState, lookup(v, "status", "state"))
}
