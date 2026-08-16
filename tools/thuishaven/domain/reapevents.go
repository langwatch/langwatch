package domain

import "time"

// ReapEvent is one thing the daemon reclaimed: a dead or stale stack, a leaked
// test container, a governed tsgo process, an orphaned test worker, an idle
// database. The record exists so the hub can answer "what has the reaper been
// doing" without grepping the daemon log.
type ReapEvent struct {
	At     time.Time `json:"at"`
	Kind   string    `json:"kind"`   // stack | testcontainer | tsgo | orphans | database | clickhouse
	Target string    `json:"target"` // slug, container name, "pid 123 (run)", database name
	Reason string    `json:"reason"`
}

// ReapEventCap bounds the persisted record: enough to see what the last few
// days of reaping did, small enough to read and rewrite on every append.
const ReapEventCap = 100

// AppendReapEvent appends newest-last and drops the oldest past the cap.
func AppendReapEvent(events []ReapEvent, ev ReapEvent) []ReapEvent {
	events = append(events, ev)
	if len(events) > ReapEventCap {
		events = events[len(events)-ReapEventCap:]
	}
	return events
}
