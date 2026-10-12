package otlpjson

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"strconv"
	"time"
)

// Retry defaults, matching the official OTLP exporter.
const (
	DefaultInitialInterval = 5 * time.Second
	DefaultMaxInterval     = 30 * time.Second
	DefaultMaxElapsedTime  = time.Minute
)

// RetryConfig controls how a failed export is retried. Zero durations take
// the Default* values above.
type RetryConfig struct {
	// Disabled sends each export once.
	Disabled bool
	// InitialInterval is the wait before the first retry; it doubles per
	// attempt, with jitter, up to MaxInterval.
	InitialInterval time.Duration
	// MaxInterval caps one wait.
	MaxInterval time.Duration
	// MaxElapsedTime caps the whole export, waits included.
	MaxElapsedTime time.Duration
}

func (c RetryConfig) withDefaults() RetryConfig {
	if c.InitialInterval <= 0 {
		c.InitialInterval = DefaultInitialInterval
	}
	if c.MaxInterval <= 0 {
		c.MaxInterval = DefaultMaxInterval
	}
	if c.MaxElapsedTime <= 0 {
		c.MaxElapsedTime = DefaultMaxElapsedTime
	}
	return c
}

// retryableError marks an attempt worth repeating, with the server's
// requested wait when it sent one.
type retryableError struct {
	err        error
	retryAfter time.Duration
}

func (e *retryableError) Error() string { return e.err.Error() }
func (e *retryableError) Unwrap() error { return e.err }

// do runs attempt until it succeeds, fails permanently, or the retry budget
// or ctx is exhausted. The last attempt's error is returned unwrapped.
func (c RetryConfig) do(ctx context.Context, attempt func(context.Context) error) error {
	deadline := time.Now().Add(c.MaxElapsedTime)
	interval := c.InitialInterval
	for {
		err := attempt(ctx)
		var retryable *retryableError
		if err == nil || !errors.As(err, &retryable) {
			return err
		}
		if c.Disabled {
			return retryable.err
		}

		wait := jitter(interval)
		if retryable.retryAfter > wait {
			wait = retryable.retryAfter
		}
		if time.Now().Add(wait).After(deadline) {
			return fmt.Errorf("otlpjson: retry budget of %s exhausted: %w", c.MaxElapsedTime, retryable.err)
		}

		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return fmt.Errorf("%w (last attempt: %v)", ctx.Err(), retryable.err)
		case <-timer.C:
		}

		interval *= 2
		if interval > c.MaxInterval {
			interval = c.MaxInterval
		}
	}
}

// jitter spreads d over [d/2, 3d/2) so parallel exporters don't retry in step.
func jitter(d time.Duration) time.Duration {
	if d <= 0 {
		return 0
	}
	return d/2 + rand.N(d)
}

// parseRetryAfter reads a Retry-After header in either of its forms, delay
// seconds or an HTTP date, returning 0 when absent or unparseable.
func parseRetryAfter(header string, now time.Time) time.Duration {
	if header == "" {
		return 0
	}
	if secs, err := strconv.Atoi(header); err == nil {
		if secs < 0 {
			return 0
		}
		return time.Duration(secs) * time.Second
	}
	if at, err := http.ParseTime(header); err == nil {
		if d := at.Sub(now); d > 0 {
			return d
		}
	}
	return 0
}
