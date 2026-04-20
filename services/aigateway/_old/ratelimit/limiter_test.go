package ratelimit

import (
	"testing"
	"time"
)

func newLimiter(t *testing.T) *Limiter {
	t.Helper()
	l, err := New(Options{})
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func TestAllow_NoLimits_IsNoOp(t *testing.T) {
	l := newLimiter(t)
	for i := 0; i < 100; i++ {
		if !l.Allow("vk_01", Config{}).Allowed {
			t.Fatal("VK with no limits must always allow")
		}
	}
}

func TestRPM_BurstThenBlocks(t *testing.T) {
	l := newLimiter(t)
	cfg := Config{RPM: 5}
	for i := 0; i < 5; i++ {
		if !l.Allow("vk_01", cfg).Allowed {
			t.Fatalf("expected burst of 5 to succeed; failed at i=%d", i)
		}
	}
	d := l.Allow("vk_01", cfg)
	if d.Allowed {
		t.Fatal("6th request in the burst should be denied")
	}
	if d.Dimension != "rpm" {
		t.Errorf("wrong dimension: %q", d.Dimension)
	}
	if d.RetryAfter <= 0 || d.RetryAfter > 15*time.Second {
		t.Errorf("expected RetryAfter ~12s, got %s", d.RetryAfter)
	}
}

func TestRPD_BurstThenBlocks(t *testing.T) {
	l := newLimiter(t)
	cfg := Config{RPD: 3}
	for i := 0; i < 3; i++ {
		if !l.Allow("vk_01", cfg).Allowed {
			t.Fatalf("RPD burst of 3 must pass at i=%d", i)
		}
	}
	d := l.Allow("vk_01", cfg)
	if d.Allowed {
		t.Error("4th request should breach RPD")
	}
	if d.Dimension != "rpd" {
		t.Errorf("wrong dimension: %q", d.Dimension)
	}
}

func TestSeparateVKs_DoNotCross(t *testing.T) {
	l := newLimiter(t)
	cfg := Config{RPM: 1}
	if !l.Allow("vk_A", cfg).Allowed {
		t.Fatal("vk_A first should allow")
	}
	if !l.Allow("vk_B", cfg).Allowed {
		t.Fatal("vk_B must not inherit vk_A's counters")
	}
	if l.Allow("vk_A", cfg).Allowed {
		t.Fatal("vk_A second should block (RPM=1)")
	}
}

func TestCeilingChange_RebuildsBuckets(t *testing.T) {
	l := newLimiter(t)
	// Start with RPM=1; first passes, second blocks.
	_ = l.Allow("vk_01", Config{RPM: 1})
	if l.Allow("vk_01", Config{RPM: 1}).Allowed {
		t.Fatal("precondition: RPM=1 should deny second request")
	}
	// Raise the ceiling; config-refresh path.
	d := l.Allow("vk_01", Config{RPM: 100})
	if !d.Allowed {
		t.Error("expected fresh bucket after ceiling change to allow")
	}
}

func TestBothDimensions_DoNotDoubleCount(t *testing.T) {
	// If RPM denies we must NOT also decrement RPD's bucket. Otherwise
	// a burst-capped VK would burn daily quota it never consumed.
	l := newLimiter(t)
	cfg := Config{RPM: 1, RPD: 1000}
	_ = l.Allow("vk_01", cfg) // RPM token gone
	d := l.Allow("vk_01", cfg)
	if d.Allowed || d.Dimension != "rpm" {
		t.Fatalf("expected RPM dimension deny, got %+v", d)
	}
	// RPD should still have ~999 tokens — raise RPM ceiling and make
	// sure RPD isn't already spent.
	if !l.Allow("vk_01", Config{RPM: 1000, RPD: 1000}).Allowed {
		t.Error("RPD shouldn't have been burned by the RPM-denied request")
	}
}

func TestInvalidate_ResetsBuckets(t *testing.T) {
	l := newLimiter(t)
	cfg := Config{RPM: 1}
	_ = l.Allow("vk_01", cfg)
	if l.Allow("vk_01", cfg).Allowed {
		t.Fatal("precondition: second request should deny")
	}
	l.Invalidate("vk_01")
	if !l.Allow("vk_01", cfg).Allowed {
		t.Error("Invalidate should reset the bucket")
	}
}
