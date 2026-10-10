package dashboard

import (
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Extras is everything the hub shows beyond the registry: the machine's
// partitioned memory picture, the stackless worktrees, and the daemon's recent
// reaping. It arrives through a callback so the adapter stays ignorant of the
// app core; a zero Extras degrades to the registry alone.
type Extras struct {
	Summary   SummaryView
	Worktrees []WorktreeView
	Events    []EventView
	// StackRSS is each live stack's whole-tree resident set by launcher pid —
	// the accurate per-card number (group RSS sees only the launcher itself).
	StackRSS map[int]uint64
	// StackUptime is each live stack's launcher age by launcher pid.
	StackUptime map[int]time.Duration
}

// SummaryView is the machine header: every process attributed once.
type SummaryView struct {
	TotalRAM   uint64
	StacksRSS  uint64
	ServerRSS  map[string]uint64
	AgentRSS   uint64
	AgentCount int
	ToolingRSS uint64
	OtherRSS   uint64
	Pressure   string
}

// DevRSS is everything attributed to dev work, summed.
func (s SummaryView) DevRSS() uint64 {
	total := s.StacksRSS + s.AgentRSS + s.ToolingRSS
	for _, rss := range s.ServerRSS {
		total += rss
	}
	return total
}

// WorktreeView is a worktree with no registered stack.
type WorktreeView struct {
	Slug, Branch, Dir    string
	IsPrimary, IsCurrent bool
}

// EventView is one daemon reclamation, newest first.
type EventView struct {
	At                   time.Time
	Kind, Target, Reason string
}

// appURL is a stack's browser app, the hub card's "Open"; empty hides it.
func appURL(s domain.Stack) string {
	for _, svc := range s.Services {
		if svc.Name == "app" && svc.URL != "" {
			return svc.URL
		}
	}
	return ""
}
