package a2aproxy

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"unicode/utf8"

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
	// Applies reports whether the caller's key scans payloads going this way.
	// When it does, a payload the proxy cannot read as JSON is refused.
	Applies(bundle *domain.Bundle, dir Direction) bool
	Scan(ctx context.Context, in ScanInput) (domain.GuardrailVerdict, error)
}

// NoopScanner allows everything.
type NoopScanner struct{}

// Applies is false: nothing is scanned.
func (NoopScanner) Applies(*domain.Bundle, Direction) bool { return false }

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

// Applies reports whether the key has a guardrail in that direction.
func (GuardrailScanner) Applies(bundle *domain.Bundle, dir Direction) bool {
	return bundle != nil && len(bundle.Config.Guardrails.IDs(string(dir))) > 0
}

// Scan runs the key's request or response guardrails over the text. A key
// with no guardrail in that direction is allowed without a call.
func (s GuardrailScanner) Scan(ctx context.Context, in ScanInput) (domain.GuardrailVerdict, error) {
	bundle, dir, texts := in.Bundle, in.Direction, in.Texts
	allow := domain.GuardrailVerdict{Action: domain.GuardrailAllow}
	if !s.Applies(bundle, dir) {
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

// payload is what the scanner sees of one body: its text, and whether the
// body could be read at all.
type payload struct {
	texts []string
	// parsed is false for a non-empty body that is not JSON.
	parsed bool
}

// maxJSONDepth bounds how deep the scan walks one body.
const maxJSONDepth = 64

var errTooDeep = errors.New("the JSON nests too deeply")

// protocolValueKeys hold ids and enum values, never content the guardrail needs.
var protocolValueKeys = map[string]bool{
	"jsonrpc": true, "method": true, "id": true, "messageId": true, "contextId": true,
	"taskId": true, "artifactId": true, "role": true, "kind": true, "mediaType": true,
	"mimeType": true, "state": true, "timestamp": true,
}

// protocolKeys are A2A field names. Any other object key is content (a data
// part's own fields) and is scanned as text.
var protocolKeys = map[string]bool{
	"params": true, "message": true, "parts": true, "text": true, "data": true, "file": true,
	"raw": true, "bytes": true, "url": true, "uri": true, "name": true, "filename": true,
	"metadata": true, "extensions": true, "referenceTaskIds": true, "configuration": true,
	"acceptedOutputModes": true, "historyLength": true, "blocking": true, "result": true,
	"task": true, "status": true, "history": true, "artifacts": true, "artifact": true,
	"description": true, "append": true, "lastChunk": true, "final": true, "statusUpdate": true,
	"artifactUpdate": true, "error": true, "code": true, "tenant": true, "returnImmediately": true,
	"pushNotificationConfig": true, "reason": true,
}

// collectTexts returns every piece of text in an A2A payload, wherever it sits:
// text parts, data parts, metadata, artifact names, error messages and the
// decoded bytes of text files. The guardrail sees the whole payload, as the
// LLM routes send it the whole messages array. The body is read token by
// token, so no tree of it is ever held. An empty body is parsed and has no text.
func collectTexts(body []byte) payload {
	if len(bytes.TrimSpace(body)) == 0 {
		return payload{parsed: true}
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var texts []string
	if walkTokens(dec, &texts) != nil {
		return payload{}
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return payload{}
	}
	return payload{parsed: true, texts: texts}
}

type jsonFrame struct {
	object, wantKey bool
	key             string
}

// tokenWalker collects the text of one JSON value, one token at a time.
type tokenWalker struct {
	stack []jsonFrame
	out   *[]string
}

// walkTokens reads one JSON value and appends its text.
func walkTokens(dec *json.Decoder, out *[]string) error {
	w := tokenWalker{out: out}
	for {
		tok, err := dec.Token()
		if err != nil {
			return err
		}
		done, err := w.step(tok)
		if err != nil || done {
			return err
		}
	}
}

// step takes one token and reports whether the top-level value is complete.
func (w *tokenWalker) step(tok json.Token) (bool, error) {
	top := len(w.stack) - 1
	if top >= 0 && w.stack[top].wantKey {
		if k, ok := tok.(string); ok {
			w.key(k)
			return false, nil
		}
		w.stack = w.stack[:top] // the object's closing brace
		return w.valueDone(), nil
	}
	d, isDelim := tok.(json.Delim)
	switch {
	case isDelim && (d == '{' || d == '['):
		return false, w.open(d)
	case isDelim:
		w.stack = w.stack[:top] // an array's closing bracket
	default:
		if s, ok := tok.(string); ok {
			appendValue(frameKey(w.stack), s, w.out)
		}
	}
	return w.valueDone(), nil
}

func (w *tokenWalker) key(k string) {
	top := &w.stack[len(w.stack)-1]
	top.key, top.wantKey = k, false
	if !protocolKeys[k] && !protocolValueKeys[k] {
		*w.out = append(*w.out, k)
	}
}

func (w *tokenWalker) open(d json.Delim) error {
	if len(w.stack) >= maxJSONDepth {
		return errTooDeep
	}
	w.stack = append(w.stack, jsonFrame{object: d == '{', wantKey: d == '{', key: frameKey(w.stack)})
	return nil
}

// valueDone marks a finished value: the enclosing object now wants a key.
func (w *tokenWalker) valueDone() bool {
	if len(w.stack) == 0 {
		return true
	}
	if last := &w.stack[len(w.stack)-1]; last.object {
		last.wantKey = true
	}
	return false
}

func frameKey(stack []jsonFrame) string {
	if len(stack) == 0 {
		return ""
	}
	return stack[len(stack)-1].key
}

// appendValue keeps a string value as text. File bytes count as the text
// they decode to when that is valid UTF-8.
func appendValue(key, s string, out *[]string) {
	if s == "" || protocolValueKeys[key] {
		return
	}
	if key == "bytes" || key == "raw" {
		if b, err := base64.StdEncoding.DecodeString(s); err == nil && utf8.Valid(b) {
			s = string(b)
		}
	}
	*out = append(*out, s)
}

func setString(span trace.Span, key, v string) {
	if v != "" {
		span.SetAttributes(attribute.String(key, v))
	}
}

type messageIDs struct {
	MessageID string `json:"messageId"`
	ContextID string `json:"contextId"`
	TaskID    string `json:"taskId"`
}

// setMessageAttrs records the ids of the outgoing message. The typed decode
// skips every other field without building it.
func setMessageAttrs(span trace.Span, body []byte) {
	var v struct {
		Params struct {
			Message *messageIDs `json:"message"`
		} `json:"params"`
		Message *messageIDs `json:"message"`
	}
	_ = json.Unmarshal(body, &v)
	msg := v.Params.Message
	if msg == nil {
		msg = v.Message
	}
	if msg == nil {
		return
	}
	setString(span, attrMessageID, msg.MessageID)
	setString(span, attrContextID, msg.ContextID)
	setString(span, attrTaskID, msg.TaskID)
}

type taskIDs struct {
	ID        any    `json:"id"`
	TaskID    string `json:"taskId"`
	ContextID string `json:"contextId"`
	Status    struct {
		State string `json:"state"`
	} `json:"status"`
}

type resultShape struct {
	taskIDs
	Task           *taskIDs `json:"task"`
	StatusUpdate   *taskIDs `json:"statusUpdate"`
	ArtifactUpdate *taskIDs `json:"artifactUpdate"`
}

// setResultAttrs records the task the reply names, for JSON-RPC and
// HTTP+JSON replies and stream events alike.
func setResultAttrs(span trace.Span, body []byte) {
	var v struct {
		Result *resultShape `json:"result"`
		resultShape
	}
	_ = json.Unmarshal(body, &v)
	r := v.Result
	if r == nil {
		r = &v.resultShape
	}
	t := &r.taskIDs
	for _, inner := range []*taskIDs{r.Task, r.StatusUpdate, r.ArtifactUpdate} {
		if inner != nil {
			t = inner
			break
		}
	}
	id := t.TaskID
	if s, ok := t.ID.(string); ok && id == "" {
		id = s
	}
	setString(span, attrTaskID, id)
	setString(span, attrContextID, t.ContextID)
	setString(span, attrTaskState, t.Status.State)
}
