package mcpsim

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// attemptState is what one send has already done to recover.
type attemptState struct {
	kind                           string
	isInSession                    bool
	attempt                        int
	hasRefreshed, hasReinitialized bool
}

// send delivers msg and recovers the way a spec client does: a lost session (404)
// re-initializes without signing in again, a 401 refreshes the OAuth token and
// retries, a 503 (or 502, 504, no answer) backs off and retries.
func (c *mcpClient) send(ctx context.Context, msg map[string]any, isInSession bool) (exchange, error) {
	st := &attemptState{kind: msg["method"].(string), isInSession: isInSession}
	for ; ; st.attempt++ {
		x := c.post(ctx, msg)
		retry, err := c.handle(ctx, st, x)
		if !retry {
			return x, err
		}
	}
}

// handle decides what one answer means: done, done with an error, or try again.
func (c *mcpClient) handle(ctx context.Context, st *attemptState, x exchange) (bool, error) {
	switch {
	case answered(x, strings.HasPrefix(st.kind, "notifications/")):
		c.record(outcome{kind: st.kind, method: http.MethodPost, x: x, ok: true, detail: okDetail(st.kind, x)})
		return false, nil
	case ctx.Err() != nil:
		c.record(outcome{kind: st.kind, method: http.MethodPost, x: x, detail: "stopped"})
		return false, ctx.Err()
	case x.status == http.StatusNotFound && st.isInSession && c.sessionID != "":
		return c.onLost(ctx, st, x)
	case x.status == http.StatusUnauthorized && c.flow == FlowOAuth && !st.hasRefreshed:
		return c.onUnauthorized(ctx, st, x)
	case retryable(x) && st.attempt < maxRetries:
		return c.onUnavailable(ctx, st, x)
	}
	detail := failDetail(x)
	c.record(outcome{kind: st.kind, method: http.MethodPost, x: x, detail: detail})
	c.rn.counted(func(l *LoadStats) { l.Errors++ })
	return false, fmt.Errorf("%s on %s: %s", st.kind, c.path, firstOf(errText(x), detail))
}

// answered is a 2xx for a notification, or a 200 carrying a JSON-RPC result for a request.
func answered(x exchange, isNotification bool) bool {
	switch {
	case x.err != nil:
		return false
	case isNotification:
		return x.status/100 == 2
	}
	return x.status == http.StatusOK && x.message != nil && x.message.Error == nil
}

// onLost is the spec's answer to a 404 for the session: open a new one with the same credentials.
func (c *mcpClient) onLost(ctx context.Context, st *attemptState, x exchange) (bool, error) {
	c.record(outcome{kind: st.kind, method: http.MethodPost, x: x, ok: !st.hasReinitialized, detail: "session lost (404)"})
	if !c.shouldReinitOn404 {
		return false, errSessionLost
	}
	if st.hasReinitialized {
		return false, errors.New("the session was lost again right after re-initializing")
	}
	st.hasReinitialized = true
	c.reinits++
	c.rn.counted(func(l *LoadStats) { l.Reinitialized++ })
	c.note("re-initialize", "a spec client opens a new session with the same credentials, no new sign-in", true)
	if err := c.initialize(ctx); err != nil {
		return false, fmt.Errorf("re-initializing after a lost session: %w", err)
	}
	return true, nil
}

// onUnauthorized refreshes the OAuth token once and retries.
func (c *mcpClient) onUnauthorized(ctx context.Context, st *attemptState, x exchange) (bool, error) {
	c.record(outcome{kind: st.kind, method: http.MethodPost, x: x, ok: true, detail: "401: refresh the token and retry; " + challengeOf(x)})
	st.hasRefreshed = true
	c.refreshes++
	c.rn.counted(func(l *LoadStats) { l.Refreshed++ })
	if err := c.s.refreshAfter(ctx, c.rn); err != nil {
		return false, fmt.Errorf("refreshing after a 401 (a real client would ask the person to sign in again): %w", err)
	}
	return true, nil
}

// onUnavailable backs off and retries.
func (c *mcpClient) onUnavailable(ctx context.Context, st *attemptState, x exchange) (bool, error) {
	wait := backoff(x, st.attempt)
	c.record(outcome{kind: st.kind, method: http.MethodPost, x: x, ok: true, detail: fmt.Sprintf("retry in %s", wait)})
	c.retries++
	c.rn.counted(func(l *LoadStats) { l.Retried++ })
	if !c.s.sleep(ctx, wait) {
		return false, ctx.Err()
	}
	return true, nil
}

func retryable(x exchange) bool {
	return x.err != nil || x.status == http.StatusServiceUnavailable || x.status == http.StatusBadGateway || x.status == http.StatusGatewayTimeout
}

// backoff is Retry-After where the server named one (up to maxRetryWait), else doubling from firstBackoff.
func backoff(x exchange, attempt int) time.Duration {
	if x.header != nil {
		if secs, err := strconv.Atoi(x.header.Get("Retry-After")); err == nil && secs >= 0 {
			return min(time.Duration(secs)*time.Second, maxRetryWait)
		}
	}
	return firstBackoff << attempt
}

func challengeOf(x exchange) string {
	if x.header == nil {
		return ""
	}
	if c := x.header.Get("WWW-Authenticate"); c != "" {
		return "WWW-Authenticate: " + c
	}
	return "no WWW-Authenticate challenge"
}

func okDetail(kind string, x exchange) string {
	switch {
	case kind == kindInitialize:
		return "session " + hint(x.sessionID)
	case x.message != nil && strings.Contains(string(x.message.Result), `"isError":true`):
		return "answered, the tool reported an error"
	}
	return ""
}

func failDetail(x exchange) string {
	switch x.status {
	case http.StatusUnauthorized:
		return "401: the bearer was refused; " + challengeOf(x)
	case http.StatusNotFound:
		return "404 before any session was open"
	case http.StatusServiceUnavailable:
		return "503 after every retry"
	case 0:
		return "no answer"
	}
	return fmt.Sprintf("answered %d", x.status)
}

func errText(x exchange) string {
	if x.err != nil {
		return x.err.Error()
	}
	if x.message != nil && x.message.Error != nil {
		return x.message.Error.Error()
	}
	return ""
}
