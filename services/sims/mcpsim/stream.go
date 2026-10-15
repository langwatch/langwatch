package mcpsim

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

// streamResult is how a held GET event stream ended.
type streamResult struct {
	status     int
	isOpened   bool
	heldFor    time.Duration
	wasDropped bool // the server or a proxy ended it before the hold was up
	events     int
	comments   int
	lastError  string
}

// hold opens the server-to-client event stream and keeps it until hold is up or it drops.
func (c *mcpClient) hold(parent context.Context, hold time.Duration) streamResult {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	began := time.Now()
	resp, res := c.openStream(ctx)
	if resp == nil {
		return res
	}
	defer func() { _ = resp.Body.Close() }()
	c.record(outcome{kind: "stream", method: http.MethodGet, x: exchange{status: resp.StatusCode, took: time.Since(began)}, ok: true,
		detail: "event stream open; holding " + hold.String()})
	var expired atomic.Bool
	timer := time.AfterFunc(hold, func() { expired.Store(true); cancel() })
	defer timer.Stop()
	err := readSSE(resp.Body, func(ev sseEvent) bool {
		if ev.isComment {
			res.comments++
		} else {
			res.events++
		}
		return true
	})
	res.heldFor = time.Since(began)
	switch {
	case expired.Load():
	case parent.Err() != nil:
		res.lastError = "stopped"
	default:
		res.wasDropped, res.lastError = true, firstOf(errString(err), "the stream ended (EOF)")
	}
	return res
}

// openStream sends the GET; a nil response means it did not open (and was recorded).
func (c *mcpClient) openStream(ctx context.Context) (*http.Response, streamResult) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url(), nil)
	if err != nil {
		return nil, streamResult{lastError: err.Error()}
	}
	req.Header.Set("Accept", "text/event-stream")
	c.decorate(req)
	began := time.Now()
	resp, err := c.s.http.Do(req)
	if err != nil {
		c.record(outcome{kind: "stream", method: http.MethodGet, x: exchange{err: err, took: time.Since(began)}, detail: "open the event stream"})
		return nil, streamResult{lastError: err.Error()}
	}
	res := streamResult{status: resp.StatusCode, isOpened: true}
	if resp.StatusCode == http.StatusOK && strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		return resp, res
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	_ = resp.Body.Close()
	c.record(outcome{kind: "stream", method: http.MethodGet, x: exchange{status: resp.StatusCode, body: body, took: time.Since(began)},
		detail: "the event stream did not open: " + resp.Header.Get("Content-Type")})
	return nil, streamResult{status: resp.StatusCode}
}
