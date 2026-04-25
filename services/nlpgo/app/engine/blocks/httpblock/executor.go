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
}

// Options configures an Executor.
type Options struct {
	Client            *http.Client // nil → http.DefaultClient with our SSRF policy
	SSRF              SSRFOptions
	DefaultTimeout    time.Duration
	MaxResponseBytes  int64 // 0 → 4 MiB
}

// New builds an Executor with the given options.
func New(opts Options) *Executor {
	if opts.Client == nil {
		opts.Client = &http.Client{}
	}
	if opts.DefaultTimeout == 0 {
		opts.DefaultTimeout = 5 * time.Minute
	}
	return &Executor{
		client:      opts.Client,
		ssrf:        opts.SSRF,
		defaultTime: opts.DefaultTimeout,
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

	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
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
