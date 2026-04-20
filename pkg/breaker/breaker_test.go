package breaker

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testOpts(clock func() time.Time) Options {
	return Options{
		Threshold:    3,
		Window:       10 * time.Second,
		OpenDuration: 5 * time.Second,
		Clock:        clock,
	}
}

func TestAllow_ClosedState(t *testing.T) {
	now := time.Now()
	r := NewRegistry(testOpts(func() time.Time { return now }))

	assert.True(t, r.Allow("slot-a"), "new slot should allow requests (closed state)")
}

func TestRecordFailure_OpensAfterThreshold(t *testing.T) {
	now := time.Now()
	r := NewRegistry(testOpts(func() time.Time { return now }))

	for i := 0; i < 3; i++ {
		r.RecordFailure("slot-a")
	}

	assert.False(t, r.Allow("slot-a"), "breaker should be open after 3 failures")
	assert.Equal(t, Open, r.State("slot-a"))
}

func TestAllow_OpensToHalfOpenAfterDuration(t *testing.T) {
	now := time.Now()
	r := NewRegistry(testOpts(func() time.Time { return now }))

	// Trip the breaker.
	for i := 0; i < 3; i++ {
		r.RecordFailure("slot-a")
	}
	require.False(t, r.Allow("slot-a"))

	// Advance past the open duration.
	now = now.Add(6 * time.Second)

	assert.True(t, r.Allow("slot-a"), "should allow one probe request in half-open")
	// Second probe while in-flight should be rejected.
	assert.False(t, r.Allow("slot-a"), "should reject second probe in half-open")
}

func TestRecordSuccess_ResetsToClosedFromHalfOpen(t *testing.T) {
	now := time.Now()
	r := NewRegistry(testOpts(func() time.Time { return now }))

	for i := 0; i < 3; i++ {
		r.RecordFailure("slot-a")
	}

	now = now.Add(6 * time.Second)
	require.True(t, r.Allow("slot-a")) // half-open probe

	r.RecordSuccess("slot-a")

	assert.Equal(t, Closed, r.State("slot-a"))
	assert.True(t, r.Allow("slot-a"), "should allow all requests after reset to closed")
}

func TestRecordFailure_HalfOpenReopens(t *testing.T) {
	now := time.Now()
	r := NewRegistry(testOpts(func() time.Time { return now }))

	for i := 0; i < 3; i++ {
		r.RecordFailure("slot-a")
	}

	now = now.Add(6 * time.Second)
	require.True(t, r.Allow("slot-a")) // half-open probe

	r.RecordFailure("slot-a")

	assert.Equal(t, Open, r.State("slot-a"))
	assert.False(t, r.Allow("slot-a"), "should be open again after half-open failure")
}

func TestState_ReportsCorrectly(t *testing.T) {
	tests := []struct {
		name  string
		setup func(r *Registry, advance func(d time.Duration))
		want  State
	}{
		{
			name:  "new slot is closed",
			setup: func(_ *Registry, _ func(time.Duration)) {},
			want:  Closed,
		},
		{
			name: "open after threshold failures",
			setup: func(r *Registry, _ func(time.Duration)) {
				for i := 0; i < 3; i++ {
					r.RecordFailure("slot-a")
				}
			},
			want: Open,
		},
		{
			name: "half-open after open duration expires",
			setup: func(r *Registry, advance func(time.Duration)) {
				for i := 0; i < 3; i++ {
					r.RecordFailure("slot-a")
				}
				advance(6 * time.Second)
			},
			want: HalfOpen,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			now := time.Now()
			r := NewRegistry(testOpts(func() time.Time { return now }))
			tc.setup(r, func(d time.Duration) { now = now.Add(d) })
			assert.Equal(t, tc.want, r.State("slot-a"))
		})
	}
}
