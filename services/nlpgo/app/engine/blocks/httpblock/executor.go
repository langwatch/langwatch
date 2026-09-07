package httpblock

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/blocktimeout"
)

// Executor runs a single HTTP block invocation.
type Executor struct {
	client      *http.Client
	ssrf        SSRFOptions
	defaultTime time.Duration
	maxBytes    int64
}

// Options configures an Executor.
type Options struct {
	Client           *http.Client // nil → http.DefaultClient with our SSRF policy
	SSRF             SSRFOptions
	DefaultTimeout   time.Duration
	MaxResponseBytes int64 // 0 → 4 MiB
}

// defaultMaxResponseBytes caps untrusted upstream payloads so a hostile
// server can't pin a runtime worker by streaming gigabytes.
const defaultMaxResponseBytes int64 = 4 * 1024 * 1024

// DefaultTimeout is the per-request HTTP node timeout when the
// caller doesn't override it, and the ceiling a caller's own
// Request.TimeoutMS is clamped to. Anchored at 12 minutes per the owner
// directive: customer agent backends (RAG retrieval, multi-step
// scrapers, sub-workflow chains) legitimately take 10+ minutes
// before responding, and Lambda's hard execution cap is 15 minutes,
// so 12 minutes leaves a 3-minute margin for the response payload
// to drain + the rest of the workflow to finalize.
//
// langwatch_nlp regression 06f93d1eb ("increase HTTP agent default
// timeout to 5 minutes") raised the previous 30s default but didn't
// go far enough — the Go path goes higher to actually accommodate
// real customer agents. Exposed as a constant so tests + integrators
// can observe the default without reflecting on the executor's
// private fields.
const DefaultTimeout = 12 * time.Minute

// New builds an Executor with the given options.
func New(opts Options) *Executor {
	if opts.Client == nil {
		// Default Transport with our SSRF dial-time policy. A
		// caller-supplied Client takes responsibility for its own
		// dial-time safety.
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.DialContext = SafeDialer(opts.SSRF)
		opts.Client = &http.Client{Transport: transport}
	}
	if opts.DefaultTimeout == 0 {
		opts.DefaultTimeout = DefaultTimeout
	}
	if opts.MaxResponseBytes <= 0 {
		opts.MaxResponseBytes = defaultMaxResponseBytes
	}
	return &Executor{
		client:      opts.Client,
		ssrf:        opts.SSRF,
		defaultTime: opts.DefaultTimeout,
		maxBytes:    opts.MaxResponseBytes,
	}
}

// DefaultTimeout reports the wall-clock ceiling this executor applies. It is
// both the budget for a request that names none and the upper bound on one
// that does. Exported so the wiring that feeds it an operator knob is
// observable from a test.
func (e *Executor) DefaultTimeout() time.Duration {
	return e.defaultTime
}

// Request is what the engine hands to the executor per node invocation.
type Request struct {
	URL          string
	Method       string
	BodyTemplate string
	OutputPath   string
	Headers      map[string]string
	Auth         *Auth
	// TimeoutMS asks for LESS time than the operator allows; it can never
	// buy more. 0 (and any negative) means the executor's own ceiling.
	TimeoutMS int
	Inputs    map[string]any
}

// Auth is the auth config (already with secrets resolved).
type Auth struct {
	Type     string // bearer | api_key | basic
	Token    string
	Header   string
	Value    string
	Username string
	Password string
}

// Result is the executor's output.
//
// StatusText and ResponseHeaders are diagnostics rather than workflow data:
// nothing downstream binds to them, and they exist so the person configuring
// an agent can see what the endpoint actually answered. They are populated on
// success and on a non-2xx alike, since the failing case is the one worth
// looking at.
type Result struct {
	Output          any
	StatusCode      int
	StatusText      string
	ResponseHeaders map[string]string
	UpstreamBody    []byte
	RenderedBody    string
	Warnings        []string
}

// Execute runs the request, performs SSRF check, sends, and extracts.
func (e *Executor) Execute(ctx context.Context, req Request) (*Result, error) {
	if req.URL == "" {
		return nil, errors.New("httpblock: url required")
	}
	if err := CheckURL(req.URL, e.ssrf); err != nil {
		return nil, err
	}

	method := req.Method
	if method == "" {
		method = http.MethodPost
	}

	var body io.Reader
	rendered := ""
	var warnings []string
	if req.BodyTemplate != "" {
		out, ws := RenderTemplate(req.BodyTemplate, req.Inputs)
		rendered = out
		warnings = ws
		body = bytes.NewBufferString(out)
	}

	httpReq, err := http.NewRequestWithContext(ctx, method, req.URL, body)
	if err != nil {
		return nil, fmt.Errorf("httpblock: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}
	if err := applyAuth(httpReq, req.Auth); err != nil {
		return nil, err
	}

	// The operator's ceiling wins. A node's `timeout_ms` only ever shortens
	// the budget: a workflow author must not be able to escape
	// NLPGO_ENGINE_HTTP_BLOCK_TIMEOUT_SECONDS — the bound on how long one
	// node may hold a worker waiting on a customer endpoint — by writing a
	// bigger number into their own node.
	timeout := blocktimeout.Clamp(e.defaultTime, req.TimeoutMS)
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	httpReq = httpReq.WithContext(reqCtx)

	resp, err := e.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("httpblock: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, readErr := io.ReadAll(io.LimitReader(resp.Body, e.maxBytes))
	// A truncated read on a 2xx is worse than a clean error — callers
	// would silently pipe partial JSON into downstream nodes. Surface
	// the read failure (timeout mid-body, dropped connection, etc.)
	// instead of swallowing it. Non-2xx still falls through so the
	// caller sees the upstream status.
	if readErr != nil && resp.StatusCode/100 == 2 {
		return nil, fmt.Errorf("httpblock: read response body: %w", readErr)
	}

	result := &Result{
		StatusCode:      resp.StatusCode,
		StatusText:      statusText(resp),
		ResponseHeaders: flattenHeaders(resp.Header),
		UpstreamBody:    bodyBytes,
		RenderedBody:    rendered,
		Warnings:        warnings,
	}

	if resp.StatusCode/100 != 2 {
		return result, &UpstreamError{Status: resp.StatusCode, Body: bodyBytes}
	}

	var data any
	if len(bodyBytes) > 0 {
		if err := json.Unmarshal(bodyBytes, &data); err != nil {
			// Non-JSON: surface raw text on a string output_path of $
			data = string(bodyBytes)
		}
	}

	if req.OutputPath == "" {
		result.Output = data
		return result, nil
	}
	out, err := ExtractJSONPath(data, req.OutputPath)
	if err != nil {
		return result, err
	}
	result.Output = out
	return result, nil
}

// statusText prefers the upstream's own reason phrase over the canonical text
// for the code, because a service that answers "403 Quota Exceeded" has told
// the author more than "Forbidden" will.
func statusText(resp *http.Response) string {
	if _, phrase, ok := strings.Cut(resp.Status, " "); ok && phrase != "" {
		return phrase
	}
	return http.StatusText(resp.StatusCode)
}

const redactedHeaderValue = "[REDACTED]"

// credentialHeaderWord matches names built around a credential. Whole words, so
// X-Amz-Security-Token and X-Api-Key lose their values while X-Api-Version,
// X-Idempotency-Key and WWW-Authenticate keep theirs: half the value of
// reporting headers at all is the ones an author came to read.
//
// Applied to responses as well as requests. Set-Cookie and Authorization hand
// out access rather than describe it whichever direction they travel in, and a
// response carries whatever the upstream chose to send.
//
// This is the rule sanitizeHeadersForTrace applies on the app side; the two
// should stay in step, since they redact the same request for the same reader.
var credentialHeaderWord = regexp.MustCompile(
	`(?i)(^|[-_])(authorization|auth|cookie2?|api[-_]?key|token|secret|password|credential)s?([-_]|$)`,
)

// flattenHeaders joins repeated headers the way they appeared on the wire, so
// two Vary lines read as two rather than silently becoming one.
//
// A credential keeps its name and loses its value: the author still sees that
// their endpoint set a cookie, which is usually the thing they are checking,
// while the value stays out of a workflow's execution state and off the screen
// of whoever opens it next.
func flattenHeaders(h http.Header) map[string]string {
	if len(h) == 0 {
		return nil
	}
	out := make(map[string]string, len(h))
	for name, values := range h {
		if credentialHeaderWord.MatchString(name) {
			out[name] = redactedHeaderValue
			continue
		}
		out[name] = strings.Join(values, ", ")
	}
	return out
}

// applyAuth attaches credentials to the request based on the Auth.Type.
func applyAuth(req *http.Request, a *Auth) error {
	if a == nil {
		return nil
	}
	switch strings.ToLower(a.Type) {
	case "bearer":
		if a.Token != "" {
			req.Header.Set("Authorization", "Bearer "+a.Token)
		}
	case "api_key":
		if a.Header != "" && (a.Value != "" || a.Token != "") {
			val := a.Value
			if val == "" {
				val = a.Token
			}
			req.Header.Set(a.Header, val)
		}
	case "basic":
		if a.Username != "" || a.Password != "" {
			creds := base64.StdEncoding.EncodeToString([]byte(a.Username + ":" + a.Password))
			req.Header.Set("Authorization", "Basic "+creds)
		}
	default:
		return fmt.Errorf("httpblock: unsupported auth type %q", a.Type)
	}
	return nil
}

// UpstreamError carries the upstream non-2xx response.
type UpstreamError struct {
	Status int
	Body   []byte
}

func (e *UpstreamError) Error() string {
	return fmt.Sprintf("httpblock: upstream returned %d", e.Status)
}
