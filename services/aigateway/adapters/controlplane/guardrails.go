package controlplane

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// EvaluatePre runs pre-request guardrails.
func (c *Client) EvaluatePre(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (domain.GuardrailVerdict, error) {
	return c.evaluateGuardrail(ctx, bundle, "request", req.Body, c.guardrailTimeouts.Pre)
}

// EvaluatePost runs post-response guardrails.
func (c *Client) EvaluatePost(ctx context.Context, bundle *domain.Bundle, _ *domain.Request, resp *domain.Response) (domain.GuardrailVerdict, error) {
	return c.evaluateGuardrail(ctx, bundle, "response", resp.Body, c.guardrailTimeouts.Post)
}

// EvaluateChunk runs stream-chunk guardrails (fail-open on timeout or error).
func (c *Client) EvaluateChunk(ctx context.Context, bundle *domain.Bundle, _ *domain.Request, chunk []byte) (domain.GuardrailVerdict, error) {
	verdict, err := c.evaluateGuardrail(ctx, bundle, "stream_chunk", chunk, c.guardrailTimeouts.StreamChunk)
	if err != nil {
		c.logger.Debug("guardrail_chunk_fail_open", zap.Error(err))
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, nil
	}
	return verdict, nil
}

type guardrailCheckRequest struct {
	VirtualKeyID string   `json:"vk_id"`
	ProjectID    string   `json:"project_id"`
	Direction    string   `json:"direction"`
	Content      []byte   `json:"content"`
	GuardrailIDs []string `json:"guardrail_ids"`
}

type guardrailCheckResponse struct {
	Action  string `json:"action"`
	Message string `json:"message,omitempty"`
}

func (c *Client) evaluateGuardrail(ctx context.Context, bundle *domain.Bundle, direction string, content []byte, timeout time.Duration) (domain.GuardrailVerdict, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	body, err := json.Marshal(guardrailCheckRequest{
		VirtualKeyID: bundle.VirtualKeyID,
		ProjectID:    bundle.ProjectID,
		Direction:    direction,
		Content:      content,
		GuardrailIDs: bundle.Config.Guardrails.IDs(direction),
	})
	if err != nil {
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, err
	}

	resp, err := c.signedPost(ctx, "/api/internal/gateway/guardrail/check", body)
	if err != nil {
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, fmt.Errorf("guardrail check: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, fmt.Errorf("guardrail check returned %d", resp.StatusCode)
	}

	var result guardrailCheckResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, err
	}

	switch result.Action {
	case "block":
		return domain.GuardrailVerdict{Action: domain.GuardrailBlock, Message: result.Message}, nil
	case "modify":
		return domain.GuardrailVerdict{Action: domain.GuardrailModify, Message: result.Message}, nil
	default:
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, nil
	}
}
