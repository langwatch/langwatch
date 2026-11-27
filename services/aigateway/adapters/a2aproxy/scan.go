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
	// DirectionStreamChunk is one streamed reply event, judged by the key's
	// stream_chunk guardrails as well as its response guardrails.
	DirectionStreamChunk Direction = "stream_chunk"
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
	EvaluateChunk(ctx context.Context, bundle *domain.Bundle, req *domain.Request, chunk []byte) (domain.GuardrailVerdict, error)
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

// Scan runs the key's request, response or stream_chunk guardrails over the
// text. A key with no guardrail in that direction is allowed without a call.
func (s GuardrailScanner) Scan(ctx context.Context, in ScanInput) (domain.GuardrailVerdict, error) {
	bundle, dir, texts := in.Bundle, in.Direction, in.Texts
	allow := domain.GuardrailVerdict{Action: domain.GuardrailAllow}
	if !s.Applies(bundle, dir) {
		return allow, nil
	}
	text := strings.Join(texts, "\n")
	switch dir {
	case DirectionRequest:
		body, _ := json.Marshal(map[string]any{"messages": []map[string]string{{"role": "user", "content": text}}})
		return s.Evaluator.EvaluatePre(ctx, bundle, &domain.Request{Body: body})
	case DirectionResponse:
		body, _ := json.Marshal(map[string]any{"choices": []map[string]any{{"message": map[string]string{"role": "assistant", "content": text}}}})
		return s.Evaluator.EvaluatePost(ctx, bundle, &domain.Request{}, &domain.Response{Body: body})
	case DirectionStreamChunk:
		return s.Evaluator.EvaluateChunk(ctx, bundle, &domain.Request{}, []byte(text))
	}
	return allow, nil
}

// payload is what the scanner sees of one body: its text, and whether the
// body could be read at all.
type payload struct {
	texts []string
	// parts is the text-part text by artifact, collected for streams only.
	parts []partText
	// parsed is false for a non-empty body that is not JSON.
	parsed bool
}

// partText is the text-part text of one artifact, joined. An empty id holds
// the text outside any artifact, such as a status message's. appends is false
// for an artifact update that replaces the artifact's earlier content; split
// is true when the text came in more than one piece.
type partText struct {
	id, text       string
	appends, split bool
}

// maxJSONDepth bounds how deep the scan walks one body.
const maxJSONDepth = 64

var errTooDeep = errors.New("the JSON nests too deeply")

// protocolValueKeys hold ids and enum values. Their key names are not content,
// but their values are still scanned: a sender chooses what it puts there.
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
	return collect(body, false)
}

// collectStreamTexts is collectTexts plus the text-part text of each artifact,
// which a stream scans joined to the same artifact's earlier text.
func collectStreamTexts(body []byte) payload {
	return collect(body, true)
}

func collect(body []byte, withParts bool) payload {
	if len(bytes.TrimSpace(body)) == 0 {
		return payload{parsed: true}
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var texts []string
	w := tokenWalker{out: &texts, withParts: withParts, outside: -1}
	if w.walk(dec) != nil {
		return payload{}
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return payload{}
	}
	return payload{parsed: true, texts: texts, parts: w.partTexts()}
}

type jsonFrame struct {
	object, wantKey bool
	// content is true inside a data part's data or a metadata object, where
	// every key and value is the sender's own text.
	content bool
	key     string
	// group indexes the artifact this frame sits in, -1 for none; artifact
	// marks the frame of the artifact object itself. appendFlag is this
	// object's "append" member, shared with the artifacts it holds.
	group      int
	artifact   bool
	appendFlag *bool
}

// contentKeys open sender-authored objects: nothing under them is protocol.
var contentKeys = map[string]bool{"data": true, "metadata": true}

// tokenWalker collects the text of one JSON value, one token at a time.
type tokenWalker struct {
	stack []jsonFrame
	out   *[]string
	// withParts also groups text-part text by artifact into groups; outside
	// indexes the group for text outside any artifact, -1 until there is some.
	withParts bool
	groups    []partGroup
	outside   int
}

type partGroup struct {
	id     string
	pieces []string
	// appends points at the update's append member; nil means no update
	// wrapped the artifact, as in a task snapshot, which replaces.
	appends *bool
}

// walk reads one JSON value and appends its text.
func (w *tokenWalker) walk(dec *json.Decoder) error {
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
		switch v := tok.(type) {
		case string:
			w.appendValue(v)
		case bool:
			w.noteAppend(v)
		}
	}
	return w.valueDone(), nil
}

func (w *tokenWalker) key(k string) {
	top := &w.stack[len(w.stack)-1]
	top.key, top.wantKey = k, false
	if top.content || (!protocolKeys[k] && !protocolValueKeys[k]) {
		*w.out = append(*w.out, k)
	}
}

func (w *tokenWalker) open(d json.Delim) error {
	if len(w.stack) >= maxJSONDepth {
		return errTooDeep
	}
	content := w.inContent()
	f := jsonFrame{object: d == '{', wantKey: d == '{', content: content, key: frameKey(w.stack), group: -1}
	if len(w.stack) > 0 {
		f.group = w.stack[len(w.stack)-1].group
	}
	if w.withParts && d == '{' && !content && (f.key == "artifact" || f.key == "artifacts") {
		w.groups = append(w.groups, partGroup{appends: w.parentAppendFlag()})
		f.group, f.artifact = len(w.groups)-1, true
	}
	w.stack = append(w.stack, f)
	return nil
}

// inContent reports whether the next value sits in sender-authored content.
func (w *tokenWalker) inContent() bool {
	if len(w.stack) == 0 {
		return false
	}
	top := w.stack[len(w.stack)-1]
	return top.content || contentKeys[top.key]
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
func (w *tokenWalker) appendValue(s string) {
	key := frameKey(w.stack)
	content := w.inContent()
	if w.withParts && s != "" && !content {
		w.notePart(key, s)
	}
	if s == "" {
		return
	}
	if !content {
		s = fileText(key, s)
	}
	*w.out = append(*w.out, s)
}

// fileEncodings are the base64 forms a file part's bytes may arrive in:
// padded or not, standard or URL-safe, as ProtoJSON accepts them.
var fileEncodings = []*base64.Encoding{
	base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding,
}

// fileText is the text a file part's bytes decode to when that is valid
// UTF-8; any other value is returned as written.
func fileText(key, s string) string {
	if key != "bytes" && key != "raw" {
		return s
	}
	for _, enc := range fileEncodings {
		if b, err := enc.DecodeString(s); err == nil && utf8.Valid(b) {
			return string(b)
		}
	}
	return s
}

// notePart files an artifact's id and text-part text under its group. Text
// is matched in any case, so a case variant a lenient client reads still joins.
// A bare top-level string is all content and counts as text.
func (w *tokenWalker) notePart(key, s string) {
	top := jsonFrame{group: -1}
	if len(w.stack) > 0 {
		top = w.stack[len(w.stack)-1]
	}
	switch {
	case key == "artifactId" && top.artifact:
		w.groups[top.group].id = s
	case strings.EqualFold(key, "text") || len(w.stack) == 0:
		g := top.group
		if g < 0 {
			if w.outside < 0 {
				w.groups = append(w.groups, partGroup{})
				w.outside = len(w.groups) - 1
			}
			g = w.outside
		}
		w.groups[g].pieces = append(w.groups[g].pieces, s)
	}
}

// parentAppendFlag is the append member of the object about to hold an
// artifact, created empty so a member read later still reaches the artifact.
func (w *tokenWalker) parentAppendFlag() *bool {
	parent := &w.stack[len(w.stack)-1]
	if parent.key == "artifacts" {
		return nil
	}
	if parent.appendFlag == nil {
		parent.appendFlag = new(bool)
	}
	return parent.appendFlag
}

// noteAppend records an update's "append": true, wherever it sits among the members.
func (w *tokenWalker) noteAppend(v bool) {
	if !w.withParts || len(w.stack) == 0 || w.inContent() {
		return
	}
	top := &w.stack[len(w.stack)-1]
	if top.object && top.key == "append" {
		if top.appendFlag == nil {
			top.appendFlag = new(bool)
		}
		*top.appendFlag = v
	}
}

// partTexts joins each group's text. A group with none is left out unless it
// replaces a named artifact, whose earlier text it clears. Text outside an
// artifact always joins what came before it.
func (w *tokenWalker) partTexts() []partText {
	var out []partText
	for i, g := range w.groups {
		appends := i == w.outside || (g.appends != nil && *g.appends)
		if len(g.pieces) == 0 && (appends || g.id == "") {
			continue
		}
		out = append(out, partText{id: g.id, text: strings.Join(g.pieces, ""), appends: appends, split: len(g.pieces) > 1})
	}
	return out
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
// HTTP+JSON replies and stream events alike. A JSON-RPC reply without a
// result names no task: its top-level id is the request's.
func setResultAttrs(span trace.Span, body []byte) {
	var v struct {
		JSONRPC *string      `json:"jsonrpc"`
		Result  *resultShape `json:"result"`
		resultShape
	}
	_ = json.Unmarshal(body, &v)
	r := v.Result
	if r == nil && v.JSONRPC != nil {
		return
	}
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
