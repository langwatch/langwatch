package gatewayclient

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// Options configures a Client.
type Options struct {
	// BaseURL is where the gateway listens (e.g. "http://localhost:5563"
	// in dev, "https://gateway.langwatch.ai" in prod). Trailing slash
	// is trimmed so callers can pass either form.
	BaseURL string
	// InternalSecret is the shared HMAC secret with the gateway. Empty
	// is rejected — without HMAC the gateway will reject every call.
	InternalSecret string
	// HTTPClient is the underlying transport. Defaults to a sane
	// http.Client with a 60s overall timeout for non-streaming methods.
	// Streaming methods bypass the timeout (the caller's context governs).
	HTTPClient *http.Client
}

// Client implements app.GatewayClient by forwarding to the AI Gateway over
// HTTP with inline-credentials HMAC auth.
type Client struct {
	baseURL    string
	signer     *Signer
	httpClient *http.Client
}

// New constructs a Client. Returns an error if BaseURL is empty or the
// secret is empty.
func New(opts Options) (*Client, error) {
	if opts.BaseURL == "" {
		return nil, errors.New("gatewayclient: BaseURL is required")
	}
	signer, err := NewSigner(opts.InternalSecret)
	if err != nil {
		return nil, err
	}
	httpc := opts.HTTPClient
	if httpc == nil {
		httpc = &http.Client{Timeout: 60 * time.Second}
	}
	return &Client{
		baseURL:    strings.TrimRight(opts.BaseURL, "/"),
		signer:     signer,
		httpClient: httpc,
	}, nil
}

// Compile-time check: Client implements app.GatewayClient.
var _ app.GatewayClient = (*Client)(nil)

// ChatCompletions sends a request to /v1/chat/completions.
func (c *Client) ChatCompletions(ctx context.Context, req app.GatewayRequest) (*app.GatewayResponse, error) {
	return c.doJSON(ctx, "/v1/chat/completions", req)
}

// ChatCompletionsStream opens a streaming request to /v1/chat/completions
// with stream=true. The caller is responsible for setting body.stream=true
// before encoding; this method does not mutate the body.
func (c *Client) ChatCompletionsStream(ctx context.Context, req app.GatewayRequest) (app.StreamIterator, error) {
	return c.doStream(ctx, "/v1/chat/completions", req)
}

// Messages sends a request to /v1/messages (Anthropic-shape).
func (c *Client) Messages(ctx context.Context, req app.GatewayRequest) (*app.GatewayResponse, error) {
	return c.doJSON(ctx, "/v1/messages", req)
}

// MessagesStream opens a streaming /v1/messages request.
func (c *Client) MessagesStream(ctx context.Context, req app.GatewayRequest) (app.StreamIterator, error) {
	return c.doStream(ctx, "/v1/messages", req)
}

// Responses sends a request to /v1/responses (OpenAI new responses API).
func (c *Client) Responses(ctx context.Context, req app.GatewayRequest) (*app.GatewayResponse, error) {
	return c.doJSON(ctx, "/v1/responses", req)
}

// ResponsesStream opens a streaming /v1/responses request.
func (c *Client) ResponsesStream(ctx context.Context, req app.GatewayRequest) (app.StreamIterator, error) {
	return c.doStream(ctx, "/v1/responses", req)
}

// Embeddings sends a request to /v1/embeddings.
func (c *Client) Embeddings(ctx context.Context, req app.GatewayRequest) (*app.GatewayResponse, error) {
	return c.doJSON(ctx, "/v1/embeddings", req)
}

func (c *Client) doJSON(ctx context.Context, path string, req app.GatewayRequest) (*app.GatewayResponse, error) {
	httpReq, err := c.buildRequest(ctx, "POST", path, req)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("gateway request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read gateway response body: %w", err)
	}

	return &app.GatewayResponse{
		StatusCode: resp.StatusCode,
		Body:       body,
		Headers:    headerMap(resp.Header),
	}, nil
}

func (c *Client) doStream(ctx context.Context, path string, req app.GatewayRequest) (app.StreamIterator, error) {
	httpReq, err := c.buildRequest(ctx, "POST", path, req)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Accept", "text/event-stream")

	// Use a transport without an overall timeout for streams — the request
	// duration is governed by the caller's context. We construct a one-off
	// http.Client by stripping the timeout to avoid mutating the shared one.
	streamer := &http.Client{Transport: c.httpClient.Transport}
	resp, err := streamer.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("gateway stream request failed: %w", err)
	}
	if resp.StatusCode/100 != 2 {
		// Drain + close so the connection can be reused, then surface as
		// a non-streaming error response. The caller decides how to
		// propagate (typically: convert to JSON error envelope).
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, &StreamHTTPError{
			StatusCode: resp.StatusCode,
			Body:       body,
			Headers:    headerMap(resp.Header),
		}
	}
	return newSSEIterator(resp), nil
}

func (c *Client) buildRequest(ctx context.Context, method, path string, req app.GatewayRequest) (*http.Request, error) {
	if req.Body == nil {
		req.Body = []byte{}
	}
	httpReq, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(req.Body))
	if err != nil {
		return nil, fmt.Errorf("build gateway request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}
	if req.Project != "" {
		httpReq.Header.Set(HeaderProjectID, req.Project)
	}

	// Sign AFTER all callers' headers are in place so the inline-creds
	// header is part of the canonical hash.
	c.signer.Sign(httpReq, req.Body)
	return httpReq, nil
}

// StreamHTTPError carries a non-2xx response captured at the moment we
// would have started streaming. Callers can inspect the status + body
// to surface a meaningful error to the workflow event stream.
type StreamHTTPError struct {
	StatusCode int
	Body       []byte
	Headers    map[string]string
}

func (e *StreamHTTPError) Error() string {
	return fmt.Sprintf("gateway stream returned non-2xx status %d", e.StatusCode)
}

func headerMap(h http.Header) map[string]string {
	out := make(map[string]string, len(h))
	for k, vs := range h {
		if len(vs) > 0 {
			out[k] = vs[0]
		}
	}
	return out
}
