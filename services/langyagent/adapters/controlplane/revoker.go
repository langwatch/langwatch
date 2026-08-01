// Package controlplane holds the manager's OUTBOUND calls back to the LangWatch
// control plane, both authenticated with the shared LANGY_INTERNAL_SECRET:
//
//   - Revoker    — revoke a session key we were handed (see below).
//   - Finalizer  — post a turn's durable final result to the langy-internal
//     ingest (finalizer.go), the independent completion path.
//
// The Revoker's narrowness is the point: revoke a session key we were handed.
// The manager cannot ask for a key to be minted. A revoke-only surface is
// fail-closed — the worst a compromised manager can do with it is destroy its
// own access — whereas a mint surface would turn the manager into something that
// can manufacture credentials for any user it names, which is a trust-boundary
// change and not something a latency fix gets to introduce.
package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// Revoker asks the control plane to revoke a Langy session key.
type Revoker struct {
	client         *http.Client
	internalSecret string
}

// NewRevoker builds a Revoker. The internal secret is the SAME shared secret the
// control plane uses to call us (LANGY_INTERNAL_SECRET) — this direction needs no
// new credential and no new configuration.
func NewRevoker(internalSecret string, timeout time.Duration) *Revoker {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &Revoker{
		// otelhttp injects traceparent (and opens a CLIENT span), so the
		// control plane's ingest joins the turn's trace instead of starting
		// a fresh one.
		client: &http.Client{
			Timeout:   timeout,
			Transport: otelhttp.NewTransport(nil),
		},
		internalSecret: internalSecret,
	}
}

// Revoke revokes apiKeyID at the given control-plane endpoint.
//
// `endpoint` is the LangwatchEndpoint the worker was spawned with, carried on its
// Credentials — so we revoke against the same control plane that minted the key,
// with no separate configuration to drift out of sync.
//
// `projectID` scopes the revoke to the key's own tenant: the control plane
// refuses a key that is not bound to this project, so a leaked internal secret
// cannot revoke another tenant's live session key by id alone.
//
// Revocation is BEST-EFFORT by design and callers treat a failure as non-fatal:
// a worker is already dead by the time we get here, so failing loudly would turn
// "we could not tidy up" into "the user's turn broke". The key still expires, and
// the control plane's reaper is the guarantee — this call only shortens the
// window. That is also why there is no retry loop here: a key we fail to revoke
// is a key the reaper will get.
func (r *Revoker) Revoke(ctx context.Context, endpoint, projectID, apiKeyID string) error {
	if r == nil || r.internalSecret == "" {
		return nil
	}
	if endpoint == "" || apiKeyID == "" || projectID == "" {
		return nil
	}

	body, err := json.Marshal(map[string]string{
		"apiKeyId":  apiKeyID,
		"projectId": projectID,
	})
	if err != nil {
		return fmt.Errorf("marshal revoke request: %w", err)
	}

	url := strings.TrimRight(endpoint, "/") + "/api/internal/langy/credentials/revoke"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build revoke request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+r.internalSecret)

	resp, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("revoke session key: %w", err)
	}
	defer resp.Body.Close()

	// 404 is success-shaped for our purposes: the key is already gone, which is
	// the state we were asking for. Treating it as an error would make the reaper
	// racing us look like a fault.
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode < 300 {
		return nil
	}
	return fmt.Errorf("revoke session key: control plane returned %d", resp.StatusCode)
}
