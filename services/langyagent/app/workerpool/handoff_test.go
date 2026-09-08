package workerpool

import (
	"context"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"
)

type shutdownNotice struct {
	sessionID string
	deadline  time.Time
}

type handoffRecordingAgent struct {
	seedRecordingAgent
	notices           chan shutdownNotice
	waitUntilCanceled bool
}

func (a *handoffRecordingAgent) NotifyShutdownImminent(ctx context.Context, sessionID string, deadline time.Time) error {
	a.notices <- shutdownNotice{sessionID: sessionID, deadline: deadline}
	if a.waitUntilCanceled {
		<-ctx.Done()
		return ctx.Err()
	}
	return nil
}

func startHandoff(p *Pool, deadline time.Time) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		p.ShutdownHandoff(context.Background(), deadline)
		close(done)
	}()
	return done
}

func assertHandoffPending(t *testing.T, done <-chan struct{}) {
	t.Helper()
	synctest.Wait()
	select {
	case <-done:
		t.Fatal("handoff returned while a turn was still in flight")
	default:
	}
}

func assertHandoffReturned(t *testing.T, done <-chan struct{}) {
	t.Helper()
	synctest.Wait()
	select {
	case <-done:
	default:
		t.Fatal("handoff has not returned")
	}
}

// @scenario "On SIGTERM the manager notifies each live worker before killing it"
func TestPool_ShutdownHandoff_NotifiesEveryWorkerAndWaitsForAllTurns(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		p := newTestPool(4)
		notices := make(chan shutdownNotice, 3)
		agent := &handoffRecordingAgent{notices: notices}
		first := claimedWorker(t, p, "conv-first", "turn-first", agent)
		second := claimedWorker(t, p, "conv-second", "turn-second", agent)
		idle := claimedWorker(t, p, "conv-idle", "turn-idle", agent)
		first.sessionID = "session-first"
		second.sessionID = "session-second"
		idle.sessionID = "session-idle"
		idle.Release()

		deadline := time.Now().Add(5 * time.Second)
		done := startHandoff(p, deadline)
		assertHandoffPending(t, done)
		require.Len(t, notices, 3, "every live worker must receive a notice")
		got := make([]shutdownNotice, 0, 3)
		for range 3 {
			got = append(got, <-notices)
		}
		require.ElementsMatch(t, []shutdownNotice{
			{sessionID: "session-first", deadline: deadline},
			{sessionID: "session-second", deadline: deadline},
			{sessionID: "session-idle", deadline: deadline},
		}, got)

		first.Release()
		time.Sleep(100 * time.Millisecond)
		assertHandoffPending(t, done)

		second.Release()
		time.Sleep(100 * time.Millisecond)
		assertHandoffReturned(t, done)
		require.True(t, time.Now().Before(deadline), "quiescence must finish handoff before its deadline")
	})
}

func TestPool_ShutdownHandoff_CapsStuckWorkAtDeadline(t *testing.T) {
	for _, tc := range []struct {
		name              string
		waitUntilCanceled bool
	}{
		{name: "turn never quiesces"},
		{name: "notification never finishes", waitUntilCanceled: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				p := newTestPool(1)
				agent := &handoffRecordingAgent{
					notices:           make(chan shutdownNotice, 1),
					waitUntilCanceled: tc.waitUntilCanceled,
				}
				worker := claimedWorker(t, p, "conv-stuck", "turn-stuck", agent)
				deadline := time.Now().Add(250 * time.Millisecond)
				done := startHandoff(p, deadline)

				assertHandoffPending(t, done)
				require.Len(t, agent.notices, 1)
				time.Sleep(249 * time.Millisecond)
				assertHandoffPending(t, done)
				time.Sleep(time.Millisecond)
				assertHandoffReturned(t, done)
				require.True(t, worker.isInFlight(), "deadline must allow drain despite an unfinished turn")
			})
		})
	}
}

func TestPool_ShutdownHandoff_EmptyPoolReturnsImmediately(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		p := newTestPool(1)
		start := time.Now()
		done := startHandoff(p, start.Add(5*time.Second))

		assertHandoffReturned(t, done)
		require.Equal(t, start, time.Now(), "an empty pool must not wait for its deadline")
	})
}
