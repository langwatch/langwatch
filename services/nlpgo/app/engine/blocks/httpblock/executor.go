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
	"strings"
	"time"
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
	Client            *http.Client // nil → http.DefaultClient with our SSRF policy
	SSRF              SSRFOptions
	DefaultTimeout    time.Duration
	MaxResponseBytes  int64 // 0 → 4 MiB
}

// defaultMaxResponseBytes caps untrusted upstream payloads so a hostile
// server can't pin a runtime worker by streaming gigabytes.
const defaultMaxResponseBytes int64 = 4 * 1024 * 1024

// DefaultTimeout is the per-request HTTP node timeout when the
// caller doesn't override it. Anchored at 12 minutes per the owner
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

// Request is what the engine hands to the executor per node invocation.
type Request struct {
	URL          string
	Method       string
	BodyTemplate string
	OutputPath   string
	Headers      map[string]string
	Auth         *Auth
	TimeoutMS    int
	Inputs       map[string]any
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
type Result struct {
	Output         any
	StatusCode     int
	UpstreamBody   []byte
	RenderedBody   string
	Warnings       []string
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

	timeout := e.defaultTime
	if req.TimeoutMS > 0 {
		timeout = time.Duration(req.TimeoutMS) * time.Millisecond
	}
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
	if resp.StatusCode/100 != 2 {
		return &Result{
			StatusCode:   resp.StatusCode,
			UpstreamBody: bodyBytes,
			RenderedBody: rendered,
			Warnings:     warnings,
		}, &UpstreamError{Status: resp.StatusCode, Body: bodyBytes}
	}

	var data any
	if len(bodyBytes) > 0 {
		if err := json.Unmarshal(bodyBytes, &data); err != nil {
			// Non-JSON: surface raw text on a string output_path of $
			data = string(bodyBytes)
		}
	}

	if req.OutputPath == "" {
		return &Result{
			Output:       data,
			StatusCode:   resp.StatusCode,
			UpstreamBody: bodyBytes,
			RenderedBody: rendered,
			Warnings:     warnings,
		}, nil
	}
	out, err := ExtractJSONPath(data, req.OutputPath)
	if err != nil {
		return &Result{
			StatusCode:   resp.StatusCode,
			UpstreamBody: bodyBytes,
			RenderedBody: rendered,
			Warnings:     warnings,
		}, err
	}
	return &Result{
		Output:       out,
		StatusCode:   resp.StatusCode,
		UpstreamBody: bodyBytes,
		RenderedBody: rendered,
		Warnings:     warnings,
	}, nil
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
