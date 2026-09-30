package services

import (
	"context"
	"sync"
	"time"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// admission counts evaluations in flight and admits by rules.MayStart. A
// refused project waits for a release, up to wait, then is told it is busy.
type admission struct {
	limits rules.FairShareLimits
	wait   time.Duration

	mu       sync.Mutex
	global   int
	projects map[string]int
	changed  chan struct{} // closed and replaced on every release
}

func newAdmission(limits rules.FairShareLimits, wait time.Duration) *admission {
	return &admission{limits: limits, wait: wait, projects: map[string]int{}, changed: make(chan struct{})}
}

func (a *admission) acquire(ctx context.Context, projectID string) (release func(), err error) {
	timer := time.NewTimer(a.wait)
	defer timer.Stop()
	for {
		a.mu.Lock()
		if rules.MayStart(rules.InFlight{Global: a.global, Project: a.projects[projectID]}, a.limits) {
			a.global++
			a.projects[projectID]++
			a.mu.Unlock()
			return sync.OnceFunc(func() { a.release(projectID) }), nil
		}
		changed := a.changed
		a.mu.Unlock()

		select {
		case <-changed:
		case <-timer.C:
			return nil, a.busy(ctx)
		case <-ctx.Done():
			return nil, a.busy(ctx)
		}
	}
}

func (a *admission) release(projectID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.global--
	a.projects[projectID]--
	if a.projects[projectID] <= 0 {
		delete(a.projects, projectID)
	}
	close(a.changed)
	a.changed = make(chan struct{})
}

func (a *admission) busy(ctx context.Context) error {
	return herr.NewLight(ctx, contract.ErrBusy, herr.M{
		"message":      "too many evaluations in flight for this project",
		"retryAfterMs": a.wait.Milliseconds(),
	}).WithRetryable(true)
}
