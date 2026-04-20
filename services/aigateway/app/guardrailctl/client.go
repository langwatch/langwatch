// Package guardrails implements the guardrail evaluation client.
// Implements app.GuardrailEvaluator.
package guardrailctl

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Client calls the control plane guardrail check endpoint.
type Client struct {
	endpoint string
	sign     func(req *http.Request, body []byte)
	client   *http.Client
	logger   *zap.Logger
	timeouts Timeouts
}

// Timeouts configures per-direction budgets.
type Timeouts struct {
	Pre         time.Duration // default 5s
	Post        time.Duration // default 5s
	StreamChunk time.Duration // default 50ms (fail-open on timeout)
}

// Options configures the client.
type Options struct {
	ControlPlaneBaseURL string
	Sign                func(req *http.Request, body []byte)
	Logger              *zap.Logger
	Timeouts            Timeouts
}

// New creates a guardrail client.
func New(opts Options) *Client {
	if opts.Timeouts.Pre == 0 {
		opts.Timeouts.Pre = 5 * time.Second
	}
	if opts.Timeouts.Post == 0 {
		opts.Timeouts.Post = 5 * time.Second
	}
	if opts.Timeouts.StreamChunk == 0 {
		opts.Timeouts.StreamChunk = 50 * time.Millisecond
	}
	logger := opts.Logger
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Client{
		endpoint: opts.ControlPlaneBaseURL + "/api/internal/gateway/guardrail/check",
		sign:     opts.Sign,
		client:   &http.Client{},
		logger:   logger,
		timeouts: opts.Timeouts,
	}
}

// EvaluatePre runs pre-request guardrails.
func (c *Client) EvaluatePre(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (app.GuardrailVerdict, error) {
	return c.evaluate(ctx, bundle, "request", req.Body, c.timeouts.Pre)
}

// EvaluatePost runs post-response guardrails.
func (c *Client) EvaluatePost(ctx context.Context, bundle *domain.Bundle, _ *domain.Request, resp *domain.Response) (app.GuardrailVerdict, error) {
	return c.evaluate(ctx, bundle, "response", resp.Body, c.timeouts.Post)
}

// EvaluateChunk runs stream-chunk guardrails (fail-open on timeout).
func (c *Client) EvaluateChunk(ctx context.Context, bundle *domain.Bundle, _ *domain.Request, chunk []byte) (app.GuardrailVerdict, error) {
	verdict, err := c.evaluate(ctx, bundle, "stream_chunk", chunk, c.timeouts.StreamChunk)
	if err != nil {
		// Fail-open on chunk evaluation timeout/error
		c.logger.Debug("guardrail_chunk_fail_open", zap.Error(err))
		return app.GuardrailVerdict{Action: app.GuardrailAllow}, nil
	}
	return verdict, nil
}

type checkRequest struct {
	VirtualKeyID string   `json:"vk_id"`
	ProjectID    string   `json:"project_id"`
	Direction    string   `json:"direction"`
	Content      []byte   `json:"content"`
	Guardrails   []string `json:"guardrails"`
}

type checkResponse struct {
	Action  string `json:"action"`
	Message string `json:"message,omitempty"`
}

func (c *Client) evaluate(ctx context.Context, bundle *domain.Bundle, direction string, content []byte, timeout time.Duration) (app.GuardrailVerdict, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	body, err := json.Marshal(checkRequest{
		VirtualKeyID: bundle.VirtualKeyID,
		ProjectID:    bundle.ProjectID,
		Direction:    direction,
		Content:      content,
		Guardrails:   bundle.Config.Guardrails,
	})
	if err != nil {
		return app.GuardrailVerdict{Action: app.GuardrailAllow}, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.endpoint, bytes.NewReader(body))
	if err != nil {
		return app.GuardrailVerdict{Action: app.GuardrailAllow}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.sign != nil {
		c.sign(req, body)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return app.GuardrailVerdict{Action: app.GuardrailAllow}, fmt.Errorf("guardrail check: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return app.GuardrailVerdict{Action: app.GuardrailAllow}, fmt.Errorf("guardrail check returned %d", resp.StatusCode)
	}

	var result checkResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return app.GuardrailVerdict{Action: app.GuardrailAllow}, err
	}

	switch result.Action {
	case "block":
		return app.GuardrailVerdict{Action: app.GuardrailBlock, Message: result.Message}, nil
	case "modify":
		return app.GuardrailVerdict{Action: app.GuardrailModify, Message: result.Message}, nil
	default:
		return app.GuardrailVerdict{Action: app.GuardrailAllow}, nil
	}
}
