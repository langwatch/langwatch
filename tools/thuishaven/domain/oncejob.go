package domain

import "time"

// The one-shot lanes: the work an `up` does before any service boots, and the
// work it does once alongside them. They are not services - nothing supervises
// them, they run and they are over - so nothing in the stack record remembers
// they happened. That is exactly what makes an up that "took a while" so hard
// to account for afterwards, which is why each run is journalled.

// OnceJobLanes are the one-shot lanes an up runs, in the order it runs them.
// A lane not on this list is a supervised service and belongs to a log tab.
var OnceJobLanes = []string{"deps", "codegen", "prepare", "seed", "langy-image", "obs"}

// IsOnceJobLane reports whether a lane name is a one-shot job rather than a
// supervised service.
func IsOnceJobLane(name string) bool {
	for _, lane := range OnceJobLanes {
		if lane == name {
			return true
		}
	}
	return false
}

// OnceJobRun is one one-shot lane's run, as the journal records it. Durations
// travel as milliseconds because the journal is read by more than Go.
type OnceJobRun struct {
	Name string    `json:"name"`
	At   time.Time `json:"at"`
	// DurationMS is how long the run took, wall clock.
	DurationMS int64 `json:"durationMs"`
	// Exit is the process exit status; 0 is success.
	Exit int `json:"exit"`
}

// Duration is the run's wall clock as a duration.
func (r OnceJobRun) Duration() time.Duration {
	return time.Duration(r.DurationMS) * time.Millisecond
}

// OnceJobJournal is the file, inside a stack's log directory, that the one-shot
// runs are appended to. It sits beside the captures rather than in the registry
// because it is history of one up, not state of the stack.
const OnceJobJournal = "jobs.jsonl"
