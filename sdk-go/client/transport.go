package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/sdk-go/client/internal/openapi"
)

// jsonReader marshals v to JSON and returns it as an io.Reader suitable for the
// generated *WithBody request methods. The wrapper services define clean,
// well-named input types and serialise them this way rather than wrestling the
// deeply-nested anonymous structs the code generator emits for inline schemas.
func jsonReader(v any) (io.Reader, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

const contentTypeJSON = "application/json"

// rawJSON issues a JSON request to an endpoint-relative path and returns the raw
// *http.Response. It exists for the few LangWatch endpoints that are not part of
// the published OpenAPI specification and so have no generated method — notably
// POST /api/collector (used by [EvaluationsService.Create]).
//
// It deliberately routes through the same transport the generated client uses:
// the body is marshalled and made replayable via http.NewRequestWithContext (so
// the retrying transport can re-send it), and the shared auth + SDK-version
// request editor is applied, so these requests authenticate and are retried
// exactly like every other call in the SDK. The path is joined onto the
// configured endpoint; pass it with a leading slash, e.g. "/api/collector".
func (c *Client) rawJSON(ctx context.Context, method, path string, payload any) (*http.Response, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	url := strings.TrimRight(c.cfg.endpoint, "/") + path
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentTypeJSON)

	if err := c.requestEditor()(ctx, req); err != nil {
		return nil, err
	}
	return c.doer.Do(req)
}

// requestEditor returns an [openapi.RequestEditorFn] that stamps the auth and
// LangWatch SDK headers onto every outgoing request. It is installed once on the
// generated client at construction, so individual service methods never have to
// think about headers.
func (c *Client) requestEditor() openapi.RequestEditorFn {
	authHeaders := buildAuthHeaders(c.cfg.apiKey, c.cfg.projectID)
	return func(_ context.Context, req *http.Request) error {
		for k, v := range authHeaders {
			req.Header.Set(k, v)
		}
		req.Header.Set("X-Langwatch-Sdk-Name", sdkName)
		req.Header.Set("X-Langwatch-Sdk-Language", sdkLanguage)
		req.Header.Set("X-Langwatch-Sdk-Version", sdkVersion)
		if req.Header.Get("User-Agent") == "" {
			req.Header.Set("User-Agent", c.cfg.userAgent)
		}
		return nil
	}
}

// retryingDoer wraps an inner [openapi.HttpRequestDoer] (an *http.Client) with
// bounded exponential-backoff retries on HTTP 429 and 5xx responses, honouring
// any Retry-After header and the request context. It is the single transport
// every generated operation flows through, so retry policy is uniform across the
// whole SDK.
type retryingDoer struct {
	inner        openapi.HttpRequestDoer
	maxRetries   int
	retryWaitMin time.Duration
	retryWaitMax time.Duration
	rand         *rand.Rand
}

// Do executes req, retrying retryable failures up to maxRetries additional
// times. The request body is buffered up front via GetBody so it can be replayed
// on each attempt; requests without a replayable body are attempted once.
func (d *retryingDoer) Do(req *http.Request) (*http.Response, error) {
	var lastResp *http.Response
	var lastErr error

	for attempt := 0; ; attempt++ {
		// Replay the body on retries. http.NewRequestWithContext populates
		// GetBody for in-memory bodies, which is exactly what the generated
		// client produces.
		if attempt > 0 && req.GetBody != nil {
			body, err := req.GetBody()
			if err != nil {
				return nil, err
			}
			req.Body = body
		}

		resp, err := d.inner.Do(req)
		if err != nil {
			// Transport error (DNS, connection reset, context cancellation).
			// Context errors are not worth retrying.
			if ctxErr := req.Context().Err(); ctxErr != nil {
				return nil, err
			}
			lastErr = err
			lastResp = nil
		} else {
			if !isRetryableStatus(resp.StatusCode) || attempt >= d.maxRetries {
				return resp, nil
			}
			lastResp = resp
			lastErr = nil
		}

		if attempt >= d.maxRetries {
			break
		}

		wait := d.backoff(attempt, lastResp)
		// Drain and close the response body before sleeping so the connection
		// can be reused.
		if lastResp != nil {
			_, _ = io.Copy(io.Discard, lastResp.Body)
			_ = lastResp.Body.Close()
		}

		select {
		case <-req.Context().Done():
			return nil, req.Context().Err()
		case <-time.After(wait):
		}
	}

	if lastResp != nil {
		return lastResp, nil
	}
	return nil, lastErr
}

// backoff computes the delay before the next attempt. It honours a server
// Retry-After header when present (capped at retryWaitMax), otherwise applies
// exponential backoff with full jitter between retryWaitMin and retryWaitMax.
func (d *retryingDoer) backoff(attempt int, resp *http.Response) time.Duration {
	if resp != nil {
		if ra := parseRetryAfter(resp.Header.Get("Retry-After")); ra > 0 {
			if ra > d.retryWaitMax {
				return d.retryWaitMax
			}
			return ra
		}
	}

	backoff := float64(d.retryWaitMin) * math.Pow(2, float64(attempt))
	if backoff > float64(d.retryWaitMax) {
		backoff = float64(d.retryWaitMax)
	}
	// Full jitter: sleep a random duration in [0, backoff].
	return time.Duration(d.rand.Int63n(int64(backoff) + 1))
}

// isRetryableStatus reports whether an HTTP status warrants a retry: rate limits
// (429) and server errors (5xx). 4xx other than 429 are caller errors and are
// surfaced immediately.
func isRetryableStatus(code int) bool {
	return code == http.StatusTooManyRequests || (code >= 500 && code <= 599)
}

// parseRetryAfter interprets a Retry-After header value, which may be either an
// integer number of seconds or an HTTP date. Returns 0 when absent or
// unparseable.
func parseRetryAfter(value string) time.Duration {
	if value == "" {
		return 0
	}
	if secs, err := strconv.Atoi(value); err == nil {
		if secs < 0 {
			return 0
		}
		return time.Duration(secs) * time.Second
	}
	if t, err := http.ParseTime(value); err == nil {
		if d := time.Until(t); d > 0 {
			return d
		}
	}
	return 0
}

// decodeError is the error-path arm every service method funnels a non-2xx (or
// transport-failed) *http.Response through. It reads the whole body and returns
// a typed [*APIError] tagged with the supplied operation name. Reading the full
// body here is intentional: error payloads are small and the message is surfaced
// verbatim on the [*APIError].
//
// The success path does not go through this function — see [decodeInto], which
// streams the 2xx body straight off the wire without buffering it.
func decodeError(operation string, resp *http.Response, err error) error {
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return readErr
	}
	return newAPIError(operation, resp.StatusCode, resp.Status, body)
}

// decodeInto handles the *http.Response a service method received from the
// transport. On a non-2xx status (or a transport error) it defers to
// [decodeError], whose behaviour is byte-for-byte what it always was: read the
// whole body and surface it on a typed [*APIError]. Retryable statuses (429/503)
// have already been retried and re-surfaced by [retryingDoer] before they reach
// here, so this is purely the terminal-response handler.
//
// On a 2xx the body is decoded straight off the wire with a streaming
// [json.Decoder] rather than buffered with io.ReadAll first, so a large page is
// never held as raw bytes AND decoded structs simultaneously. A nil out discards
// the body (useful for 204 No Content endpoints). After a successful decode the
// body is drained and closed so the keep-alive connection is returned to the
// pool.
func decodeInto(operation string, resp *http.Response, err error, out any) error {
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return decodeError(operation, resp, err)
	}

	defer func() {
		// Drain any unread remainder so the connection can be reused, then close.
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}()

	if out == nil {
		return nil
	}

	if jsonErr := json.NewDecoder(resp.Body).Decode(out); jsonErr != nil {
		// A 2xx body that did not decode is itself worth surfacing. An empty body
		// (e.g. a 200 with no payload) yields io.EOF, which we treat as "nothing
		// to decode" rather than an error so callers passing a non-nil out for an
		// empty success response are not spuriously failed.
		if errors.Is(jsonErr, io.EOF) {
			return nil
		}
		return newAPIError(operation, resp.StatusCode, resp.Status, nil)
	}
	return nil
}
