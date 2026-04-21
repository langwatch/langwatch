package controlplane

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// DebitEvent is posted to the control plane budget endpoint.
type DebitEvent struct {
	GatewayRequestID string `json:"gateway_request_id"`
	VirtualKeyID     string `json:"vk_id"`
	CostMicroUSD     int64  `json:"actual_cost_micro_usd"`
	PromptTokens     int    `json:"prompt_tokens"`
	CompletionTokens int    `json:"completion_tokens"`
	Model            string `json:"model"`
}

// PostDebit sends a single debit event to the control plane.
// Returns nil on success (2xx), or an error the caller can retry.
func (c *Client) PostDebit(ctx context.Context, ev DebitEvent) error {
	body, err := json.Marshal(ev)
	if err != nil {
		return fmt.Errorf("marshal debit event: %w", err)
	}

	resp, err := c.signedPost(ctx, "/api/internal/gateway/budget/debit", body)
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
		return fmt.Errorf("debit returned retryable %d", resp.StatusCode)
	}
	// 4xx: non-retryable
	return fmt.Errorf("debit returned %d", resp.StatusCode)
}
