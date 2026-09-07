package spendemitter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/langwatch/langwatch/services/aigateway/adapters/controlplane"
)

// IngestPath is the control-plane route that accepts spend-command batches.
// Server side: idempotent on (tenant, gateway_request_id, command).
const IngestPath = "/api/internal/gateway/spend-commands"

// IngestClient POSTs record batches to the control plane, signed with the
// same gateway HMAC scheme every other internal call uses.
type IngestClient struct {
	endpoint string
	signer   *controlplane.Signer
	client   *http.Client
}

// NewIngestClient builds the client. baseURL is the control plane origin.
func NewIngestClient(baseURL string, signer *controlplane.Signer) (*IngestClient, error) {
	endpoint, err := url.JoinPath(baseURL, IngestPath)
	if err != nil {
		return nil, fmt.Errorf("spendemitter: ingest url: %w", err)
	}
	return &IngestClient{
		endpoint: endpoint,
		signer:   signer,
		client:   &http.Client{Timeout: 10 * time.Second},
	}, nil
}

type batchEnvelope struct {
	Records []Record `json:"records"`
}

// Ship delivers one batch. Any non-2xx answer is an error; the drainer
// retries with backoff and never truncates unacked segments.
func (c *IngestClient) Ship(ctx context.Context, records []Record) error {
	if len(records) == 0 {
		return nil
	}
	body, err := json.Marshal(batchEnvelope{Records: records})
	if err != nil {
		return fmt.Errorf("spendemitter: marshal batch: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	c.signer.Sign(req, body)

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		excerpt, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("spendemitter: ingest answered %d: %s", resp.StatusCode, excerpt)
	}
	return nil
}
