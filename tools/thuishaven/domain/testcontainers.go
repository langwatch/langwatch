package domain

import (
	"strings"
	"time"
)

// TestContainersLabel is the label every testcontainers library stamps on the
// containers it creates (the Ryuk reaper's own container carries it too). It is
// the whole selection rule: haven's managed containers never carry it, so a
// sweep filtered on this label can never touch anything haven — or a human —
// started by hand.
const TestContainersLabel = "org.testcontainers=true"

// DefaultTestContainerTTL is how old a testcontainer must be before the daemon
// treats it as leaked. Integration-test runs finish in minutes; an hour means
// no live run can still be using the container, while a run interrupted today
// is still cleaned up today rather than found days later.
const DefaultTestContainerTTL = time.Hour

// TestContainer is one candidate from the container runtime's listing.
type TestContainer struct {
	ID        string
	Name      string
	CreatedAt time.Time
}

// dockerPSTimeLayout matches `docker ps --format {{.CreatedAt}}`, e.g.
// "2026-08-11 14:23:45 +0200 CEST".
const dockerPSTimeLayout = "2006-01-02 15:04:05 -0700 MST"

// ParseTestContainerListing parses `docker ps` output shaped as one
// tab-separated "ID\tCreatedAt\tName" line per container. A line that does not
// parse is dropped: the sweep removes containers, so an entry it cannot date is
// treated as not-leaked rather than guessed at.
func ParseTestContainerListing(out string) []TestContainer {
	var containers []TestContainer
	for line := range strings.SplitSeq(out, "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "\t", 3)
		if len(parts) != 3 || parts[0] == "" {
			continue
		}
		createdAt, err := time.Parse(dockerPSTimeLayout, parts[1])
		if err != nil {
			continue
		}
		containers = append(containers, TestContainer{ID: parts[0], Name: parts[2], CreatedAt: createdAt})
	}
	return containers
}

// LeakedTestContainers filters a labeled listing down to the containers old
// enough that no live test run can still be using them.
func LeakedTestContainers(containers []TestContainer, cutoff time.Time) []TestContainer {
	var leaked []TestContainer
	for _, c := range containers {
		if c.CreatedAt.Before(cutoff) {
			leaked = append(leaked, c)
		}
	}
	return leaked
}
