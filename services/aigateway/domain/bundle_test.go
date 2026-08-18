package domain

import (
	"testing"
	"time"
)

// The gateway cache and the control plane have to agree on the boundary
// instant. The control plane refuses the key when its expiration date is at or
// below the current time, so a cache that treated the exact date as still
// valid would serve one request the control plane rejects, and the customer
// would see the key work and then fail for the same instant.
func TestBundleKeyExpired_TreatsTheDateItselfAsExpired(t *testing.T) {
	date := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)
	bundle := &Bundle{VirtualKeyExpiresAt: date}

	t.Run("when now is before the date", func(t *testing.T) {
		if bundle.KeyExpired(date.Add(-time.Nanosecond)) {
			t.Error("a key one instant short of its date still serves")
		}
	})

	t.Run("when now is exactly the date", func(t *testing.T) {
		if !bundle.KeyExpired(date) {
			t.Error("the expiration instant itself must be refused, matching the control plane")
		}
	})

	t.Run("when now is past the date", func(t *testing.T) {
		if !bundle.KeyExpired(date.Add(time.Nanosecond)) {
			t.Error("a key past its date must be refused")
		}
	})
}

func TestBundleKeyExpired_WithNoDateNeverExpires(t *testing.T) {
	bundle := &Bundle{}

	if bundle.KeyExpired(time.Now().Add(100 * 365 * 24 * time.Hour)) {
		t.Error("the zero value means the key has no expiration date")
	}
}
