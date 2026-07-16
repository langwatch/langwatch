package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/langwatch/langwatch/pkg/retry"
	"github.com/langwatch/langwatch/services/langyagent/app"
)

// Finalizer posts a turn's durable final result to the control plane's
// langy-internal ingest.
//
// Unlike the Revoker, this call IS a durability guarantee, not a best-effort
// tidy-up: it is the independent path by which a completed turn reaches the
// event log even when the /chat NDJSON relay dropped. So it retries — bounded —
// which is safe precisely because the ingest is idempotent on turnId: re-posting
// the same final is a no-op at the event store. The self-retrying liveness
// reactor is the final backstop when even the retries cannot land.
type Finalizer struct {
	client         *http.Client
	internalSecret string
}

// NewFinalizer builds a Finalizer. The internal secret is the SAME shared secret
// the control plane uses to call us (LANGY_INTERNAL_SECRET) — this direction
// needs no new credential and no new configuration, exactly like the Revoker.
func NewFinalizer(internalSecret string, timeout time.Duration) *Finalizer {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &Finalizer{
		client:         &http.Client{Timeout: timeout},
		internalSecret: internalSecret,
	}
}

const (
	finalizeMaxAttempts   = 3
	finalizeBackoffBaseMs = 250
)

// Finalize posts result for turnID to the control plane at endpoint, retrying a
// few times on transient (5xx / network / timeout) failures with a short
// backoff. A missing secret, endpoint, or required id makes it a no-op rather
// than an error — the liveness reactor is the backstop when a durable write
// genuinely cannot land, and a hard error here must never break a finished turn.
func (f *Finalizer) Finalize(ctx context.Context, endpoint, turnID string, result app.TurnResult) error {
	if f == nil || f.internalSecret == "" {
		return nil
	}
	if endpoint == "" || turnID == "" || result.ProjectID == "" || result.ConversationID == "" {
		return nil
	}

	body, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("marshal turn result: %w", err)
	}
	target := strings.TrimRight(endpoint, "/") +
		"/api/internal/langy/turn/" + url.PathEscape(turnID) + "/result"

	// retry.Walk gives the attempt/classify machinery; it does not sleep between
	// slots, so the backoff lives inside the attempt (skipped on the first).
	attempt := 0
	_, el, err := retry.Walk(
		ctx,
		retry.Options{MaxAttempts: finalizeMaxAttempts},
		make([]string, finalizeMaxAttempts),
		func(ctx context.Context, _ string) (struct{}, error) {
			if attempt > 0 {
				backoff := time.Duration(finalizeBackoffBaseMs<<(attempt-1)) * time.Millisecond
				select {
				case <-ctx.Done():
					return struct{}{}, ctx.Err()
				case <-time.After(backoff):
				}
			}
			attempt++
			return struct{}{}, f.postOnce(ctx, target, body)
		},
		classifyFinalizeError,
	)
	el.Release()
	return err
}

func (f *Finalizer) postOnce(ctx context.Context, target string, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build turn-result request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+f.internalSecret)

	resp, err := f.client.Do(req)
	if err != nil {
		return fmt.Errorf("post turn result: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 300 {
		return nil
	}
	return &httpStatusError{status: resp.StatusCode}
}

// httpStatusError carries a non-2xx status so the classifier can tell a
// transient 5xx from a permanent 4xx.
type httpStatusError struct{ status int }

func (e *httpStatusError) Error() string {
	return fmt.Sprintf("control plane returned %d", e.status)
}

// classifyFinalizeError decides whether a failed post is worth retrying: 5xx and
// transport failures are transient; a 4xx is our own bug (malformed body, or a
// rejected turn) and will never succeed on retry.
func classifyFinalizeError(err error) retry.Reason {
	var se *httpStatusError
	if errors.As(err, &se) {
		if se.status >= 500 {
			return retry.ReasonRetryable5xx
		}
		return retry.ReasonNonRetryable
	}
	// Transport-level failure (connection refused, reset, timeout): retry.
	return retry.ReasonNetwork
}
