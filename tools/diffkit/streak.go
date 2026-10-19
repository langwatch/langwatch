package diffkit

import (
	"fmt"
	"sort"
	"sync"
)

// ExitStopped is the exit code of a run that stopped early on purpose.
const ExitStopped = 3

// maxCauseLen keeps one long error text from being every cause of its own.
const maxCauseLen = 120

// Stopped is a run that ended early on purpose. Reason is the text after the
// tool's name ("stopping: ..."); an empty Reason means it was already printed.
type Stopped struct{ Reason string }

func (stopped *Stopped) Error() string { return stopped.Reason }

// SetupFailed marks an error from a tool's own setup (health check, sign-in,
// seeding, launching the browser): the run stops before it starts.
func SetupFailed(err error) error {
	return fmt.Errorf("stopping: setup failed: %w", err)
}

// Streak counts consecutive harness errors in the order results complete. A
// result that worked calls OK and resets it; a FAIL calls neither, so it
// neither counts nor resets. A limit of 0 or less never trips.
type Streak struct {
	mu      sync.Mutex
	limit   int
	run     int
	causes  map[string]int
	tripped *Stopped
}

// NewStreak returns a Streak that trips after limit consecutive harness errors.
func NewStreak(limit int) *Streak {
	return &Streak{limit: limit, causes: map[string]int{}}
}

// Error files one completed result that was a harness or stack error. It
// answers true once, on the result that reaches the limit.
func (streak *Streak) Error(cause string) bool {
	streak.mu.Lock()
	defer streak.mu.Unlock()
	if streak.limit <= 0 || streak.tripped != nil {
		return false
	}
	if len(cause) > maxCauseLen {
		cause = cause[:maxCauseLen]
	}
	streak.run++
	streak.causes[cause]++
	if streak.run < streak.limit {
		return false
	}
	streak.tripped = &Stopped{Reason: streak.reason()}
	return true
}

// OK files one completed result that worked, and ends the streak.
func (streak *Streak) OK() {
	streak.mu.Lock()
	defer streak.mu.Unlock()
	streak.run = 0
	clear(streak.causes)
}

// Stopped is why the streak tripped, or nil while it has not.
func (streak *Streak) Stopped() *Stopped {
	streak.mu.Lock()
	defer streak.mu.Unlock()
	return streak.tripped
}

func (streak *Streak) reason() string {
	causes := make([]string, 0, len(streak.causes))
	for cause := range streak.causes {
		causes = append(causes, cause)
	}
	sort.Slice(causes, func(a, b int) bool {
		if streak.causes[causes[a]] != streak.causes[causes[b]] {
			return streak.causes[causes[a]] > streak.causes[causes[b]]
		}
		return causes[a] < causes[b]
	})
	return fmt.Sprintf("stopping: %d consecutive errors, most common cause: %s (x%d)", streak.run, causes[0], streak.causes[causes[0]])
}
