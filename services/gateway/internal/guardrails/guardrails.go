// Package guardrails runs inline pre/post/stream_chunk guardrails by
// calling POST /api/internal/gateway/guardrail/check. Multiple guardrails
// run in parallel; the first `block` verdict short-circuits and cancels
// remaining in-flight calls. stream_chunk guardrails have a 50ms budget
// and fail-open on timeout (pass chunk through with an OTel warning).
//
// Contract: §4.6 (guardrail/check), §7b (streaming, stream_chunk budget).
package guardrails

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

type Direction string

const (
	DirectionRequest     Direction = "request"
	DirectionResponse    Direction = "response"
	DirectionStreamChunk Direction = "stream_chunk"
)

type Verdict string

const (
	VerdictAllow  Verdict = "allow"
	VerdictBlock  Verdict = "block"
	VerdictModify Verdict = "modify"
)

// Result aggregates verdicts from the parallel guardrail calls. If any
// single guardrail returns block, the Aggregate Verdict is block. Modify
// verdicts are merged into ModifiedBody (last-write-wins when multiple
// guardrails modify) — in practice, deploying contradictory redactors is
// a user error; the OTel trace records every policy that fired.
type Result struct {
	Verdict           Verdict
	Reason            string
	ModifiedBody      []byte
	PoliciesTriggered []string
	FailOpenReason    string // non-empty when we bypassed due to timeout/upstream error and VK flag allows
}

// Request is the shape sent to the control-plane endpoint.
type Request struct {
	VirtualKeyID      string          `json:"vk_id"`
	ProjectID         string          `json:"project_id"`
	GatewayRequestID  string          `json:"gateway_request_id"`
	Direction         Direction       `json:"direction"`
	GuardrailIDs      []string        `json:"guardrail_ids"`
	Content           RequestContent  `json:"content"`
	Metadata          RequestMetadata `json:"metadata"`
}
type RequestContent struct {
	Messages json.RawMessage `json:"messages,omitempty"`
	Output   string          `json:"output,omitempty"`
	Chunk    string          `json:"chunk,omitempty"`
	Tools    json.RawMessage `json:"tools,omitempty"`
	MCPs     json.RawMessage `json:"mcps,omitempty"`
}
type RequestMetadata struct {
	Model       string `json:"model"`
	PrincipalID string `json:"principal_id"`
}

// response is the contract-shape decision body.
type response struct {
	Decision           string          `json:"decision"`
	Reason             string          `json:"reason,omitempty"`
	ModifiedContent    json.RawMessage `json:"modified_content,omitempty"`
	PoliciesTriggered  []string        `json:"policies_triggered,omitempty"`
}

// Signer signs the outbound HMAC request (shared with budget outbox).
type Signer func(req *http.Request, body []byte)

type Client struct {
	endpoint string
	http     *http.Client
	sign     Signer
	logger   *slog.Logger
	timeouts Timeouts
}

type Timeouts struct {
	Pre         time.Duration
	Post        time.Duration
	StreamChunk time.Duration
}

type Options struct {
	ControlPlaneBaseURL string
	Sign                Signer
	Logger              *slog.Logger
	Timeouts            Timeouts
}

func New(opts Options) *Client {
	if opts.Timeouts.Pre == 0 {
		opts.Timeouts.Pre = 800 * time.Millisecond
	}
	if opts.Timeouts.Post == 0 {
		opts.Timeouts.Post = 2 * time.Second
	}
	if opts.Timeouts.StreamChunk == 0 {
		opts.Timeouts.StreamChunk = 50 * time.Millisecond
	}
	return &Client{
		endpoint: opts.ControlPlaneBaseURL + "/api/internal/gateway/guardrail/check",
		http:     &http.Client{Timeout: 3 * time.Second}, // hard upper bound
		sign:     opts.Sign,
		logger:   opts.Logger,
		timeouts: opts.Timeouts,
	}
}

// Check fans out to every guardrail id in parallel. First block wins.
// Returns Allow if guardrailIDs is empty.
func (c *Client) Check(parent context.Context, req Request) (Result, error) {
	if len(req.GuardrailIDs) == 0 {
		return Result{Verdict: VerdictAllow}, nil
	}
	timeout := c.timeoutFor(req.Direction)
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	type one struct {
		res Result
		err error
	}
	out := make(chan one, len(req.GuardrailIDs))
	var wg sync.WaitGroup
	for _, id := range req.GuardrailIDs {
		wg.Add(1)
		go func(gid string) {
			defer wg.Done()
			singleReq := req
			singleReq.GuardrailIDs = []string{gid}
			res, err := c.callOne(ctx, singleReq)
			select {
			case out <- one{res: res, err: err}:
			case <-ctx.Done():
			}
		}(id)
	}
	go func() { wg.Wait(); close(out) }()

	var policies []string
	modified := req.Content.Messages // start with original
	var firstError error
	errCount := 0
	okCount := 0
	for r := range out {
		if r.err != nil {
			errCount++
			if firstError == nil {
				firstError = r.err
			}
			continue
		}
		okCount++
		policies = append(policies, r.res.PoliciesTriggered...)
		if r.res.Verdict == VerdictBlock {
			cancel() // short-circuit the rest
			return Result{
				Verdict:           VerdictBlock,
				Reason:            r.res.Reason,
				PoliciesTriggered: policies,
			}, nil
		}
		if r.res.Verdict == VerdictModify && len(r.res.ModifiedBody) > 0 {
			modified = r.res.ModifiedBody
		}
	}
	// Fail-closed if no guardrail returned a decision (all errored or
	// cancelled). The dispatcher decides what to do with the error —
	// surface service_unavailable unless the VK has fail-open set.
	if okCount == 0 {
		if firstError != nil {
			return Result{}, firstError
		}
		return Result{}, errors.New("no guardrail responded")
	}
	if len(policies) == 0 && bytes.Equal(modified, req.Content.Messages) {
		return Result{Verdict: VerdictAllow}, nil
	}
	return Result{
		Verdict:           VerdictModify,
		ModifiedBody:      modified,
		PoliciesTriggered: policies,
	}, nil
}

// CheckChunk is the hot-path SSE variant: single chunk, 50ms budget, and
// fail-open by default (pass chunk through unmodified). Any policy
// violation short-circuits the stream with Block.
func (c *Client) CheckChunk(parent context.Context, req Request) Result {
	ctx, cancel := context.WithTimeout(parent, c.timeoutFor(DirectionStreamChunk))
	defer cancel()
	res, err := c.callOne(ctx, req)
	if err != nil {
		// Stream-chunk fail-open per contract §7b.
		return Result{Verdict: VerdictAllow, FailOpenReason: err.Error()}
	}
	return res
}

func (c *Client) timeoutFor(d Direction) time.Duration {
	switch d {
	case DirectionRequest:
		return c.timeouts.Pre
	case DirectionResponse:
		return c.timeouts.Post
	case DirectionStreamChunk:
		return c.timeouts.StreamChunk
	}
	return c.timeouts.Pre
}

func (c *Client) callOne(ctx context.Context, req Request) (Result, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return Result{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.endpoint, bytes.NewReader(body))
	if err != nil {
		return Result{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if c.sign != nil {
		c.sign(httpReq, body)
	}
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return Result{}, fmt.Errorf("guardrail transport: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return Result{}, fmt.Errorf("guardrail upstream %d: %s", resp.StatusCode, string(b))
	}
	var r response
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return Result{}, fmt.Errorf("guardrail decode: %w", err)
	}
	return Result{
		Verdict:           Verdict(r.Decision),
		Reason:            r.Reason,
		ModifiedBody:      []byte(r.ModifiedContent),
		PoliciesTriggered: r.PoliciesTriggered,
	}, nil
}
