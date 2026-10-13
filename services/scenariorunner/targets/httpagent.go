package targets

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/scenariorunner/egress"
	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsonpath"
)

// HTTPDoer is the fenced egress an HTTP target is dialed through.
type HTTPDoer interface {
	Do(ctx context.Context, req egress.Request) (*egress.Response, error)
}

const (
	responseBodyPreviewChars = 512
	errorBodyLimitChars      = 2048
)

// HTTPAgent calls a customer's HTTP endpoint once per turn
// (http.serialized-http-agent.channel.ts).
type HTTPAgent struct {
	config     HTTPAgentData
	parameters *jsjson.Object
	http       HTTPDoer
	logger     *zap.Logger
	sessions   sessions
}

// HTTPAgentOptions build an HTTPAgent.
type HTTPAgentOptions struct {
	Config     HTTPAgentData
	Parameters *jsjson.Object
	HTTP       HTTPDoer
	Logger     *zap.Logger
}

// NewHTTPAgent returns the adapter.
func NewHTTPAgent(opts HTTPAgentOptions) *HTTPAgent {
	logger := opts.Logger
	if logger == nil {
		logger = zap.NewNop()
	}
	return &HTTPAgent{config: opts.Config, parameters: opts.Parameters, http: opts.HTTP, logger: logger}
}

// Name implements Agent.
func (a *HTTPAgent) Name() string { return "SerializedHttpAgentAdapter" }

// Call implements Agent.
func (a *HTTPAgent) Call(ctx context.Context, turn Turn) (string, error) {
	reply, err := a.call(ctx, turn)
	if err != nil {
		return "", a.scrubChain(err)
	}
	return reply, nil
}

func (a *HTTPAgent) call(ctx context.Context, turn Turn) (string, error) {
	tc := traceContextOf(ctx)
	held, _ := a.sessions.of(turn.ThreadID)
	tctx := buildTemplateContext(contextInput{
		turn: turn, mappings: a.config.ScenarioMappings, parameters: a.parameters, trace: tc, session: held,
	})
	target, err := a.buildURL(tctx)
	if err != nil {
		return "", err
	}
	headers, err := a.buildHeaders(tctx, tc.Headers)
	if err != nil {
		return "", err
	}
	body, err := a.buildBody(turn, tctx)
	if err != nil {
		return "", err
	}
	data, err := a.execute(ctx, outbound{url: target, headers: headers, body: body})
	if err != nil {
		return "", err
	}
	if err := a.sessions.store(turn.ThreadID, a.extractSession(data)); err != nil {
		return "", err
	}
	return a.extractContent(data), nil
}

func (a *HTTPAgent) secrets() map[string]string { return a.config.Secrets }

func (a *HTTPAgent) scrub(message string) string { return redact(message, a.secrets()) }

// scrubChain scrubs an error and everything it was caused by.
func (a *HTTPAgent) scrubChain(err error) error {
	if len(a.secrets()) == 0 {
		return err
	}
	for cur := err; cur != nil; cur = errors.Unwrap(cur) {
		if e, ok := cur.(*Error); ok {
			e.Message = a.scrub(e.Message)
		}
	}
	return err
}

func (a *HTTPAgent) buildURL(ctx *templateContext) (string, error) {
	f := fence(a.config.URL, a.secrets())
	rendered, err := renderURLTemplate(f.template, ctx)
	if err != nil {
		return "", err
	}
	return f.restore(rendered), nil
}

func (a *HTTPAgent) buildHeaders(ctx *templateContext, propagation map[string]string) (*orderedHeaders, error) {
	headers := newOrderedHeaders()
	headers.set("Content-Type", "application/json")
	for _, h := range a.config.Headers {
		key := strings.TrimSpace(h.Key)
		if key == "" {
			continue
		}
		f := fence(h.Value, a.secrets())
		rendered, err := renderHeaderTemplate(f.template, ctx, key)
		if err != nil {
			return nil, err
		}
		headers.set(key, f.restore(rendered))
	}
	auth := authHeaders(renderAuth(a.config.Auth, a.secrets()))
	for _, k := range sortedKeys(auth) {
		headers.set(k, auth[k])
	}
	mergePropagationHeaders(headers, propagation)
	return headers, nil
}

func (a *HTTPAgent) buildBody(turn Turn, ctx *templateContext) (string, error) {
	if a.config.BodyTemplate == nil || *a.config.BodyTemplate == "" {
		return jsjson.Stringify(jsjson.NewObject().Set("messages", MessagesJSON(turn.Messages))), nil
	}
	f := preserve(*a.config.BodyTemplate)
	rendered, err := renderBodyTemplate(f.template, ctx)
	if err != nil {
		return "", err
	}
	return f.restore(rendered), nil
}

type outbound struct {
	url     string
	headers *orderedHeaders
	body    string
}

func (a *HTTPAgent) execute(ctx context.Context, out outbound) (any, error) {
	method := strings.ToUpper(a.config.Method)
	started := time.Now()
	loggedURL := a.scrub(redactURLForLogs(out.url))
	logHeaders := a.headersForLogs(out.headers.Map())
	req := egress.Request{Method: method, URL: out.url, Headers: out.headers.Map()}
	if method != "GET" {
		req.Body = &out.body
	}
	if a.http == nil {
		return nil, newError("Serialized HTTP scenario adapter requires a ScenarioHttpPort")
	}
	resp, err := a.http.Do(ctx, req)
	if err != nil {
		a.logger.Error("http call failed", zap.String("url", loggedURL), zap.String("method", method),
			zap.String("message", a.scrub(err.Error())), zap.Duration("duration", time.Since(started)), zap.Any("headers", logHeaders))
		return nil, &Error{
			Name:    "HttpAgentTransportError",
			Message: fmt.Sprintf("HTTP agent target %s could not be reached: %s", hostForMessage(out.url), a.scrub(flattenErrorMessages(err))),
			Cause:   err,
		}
	}
	if !resp.OK() {
		return nil, a.failOnErrorResponse(resp, loggedURL)
	}
	a.logger.Info("http call ok", zap.String("url", loggedURL), zap.String("method", method), zap.Int("statusCode", resp.Status),
		zap.Duration("duration", time.Since(started)), zap.String("requestId", upstreamRequestID(resp)), zap.Any("headers", logHeaders))
	return decodeResponse(resp)
}

func decodeResponse(resp *egress.Response) (any, error) {
	if strings.Contains(resp.Header.Get("Content-Type"), "application/json") {
		data, err := jsjson.Parse(resp.Body)
		if err != nil {
			return nil, &Error{Name: "SyntaxError", Message: err.Error()}
		}
		return data, nil
	}
	return string(resp.Body), nil
}

func (a *HTTPAgent) failOnErrorResponse(resp *egress.Response, loggedURL string) error {
	body := a.scrub(string(resp.Body))
	requestID := upstreamRequestID(resp)
	a.logger.Warn("http call failed", zap.String("url", loggedURL), zap.Int("statusCode", resp.Status),
		zap.String("responseBodyPreview", preview(body, responseBodyPreviewChars, "…")), zap.String("requestId", requestID))
	if requestID == "" {
		requestID = "none"
	}
	return newError(fmt.Sprintf("HTTP %d: %s from %s (request-id: %s): %s",
		resp.Status, resp.StatusText, loggedURL, requestID, preview(body, errorBodyLimitChars, "... [truncated]")))
}

func (a *HTTPAgent) headersForLogs(headers map[string]string) map[string]string {
	out := redactHeaders(headers)
	for k, v := range out {
		out[k] = a.scrub(v)
	}
	return out
}

// extractContent is the reply: the first outputPath match, else the whole body.
func (a *HTTPAgent) extractContent(data any) string {
	path := ""
	if a.config.OutputPath != nil {
		path = strings.TrimSpace(*a.config.OutputPath)
	}
	if path == "" || !truthy(data) {
		return jsjson.ToText(data)
	}
	matches, err := jsonpath.Query(*a.config.OutputPath, data)
	if err != nil || len(matches) == 0 {
		return jsjson.ToText(data)
	}
	return jsjson.ToText(matches[0])
}

// extractSession is the session at sessionPath, or Absent.
func (a *HTTPAgent) extractSession(data any) any {
	if a.config.SessionPath == nil || strings.TrimSpace(*a.config.SessionPath) == "" || !isStructured(data) {
		return Absent
	}
	path := strings.TrimSpace(*a.config.SessionPath)
	matches, err := jsonpath.Query(path, data)
	if err != nil {
		a.logger.Warn("session path did not parse, keeping the held session", zap.String("sessionPath", path), zap.Error(err))
		return Absent
	}
	if len(matches) == 0 {
		return Absent
	}
	return matches[0]
}

// truthy is JavaScript truthiness for a decoded body.
func truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case string:
		return t != ""
	case bool:
		return t
	case float64:
		return t != 0
	}
	return true
}

func upstreamRequestID(resp *egress.Response) string {
	for _, h := range []string{"x-request-id", "x-amzn-requestid", "x-n8n-execution-id"} {
		if v := resp.Header.Get(h); v != "" {
			return v
		}
	}
	return ""
}

func preview(s string, limit int, suffix string) string {
	r := []rune(s)
	if len(r) <= limit {
		return s
	}
	return string(r[:limit]) + suffix
}

// redactURLForLogs keeps origin and path, dropping a query that may carry a credential.
func redactURLForLogs(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return raw
	}
	return u.Scheme + "://" + u.Host + u.EscapedPath()
}

// hostForMessage is the URL's host, or a fixed label when it does not parse.
func hostForMessage(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "configured target"
	}
	return u.Host
}

// flattenErrorMessages joins an error chain's distinct messages.
func flattenErrorMessages(err error) string {
	var parts []string
	for cur := err; cur != nil; cur = errors.Unwrap(cur) {
		msg := strings.TrimSpace(cur.Error())
		if msg != "" && !contains(parts, msg) {
			parts = append(parts, msg)
		}
	}
	if len(parts) == 0 {
		return err.Error()
	}
	return strings.Join(parts, ": ")
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
