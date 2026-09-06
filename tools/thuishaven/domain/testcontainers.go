package domain

import (
	"strings"
	"time"
)

// TestContainersLabel is the label every testcontainers library stamps on the
// containers it creates. It is the whole selection rule: haven's managed
// containers never carry it, so the sweep only ever selects containers
// carrying a test library's own mark.
const TestContainersLabel = "org.testcontainers=true"

// RyukLabel marks the test library's own reaper container. Ryuk carries the
// testcontainers label too, but force-removing a live Ryuk severs the running
// test client's cleanup socket — the sweep would cause the very leak it exists
// to clean up — so Ryuk is never a candidate. It retires itself seconds after
// its client disconnects.
const RyukLabel = "org.testcontainers.ryuk=true"

// DefaultTestContainerTTL is how old a stopped testcontainer may be before the
// daemon reaps it as leaked. Ten minutes (plus the sweep's own up-to-ten-minute
// cadence) clears an interrupted run's debris the same session it happened.
const DefaultTestContainerTTL = 10 * time.Minute

// DefaultRunningTestContainerTTL is the grace period for containers still
// RUNNING. A running container's age says nothing about current use — reused
// containers (`withReuse`) keep their original CreatedAt across runs, so a
// birthday-based ten-minute rule would delete a server out from under a live
// suite. Two hours outlives any real integration run while still catching the
// day-old leaked ClickHouse burning cores in the shared VM.
const DefaultRunningTestContainerTTL = 2 * time.Hour

// TestContainer is one candidate from the container runtime's listing.
type TestContainer struct {
	ID        string
	Name      string
	State     string // docker's container state, e.g. "running" or "exited"
	CreatedAt time.Time
	IsRyuk    bool
}

// dockerPSTimeLayout matches `docker ps --format {{.CreatedAt}}`, e.g.
// "2026-08-11 14:23:45 +0200 CEST" (the client renders the unix timestamp in
// its local zone, numeric offset included).
const dockerPSTimeLayout = "2006-01-02 15:04:05 -0700 MST"

// ParseTestContainerListing parses `docker ps` output shaped as one
// tab-separated "ID\tState\tCreatedAt\tNames\tLabels" line per container
// (labels come last — they contain commas but never tabs). A line that does
// not parse is dropped and counted: the sweep removes containers, so an entry
// it cannot date is treated as not-leaked rather than guessed at, and the
// count lets the caller tell "nothing listed" from "the CLI's date format
// changed and the sweep has gone blind".
func ParseTestContainerListing(out string) (containers []TestContainer, unparseable int) {
	for line := range strings.SplitSeq(out, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 5)
		if len(parts) != 5 || parts[0] == "" {
			unparseable++
			continue
		}
		createdAt, err := time.Parse(dockerPSTimeLayout, parts[2])
		if err != nil {
			unparseable++
			continue
		}
		containers = append(containers, TestContainer{
			ID:        parts[0],
			State:     parts[1],
			CreatedAt: createdAt,
			Name:      parts[3],
			IsRyuk:    strings.Contains(parts[4], RyukLabel),
		})
	}
	return containers, unparseable
}

// LeakedTestContainers filters a labeled listing down to the containers old
// enough to reap. Only containers in a terminal state are judged against
// stoppedCutoff; every other state gets the (later-born, i.e. more lenient)
// runningCutoff, because a container that is running — or paused, restarting,
// or otherwise mid-transition — may still belong to a live test run whatever
// its age. Ryuk is never a candidate.
func LeakedTestContainers(containers []TestContainer, stoppedCutoff, runningCutoff time.Time) []TestContainer {
	var leaked []TestContainer
	for _, c := range containers {
		if c.IsRyuk {
			continue
		}
		cutoff := runningCutoff
		if isTerminalContainerState(c.State) {
			cutoff = stoppedCutoff
		}
		if c.CreatedAt.Before(cutoff) {
			leaked = append(leaked, c)
		}
	}
	return leaked
}

// isTerminalContainerState reports whether a docker state means the
// container's process is gone for good. Everything else — running, paused,
// restarting, created, removing — may still belong to a live run
// mid-transition and must not be judged by the short stopped cutoff.
func isTerminalContainerState(state string) bool {
	return state == "exited" || state == "dead"
}
