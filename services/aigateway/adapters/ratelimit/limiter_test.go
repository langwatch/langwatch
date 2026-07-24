package ratelimit

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func newLimiter(t *testing.T) *Limiter {
	t.Helper()
	l, err := New(Options{MaxVKs: 100})
	require.NoError(t, err)
	return l
}

func TestAllow_NoLimits(t *testing.T) {
	l := newLimiter(t)
	err := l.Allow(context.Background(), "vk_1", domain.RateLimits{RPM: 0, RPD: 0})
	require.NoError(t, err)
}

func TestAllow_EmptyVKID(t *testing.T) {
	l := newLimiter(t)
	err := l.Allow(context.Background(), "", domain.RateLimits{RPM: 100, RPD: 1000})
	require.NoError(t, err)
}

func TestAllow_WithinRPM(t *testing.T) {
	l := newLimiter(t)
	err := l.Allow(context.Background(), "vk_1", domain.RateLimits{RPM: 100})
	require.NoError(t, err)
}

func TestAllow_RPMExceeded(t *testing.T) {
	l := newLimiter(t)
	limits := domain.RateLimits{RPM: 1}

	// First request allowed (burst = 1)
	err := l.Allow(context.Background(), "vk_1", limits)
	require.NoError(t, err)

	// Second request blocked immediately (no tokens left, rate is 1/60s)
	err = l.Allow(context.Background(), "vk_1", limits)
	assert.Error(t, err)
}

func TestAllow_RPDExceeded(t *testing.T) {
	l := newLimiter(t)
	limits := domain.RateLimits{RPD: 1}

	// First request allowed (burst = 1)
	err := l.Allow(context.Background(), "vk_1", limits)
	require.NoError(t, err)

	// Second request blocked immediately (burst exhausted, rate is 1/86400s)
	err = l.Allow(context.Background(), "vk_1", limits)
	assert.Error(t, err)
}

func TestInvalidate(t *testing.T) {
	l := newLimiter(t)
	limits := domain.RateLimits{RPM: 1}

	// Exhaust the bucket
	err := l.Allow(context.Background(), "vk_1", limits)
	require.NoError(t, err)

	err = l.Allow(context.Background(), "vk_1", limits)
	require.Error(t, err)

	// Invalidate rebuilds buckets
	l.Invalidate("vk_1")

	// Now the first request should be allowed again (fresh bucket)
	err = l.Allow(context.Background(), "vk_1", limits)
	require.NoError(t, err)
}
