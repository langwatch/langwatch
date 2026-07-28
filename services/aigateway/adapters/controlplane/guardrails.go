package controlplane

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
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

// EvaluateChunk runs stream-chunk guardrails.
//
// This direction always fails open, deliberately: a slow or unreachable policy
// service must never stall a stream a user is already reading. The error is
// swallowed so the caller proceeds, but the verdict now says so, because an
// allow the gateway could not justify and an allow a guardrail actually
// granted are not the same thing to whoever is watching enforcement.
func (c *Client) EvaluateChunk(ctx context.Context, bundle *domain.Bundle, _ *domain.Request, chunk []byte) (domain.GuardrailVerdict, error) {
	verdict, err := c.evaluateGuardrail(ctx, bundle, "stream_chunk", chunk, c.guardrailTimeouts.StreamChunk)
	if err != nil {
		c.logger.Debug("guardrail_chunk_fail_open", zap.Error(err))
		recordStreamChunkFailOpen(ctx, err)
		return domain.GuardrailVerdict{
			Action:         domain.GuardrailAllow,
			FailedOpen:     true,
			FailOpenReason: err.Error(),
		}, nil
	}
	return verdict, nil
}

// recordStreamChunkFailOpen stamps the bypass on the active span, per contract
// 7b. The reason is unbounded text, so it belongs here and not on a metric
// label.
func recordStreamChunkFailOpen(ctx context.Context, cause error) {
	span := trace.SpanFromContext(ctx)
	if !span.SpanContext().IsValid() {
		return
	}
	span.SetAttributes(
		attribute.String("langwatch.guardrail.stream_chunk_fail_open", cause.Error()),
	)
}

type guardrailCheckRequest struct {
	VirtualKeyID string                `json:"vk_id"`
	ProjectID    string                `json:"project_id"`
	Direction    string                `json:"direction"`
	Content      guardrailCheckContent `json:"content"`
	GuardrailIDs []string              `json:"guardrail_ids"`
}

// guardrailCheckContent carries the payload under the key the direction
// implies, per contract 4.6.
//
// Tools and MCPs travel with the request direction. The control plane scores
// them, so a data plane that dropped them would let a policy written to catch
// a dangerous tool definition pass on the prose alone.
type guardrailCheckContent struct {
	Messages json.RawMessage `json:"messages,omitempty"`
	Tools    json.RawMessage `json:"tools,omitempty"`
	MCPs     json.RawMessage `json:"mcps,omitempty"`
	Output   string          `json:"output,omitempty"`
	Chunk    string          `json:"chunk,omitempty"`
}

// guardrailCheckResponse must stay byte-compatible with the control plane's
// response schema in gateway-internal.ts. The verdict field is "decision": an
// earlier version of this struct read "action", which is absent from the
// response, so every verdict fell through to the allow default and guardrails
// never blocked anything. contract_test.go pins both names.
type guardrailCheckResponse struct {
	Decision          string   `json:"decision"`
	Reason            string   `json:"reason,omitempty"`
	PoliciesTriggered []string `json:"policies_triggered,omitempty"`
}

// contentFor packs the raw payload into the contract's content object.
//
// Every direction is named explicitly. A catch-all default would pack an
// unrecognized direction under "chunk", so a typo or a direction the control
// plane rejects would be evaluated as a stream chunk instead of failing.
func contentFor(direction string, payload []byte) (guardrailCheckContent, error) {
	switch direction {
	case "request":
		var body struct {
			Messages json.RawMessage `json:"messages"`
			Tools    json.RawMessage `json:"tools"`
			MCPs     json.RawMessage `json:"mcps"`
		}
		if err := json.Unmarshal(payload, &body); err == nil && len(body.Messages) > 0 {
			return guardrailCheckContent{
				Messages: body.Messages,
				Tools:    body.Tools,
				MCPs:     body.MCPs,
			}, nil
		}
		// The body is not the shape we know. Send it whole rather than
		// nothing, so the guardrail still sees the request it is meant to
		// judge.
		return guardrailCheckContent{Messages: json.RawMessage(payload)}, nil
	case "response":
		return guardrailCheckContent{Output: assistantText(payload)}, nil
	case "stream_chunk":
		return guardrailCheckContent{Chunk: string(payload)}, nil
	}
	return guardrailCheckContent{}, fmt.Errorf("unknown guardrail direction %q", direction)
}

// assistantText pulls the generated text out of an OpenAI-shaped response so
// evaluators score the completion rather than the envelope. Falls back to the
// raw body when the shape is not recognized.
func assistantText(payload []byte) string {
	var body struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(payload, &body); err == nil && len(body.Choices) > 0 {
		if text := body.Choices[0].Message.Content; text != "" {
			return text
		}
	}
	return string(payload)
}

func (c *Client) evaluateGuardrail(ctx context.Context, bundle *domain.Bundle, direction string, content []byte, timeout time.Duration) (domain.GuardrailVerdict, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	packed, err := contentFor(direction, content)
	if err != nil {
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, err
	}

	body, err := json.Marshal(guardrailCheckRequest{
		VirtualKeyID: bundle.VirtualKeyID,
		ProjectID:    bundle.ProjectID,
		Direction:    direction,
		Content:      packed,
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

	return verdictFor(result)
}

// verdictFor maps the control plane's decision onto the data plane's verdict.
// The accepted values are the other half of the contract, so the contract test
// drives this function with every decision the control plane can emit.
func verdictFor(result guardrailCheckResponse) (domain.GuardrailVerdict, error) {
	switch result.Decision {
	case "block":
		return domain.GuardrailVerdict{Action: domain.GuardrailBlock, Message: result.Reason}, nil
	case "modify":
		return domain.GuardrailVerdict{Action: domain.GuardrailModify, Message: result.Reason}, nil
	case "allow":
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, nil
	}
	// An unrecognized verdict means the two sides disagree about the wire
	// shape. Surface it as an error so the caller's failure mode decides,
	// rather than silently allowing the request.
	return domain.GuardrailVerdict{Action: domain.GuardrailAllow},
		fmt.Errorf("guardrail check returned unknown decision %q", result.Decision)
}
