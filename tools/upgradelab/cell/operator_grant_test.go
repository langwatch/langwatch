package cell

import (
	"testing"
	"time"
)

func TestOperatorGrantRetriesOnlyWhatALaterAttemptCanOutgrow(t *testing.T) {
	retry := grantRetry{budget: 5 * time.Minute, first: 5 * time.Second, ceiling: time.Minute}
	pending := []byte(`{"level":"fatal","error":{"type":"AuthzGrantNotConfirmedError","code":"authz_grant_not_confirmed"}}`)
	var waits []time.Duration
	for attempt := 1; attempt <= 6; attempt++ {
		delay, again := retry.wait(attempt, 0, pending)
		if !again {
			t.Fatalf("attempt %d gave up within the budget", attempt)
		}
		waits = append(waits, delay)
	}
	want := []time.Duration{5 * time.Second, 10 * time.Second, 20 * time.Second, 40 * time.Second, time.Minute, time.Minute}
	for i := range want {
		if waits[i] != want[i] {
			t.Errorf("waits %v, want %v", waits, want)
			break
		}
	}
	if delay, again := retry.wait(5, 4*time.Minute+50*time.Second, pending); !again || delay != 10*time.Second {
		t.Errorf("near the end: %v %v, want the 10 s left", delay, again)
	}
	if _, again := retry.wait(3, 5*time.Minute, pending); again {
		t.Error("retried past the budget")
	}
	if _, again := retry.wait(1, 0, []byte("PlatformOperatorUserNotFoundError: no such user")); again {
		t.Error("retried an answer no later attempt changes")
	}
	if _, again := retry.wait(1, 0, []byte("connect ECONNREFUSED 127.0.0.1:5432")); !again {
		t.Error("gave up on a store that was not answering yet")
	}
}
