package otlpjson

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/cenkalti/backoff/v5"
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
	// InitialInterval is the wait before the first retry; it grows 1.5x per
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

// As hands backoff.Retry the server's Retry-After, so it waits that long.
func (e *retryableError) As(target any) bool {
	t, ok := target.(**backoff.RetryAfterError)
	if !ok || e.retryAfter <= 0 {
		return false
	}
	*t = &backoff.RetryAfterError{Duration: e.retryAfter}
	return true
}

// do runs attempt until it succeeds, fails permanently, or the retry budget
// or ctx is exhausted. Only a *retryableError is retried.
func (c RetryConfig) do(ctx context.Context, attempt func(context.Context) error) error {
	var last *retryableError
	op := func() (struct{}, error) {
		err := attempt(ctx)
		if err == nil {
			return struct{}{}, nil
		}
		if !errors.As(err, &last) || c.Disabled {
			return struct{}{}, backoff.Permanent(err)
		}
		return struct{}{}, last
	}
	b := &backoff.ExponentialBackOff{
		InitialInterval:     c.InitialInterval,
		RandomizationFactor: backoff.DefaultRandomizationFactor,
		Multiplier:          backoff.DefaultMultiplier,
		MaxInterval:         c.MaxInterval,
	}
	_, err := backoff.Retry(ctx, op, backoff.WithBackOff(b), backoff.WithMaxElapsedTime(c.MaxElapsedTime))

	var retryable *retryableError
	switch {
	case err == nil:
		return nil
	case errors.As(err, &retryable) && c.Disabled:
		return retryable.err
	case errors.As(err, &retryable):
		return fmt.Errorf("otlpjson: retry budget of %s exhausted: %w", c.MaxElapsedTime, retryable.err)
	case last != nil && errors.Is(err, context.Cause(ctx)):
		return fmt.Errorf("%w (last attempt: %v)", err, last.err)
	default:
		return err
	}
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
