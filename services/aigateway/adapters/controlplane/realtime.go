package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The control plane owns the record of open realtime voice sessions
// (ADR-097). The gateway keeps none of its own: a session outlives the
// request that minted it, the vendor's post-call report lands on whichever
// replica answers next, and the per-key cap has to be counted somewhere that
// every replica sees.

const (
	realtimeSessionsPath = "/api/internal/gateway/realtime-sessions"
	// realtimeRegistryTimeout bounds a registry call. The mint holds a
	// caller while this runs, and a caller here is a person waiting to
	// speak, so it is short: the alternative to a fast refusal is a slow
	// one.
	realtimeRegistryTimeout = 3 * time.Second
	realtimeMaxResponseBody = 32 << 10
)

// reserveRequest books a session and asks the control plane to decide the
// per-key cap in the same transaction that inserts the row.
type reserveRequest struct {
	SessionID       string `json:"session_id"`
	ProjectID       string `json:"project_id"`
	OrganizationID  string `json:"organization_id"`
	VirtualKeyID    string `json:"virtual_key_id"`
	ModelProviderID string `json:"model_provider_id"`
	TraceID         string `json:"trace_id"`
	RequestedModel  string `json:"requested_model"`
	Vendor          string `json:"vendor"`
	AgentID         string `json:"agent_id,omitempty"`
	Model           string `json:"model"`
}

// realtimeUsageWire is the quantity vocabulary the spend wire already
// speaks. Same field names, so the control plane validates it with the same
// schema it validates a confirmation with and hands it straight on.
type realtimeUsageWire struct {
	InputTokens       int `json:"input_tokens"`
	OutputTokens      int `json:"output_tokens"`
	CacheReadTokens   int `json:"cache_read_input_tokens"`
	InputAudioTokens  int `json:"input_audio_tokens"`
	OutputAudioTokens int `json:"output_audio_tokens"`
	AudioMS           int `json:"audio_ms"`
}

// Reserve books a session, or answers why it may not open.
func (c *Client) Reserve(ctx context.Context, r domain.RealtimeReservation) error {
	payload, err := json.Marshal(reserveRequest{
		SessionID:       r.SessionID,
		ProjectID:       r.ProjectID,
		OrganizationID:  r.OrganizationID,
		VirtualKeyID:    r.VirtualKeyID,
		ModelProviderID: r.ModelProviderID,
		TraceID:         r.TraceID,
		RequestedModel:  r.RequestedModel,
		Vendor:          string(r.Vendor),
		AgentID:         r.AgentID,
		Model:           r.Model,
	})
	if err != nil {
		return realtimeRegistryUnavailable(ctx, 0, err)
	}
	status, body, err := c.realtimeCall(ctx, realtimeRequest{
		method: http.MethodPost, path: realtimeSessionsPath, payload: payload,
	})
	if err != nil {
		return realtimeRegistryUnavailable(ctx, 0, err)
	}
	switch {
	case status >= 200 && status < 300:
		return nil
	case status == http.StatusTooManyRequests:
		var refusal struct {
			Error struct {
				Open  int `json:"open"`
				Limit int `json:"limit"`
			} `json:"error"`
		}
		_ = json.Unmarshal(body, &refusal)
		return herr.New(ctx, domain.ErrRealtimeSessionLimit, herr.M{
			"message": "this virtual key already holds the most realtime voice sessions it may keep open at once. A session frees its slot when the call ends",
			"fault":   "customer",
			"open":    refusal.Error.Open,
			"limit":   refusal.Error.Limit,
		})
	default:
		return realtimeRegistryUnavailable(ctx, status, nil)
	}
}

// Correlate records the vendor's own conversation id against a booking.
func (c *Client) Correlate(ctx context.Context, correlation domain.RealtimeCorrelation) error {
	payload, err := json.Marshal(map[string]string{
		"project_id":             correlation.ProjectID,
		"vendor_conversation_id": correlation.VendorConversationID,
	})
	if err != nil {
		return err
	}
	return c.realtimePatch(ctx, correlation.SessionID, payload)
}

// Release closes a booking whose mint never produced a credential.
func (c *Client) Release(ctx context.Context, release domain.RealtimeRelease) error {
	payload, err := json.Marshal(map[string]string{
		"project_id": release.ProjectID,
		"status":     release.Status,
		"reason":     release.Reason,
	})
	if err != nil {
		return err
	}
	return c.realtimePatch(ctx, release.SessionID, payload)
}

// ReportUsage closes a session with the quantities its socket reported.
func (c *Client) ReportUsage(ctx context.Context, report domain.RealtimeUsageReport) error {
	payload, err := json.Marshal(struct {
		ProjectID    string            `json:"project_id"`
		VirtualKeyID string            `json:"virtual_key_id"`
		Usage        realtimeUsageWire `json:"usage"`
	}{
		ProjectID:    report.ProjectID,
		VirtualKeyID: report.VirtualKeyID,
		Usage: realtimeUsageWire{
			InputTokens:       report.Usage.BillableInputTokens(),
			OutputTokens:      report.Usage.CompletionTokens,
			CacheReadTokens:   report.Usage.CacheReadTokens,
			InputAudioTokens:  report.Usage.InputAudioTokens,
			OutputAudioTokens: report.Usage.OutputAudioTokens,
		},
	})
	if err != nil {
		return realtimeRegistryUnavailable(ctx, 0, err)
	}
	path, err := url.JoinPath(realtimeSessionsPath, url.PathEscape(report.SessionID), "usage")
	if err != nil {
		return realtimeRegistryUnavailable(ctx, 0, err)
	}
	status, _, err := c.realtimeCall(ctx, realtimeRequest{
		method: http.MethodPost, path: path, payload: payload,
	})
	if err != nil {
		return realtimeRegistryUnavailable(ctx, 0, err)
	}
	if status == http.StatusNotFound {
		return herr.New(ctx, domain.ErrNotFound, herr.M{
			"message": "no open realtime session with that id belongs to this key",
			"fault":   "customer",
		})
	}
	if status < 200 || status >= 300 {
		return realtimeRegistryUnavailable(ctx, status, nil)
	}
	return nil
}

// realtimePatch updates one session record. Transport failures come back as
// ErrRealtimeRegistryUnavailable, the same code Reserve and ReportUsage
// return, so a caller can classify a registry outage without knowing which
// verb reached it.
func (c *Client) realtimePatch(ctx context.Context, sessionID string, payload []byte) error {
	path, err := url.JoinPath(realtimeSessionsPath, url.PathEscape(sessionID))
	if err != nil {
		return realtimeRegistryUnavailable(ctx, 0, err)
	}
	status, _, err := c.realtimeCall(ctx, realtimeRequest{
		method: http.MethodPatch, path: path, payload: payload,
	})
	if err != nil {
		return realtimeRegistryUnavailable(ctx, 0, err)
	}
	if status < 200 || status >= 300 {
		return realtimeRegistryUnavailable(ctx, status, nil)
	}
	return nil
}

// realtimeRequest is one registry call: the verb, the path under the
// control plane's base URL, and the body to sign and send.
type realtimeRequest struct {
	method  string
	path    string
	payload []byte
}

// realtimeCall performs one signed registry request under its own deadline.
func (c *Client) realtimeCall(ctx context.Context, call realtimeRequest) (int, []byte, error) {
	ctx, cancel := context.WithTimeout(ctx, realtimeRegistryTimeout)
	defer cancel()

	endpoint, err := url.JoinPath(c.baseURL, call.path)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, call.method, endpoint, bytes.NewReader(call.payload))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	c.setCommonHeaders(req)
	// The signature covers the method and path, so PATCH signs as PATCH.
	c.sign(req, call.payload)

	resp, err := c.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, realtimeMaxResponseBody))
	return resp.StatusCode, body, nil
}

// realtimeRegistryUnavailable is the refusal when the session could not be
// recorded. The message says the mint did not happen, because the caller's
// next move is to retry rather than to look for a credential.
func realtimeRegistryUnavailable(ctx context.Context, status int, cause error) error {
	meta := herr.M{
		"message":     "the voice session could not be recorded, so no session credential was minted. Retry shortly",
		"fault":       "gateway",
		"http_status": status,
	}
	if cause == nil {
		return herr.New(ctx, domain.ErrRealtimeRegistryUnavailable, meta)
	}
	return herr.New(ctx, domain.ErrRealtimeRegistryUnavailable, meta, cause)
}
