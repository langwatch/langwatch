package visualdiff

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"time"
)

// Probe reports whether one URL is answering. A run polls every listener
// through one of these; the HTTP probe is the real one, and tests pass their
// own.
type Probe func(ctx context.Context, url string) bool

// WaitOptions carries how a run waits: how long it has, what it asks, and
// where it says a listener came up.
type WaitOptions struct {
	Timeout  time.Duration
	Probe    Probe
	Progress func(url string)
}

// HTTPProbe answers true for any response at all below 500. A screen behind a
// redirect or a 404 still proves the listener is up, which is what readiness
// means here; a 5xx does not, because a stack that boots into an error is not
// ready to be photographed.
func HTTPProbe(ctx context.Context, url string) bool {
	client := &http.Client{Timeout: 5 * time.Second}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode < 500
}

// WaitForListeners polls every URL until each one answers, or fails naming
// the first one that never did. Polling is what a boot needs: a stack's first
// Vite build takes minutes on a cold worktree, and a fixed sleep either
// wastes that time or photographs a half-built page.
func WaitForListeners(ctx context.Context, urls []string, options WaitOptions) error {
	if options.Probe == nil {
		options.Probe = HTTPProbe
	}
	waiting := waiter{options: options, deadline: time.Now().Add(options.Timeout)}
	for _, url := range urls {
		if err := waiting.one(ctx, url); err != nil {
			return err
		}
	}
	return nil
}

// waiter polls one listener at a time against a shared deadline.
type waiter struct {
	options  WaitOptions
	deadline time.Time
}

func (waiting waiter) one(ctx context.Context, url string) error {
	for {
		if waiting.options.Probe(ctx, url) {
			if waiting.options.Progress != nil {
				waiting.options.Progress(url)
			}
			return nil
		}
		if time.Now().After(waiting.deadline) {
			return fmt.Errorf("%s did not answer within %s", url, waiting.options.Timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

// PortListening reports whether anything holds a local port. Teardown uses it
// to verify that killing a process group actually freed what it was holding.
func PortListening(port int) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	address := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	connection, err := new(net.Dialer).DialContext(ctx, "tcp", address)
	if err != nil {
		return false
	}
	_ = connection.Close()
	return true
}
