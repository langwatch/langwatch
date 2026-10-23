package backup

import "time"

const (
	// MaxTries is how many runs one scheduled slot gets, like a CronJob
	// with backoffLimit 1.
	MaxTries = 2
	// RetryAfter is the wait before a failed slot's second run.
	RetryAfter = 10 * time.Minute
)

// Slot is this process's record of runs for one mode's latest firing.
type Slot struct {
	Fire       time.Time // the firing the runs belong to
	Tries      int
	LastStart  time.Time
	LastFailed bool
}

// Due reports whether a run of the schedule is owed at now. A firing is
// owed until a backup of the mode completes after it, whoever wrote it, so
// a restart across a firing catches up instead of skipping it, and a
// backup another runner or a CronJob finished counts.
func Due(s *Schedule, now, lastSuccess time.Time, slot Slot) (time.Time, bool) {
	fire, ok := s.Prev(now)
	if !ok || !lastSuccess.Before(fire) {
		return fire, false
	}
	if !slot.Fire.Equal(fire) || slot.Tries == 0 {
		return fire, true
	}
	return fire, slot.LastFailed && slot.Tries < MaxTries && !now.Before(slot.LastStart.Add(RetryAfter))
}

// Record notes a run for the firing fire and returns the updated slot.
func (s Slot) Record(fire, start time.Time, failed bool) Slot {
	if !s.Fire.Equal(fire) {
		s = Slot{Fire: fire}
	}
	s.Tries++
	s.LastStart, s.LastFailed = start, failed
	return s
}
