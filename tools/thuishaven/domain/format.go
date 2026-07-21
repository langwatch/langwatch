package domain

import (
	"fmt"
	"time"
)

// HumanBytes formats a byte count as a compact, human-readable size (e.g. 1.5GB).
// It is the one shared formatter the app layer and the prune picker both use, so
// "23.4MB" reads the same everywhere haven reports a footprint.
func HumanBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%dB", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f%cB", float64(b)/float64(div), "KMGTPE"[exp])
}

// HumanAge formats a duration as the coarsest single unit that fits (7d, 13h,
// 45m, 30s) — the "how long has this worktree sat idle" reading interactive
// prune shows. A negative or zero duration reads as "0s".
func HumanAge(d time.Duration) string {
	switch {
	case d >= 24*time.Hour:
		return fmt.Sprintf("%dd", d/(24*time.Hour))
	case d >= time.Hour:
		return fmt.Sprintf("%dh", d/time.Hour)
	case d >= time.Minute:
		return fmt.Sprintf("%dm", d/time.Minute)
	case d >= time.Second:
		return fmt.Sprintf("%ds", d/time.Second)
	default:
		return "0s"
	}
}
