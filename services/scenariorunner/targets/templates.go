package targets

import (
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/osteele/liquid"
	"github.com/osteele/liquid/render"
	"github.com/osteele/liquid/values"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
)

// defaultThreadID stands in when a turn carries no thread id.
const defaultThreadID = "scenario-test"

// errFileTagRefused is what a template using a file-reading tag gets: the
// templates are customer input and must not inline a file from the worker.
var errFileTagRefused = errors.New("templates cannot include or render files")

// replacerFunc adapts a string transform to an auto-escape replacer.
type replacerFunc func(string) string

func (f replacerFunc) WriteString(w io.Writer, s string) (int, error) {
	return io.WriteString(w, f(s))
}

func newSandboxedEngine(escape replacerFunc) *liquid.Engine {
	engine := liquid.NewEngine()
	engine.LaxFilters()
	for _, tag := range []string{"include", "render", "layout"} {
		engine.RegisterTag(tag, func(render.Context) (string, error) { return "", errFileTagRefused })
	}
	if escape != nil {
		engine.SetAutoEscapeReplacer(escape)
	}
	engine.RegisterFilter("raw", func(v any) any { return values.SafeValue{Value: v} })
	return engine
}

// The three engines of the HTTP template engine: a URL escapes every value as
// a URI component, a body as the inside of a JSON string literal unless it is
// raw JSON, and a header not at all.
var (
	urlEngine    = newSandboxedEngine(encodeURIComponent)
	bodyEngine   = newSandboxedEngine(escapeForJSONStringLiteral)
	headerEngine = newSandboxedEngine(nil)
)

// encodeURIComponent is JavaScript's: everything but A-Z a-z 0-9 - _ . ! ~ * ' ( ).
func encodeURIComponent(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if isURIUnreserved(c) {
			b.WriteByte(c)
			continue
		}
		fmt.Fprintf(&b, "%%%02X", c)
	}
	return b.String()
}

func isURIUnreserved(c byte) bool {
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
		strings.IndexByte("-_.!~*'()", c) >= 0
}

// escapeForJSONStringLiteral escapes text for the inside of an existing
// JSON string literal, without adding quotes.
func escapeForJSONStringLiteral(s string) string {
	quoted := jsjson.AppendString(nil, s)
	return string(quoted[1 : len(quoted)-1])
}

// templateContext is the shared context every HTTP template renders against.
type templateContext struct {
	values map[string]any
	// sessionKeys are the keys whose value came from the held session.
	sessionKeys []string
}

// rawJSON marks pre-serialized JSON a body template interpolates verbatim.
type rawJSON string

// contextInput is what buildTemplateContext reads.
type contextInput struct {
	turn       Turn
	mappings   Mappings
	parameters *jsjson.Object
	trace      TraceContext
	session    any
}

func buildTemplateContext(in contextInput) *templateContext {
	ctx := &templateContext{values: map[string]any{
		"messages": rawJSON(MessagesJSON(in.turn.Messages)),
		"threadId": threadIDOr(in.turn.ThreadID),
		"input":    inputValue(in.turn),
		"session":  sessionValue(in.session),
		"params":   toBindings(in.parameters),
	}}
	if in.trace.TraceID != "" {
		ctx.values["traceId"] = in.trace.TraceID
	}
	if in.trace.Traceparent != "" {
		ctx.values["traceparent"] = in.trace.Traceparent
	}
	ctx.addMappings(in)
	return ctx
}

func (c *templateContext) addMappings(in contextInput) {
	if in.mappings.Len() == 0 {
		return
	}
	last, hasUser := in.turn.lastUserMessage()
	inputStructured := hasUser && last.IsStructured()
	sessionStructured := isStructured(in.session)
	resolved := resolveFieldMappings(&in.mappings, in.turn, in.session)
	for _, id := range in.mappings.Keys {
		field := in.mappings.Items[id].SourceField()
		c.values[id] = mappedValue(resolved[id], field == "messages" ||
			(field == "input" && inputStructured) || (field == "session" && sessionStructured))
		if field == "session" {
			c.sessionKeys = append(c.sessionKeys, id)
		}
	}
}

// mappedValue is raw JSON when the mapping filled the input with JSON.
func mappedValue(value string, isJSON bool) any {
	if isJSON {
		return rawJSON(value)
	}
	return value
}

func threadIDOr(id string) string {
	if id == "" {
		return defaultThreadID
	}
	return id
}

func inputValue(turn Turn) any {
	m, ok := turn.lastUserMessage()
	if !ok {
		return nil
	}
	if m.IsStructured() {
		return rawJSON(m.Raw)
	}
	return m.Content
}

func isStructured(v any) bool {
	switch v.(type) {
	case *jsjson.Object, []any:
		return true
	}
	return false
}

func sessionValue(session any) any {
	if isStructured(session) {
		return rawJSON(jsjson.Stringify(session))
	}
	return sessionAsText(session)
}

// toBindings converts decoded JSON into the plain maps Liquid reads.
func toBindings(v any) any {
	switch t := v.(type) {
	case *jsjson.Object:
		m := make(map[string]any, t.Len())
		for _, k := range t.Keys() {
			val, _ := t.Get(k)
			m[k] = toBindings(val)
		}
		return m
	case []any:
		out := make([]any, len(t))
		for i, e := range t {
			out[i] = toBindings(e)
		}
		return out
	case nil:
		return map[string]any{}
	}
	return v
}

// bindings are the context for one engine: raw JSON is safe in a body and
// plain text everywhere else.
func (c *templateContext) bindings(body bool) liquid.Bindings {
	out := make(liquid.Bindings, len(c.values))
	for k, v := range c.values {
		raw, ok := v.(rawJSON)
		switch {
		case ok && body:
			out[k] = values.SafeValue{Value: string(raw)}
		case ok:
			out[k] = string(raw)
		default:
			out[k] = v
		}
	}
	return out
}

func (c *templateContext) withoutSession() *templateContext {
	out := &templateContext{values: make(map[string]any, len(c.values))}
	for k, v := range c.values {
		out.values[k] = v
	}
	out.values["session"] = ""
	for _, k := range c.sessionKeys {
		out.values[k] = ""
	}
	return out
}

// templateRenderError is a template failure tied to the field it is in.
func templateRenderError(field, detail string, cause error) *Error {
	msg := "Failed to render " + field + " template"
	if detail != "" {
		msg += " (" + detail + ")"
	}
	return &Error{Name: "TemplateRenderError", Message: msg + ": " + cause.Error(), Cause: cause}
}

func renderURLTemplate(template string, ctx *templateContext) (string, error) {
	rendered, err := urlEngine.ParseAndRenderString(template, ctx.bindings(false))
	if err != nil {
		return "", templateRenderError("url", "", err)
	}
	blank, err := urlEngine.ParseAndRenderString(template, ctx.withoutSession().bindings(false))
	if err != nil {
		return "", templateRenderError("url", "", err)
	}
	if originOf(rendered) != originOf(blank) {
		return "", templateRenderError("url", "", errors.New("the session of the agent cannot decide the host the turn is sent to"))
	}
	return rendered, nil
}

func renderBodyTemplate(template string, ctx *templateContext) (string, error) {
	rendered, err := bodyEngine.ParseAndRenderString(template, ctx.bindings(true))
	if err != nil {
		return "", templateRenderError("bodyTemplate", "", err)
	}
	return rendered, nil
}

func renderHeaderTemplate(template string, ctx *templateContext, key string) (string, error) {
	detail := fmt.Sprintf("header %q", key)
	rendered, err := headerEngine.ParseAndRenderString(template, ctx.bindings(false))
	if err != nil {
		return "", templateRenderError("headers", detail, err)
	}
	if strings.ContainsAny(rendered, "\r\n\x00") {
		return "", templateRenderError("headers", detail, errors.New(
			"the rendered value contains a line break or NUL character, which is not valid in an HTTP header"))
	}
	return rendered, nil
}

// originOf is a URL's origin, or "" when it names none.
func originOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if (u.Scheme == "http" && port == "80") || (u.Scheme == "https" && port == "443") {
		port = ""
	}
	if port != "" {
		host += ":" + port
	}
	return strings.ToLower(u.Scheme) + "://" + host
}

// mergePropagationHeaders adds trace headers without replacing a user header
// of the same name in any case.
func mergePropagationHeaders(headers *orderedHeaders, propagation map[string]string) {
	for _, k := range sortedKeys(propagation) {
		if !headers.hasFold(k) {
			headers.set(k, propagation[k])
		}
	}
}
