package prunetui

import (
	"fmt"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// renderDeleteScreen is the reset-the-screen view once a delete is underway: the
// worktree list is gone, replaced by a headline (an animated spinner while work is
// in flight, a tick when it finishes), a per-worktree status list that flips
// ✓/✗/spinner as outcomes stream in, and a one-line tally. It is windowed to the
// terminal height so a large batch never overflows.
func (m model) renderDeleteScreen() string {
	var b strings.Builder
	b.WriteString(styleTitle.Render(" ⌂ haven prune "))
	b.WriteString("\n\n")

	done := m.deletedOK + m.deletedErr
	spin := spinnerFrames[m.spin%len(spinnerFrames)]
	if m.mode == modeDone {
		head := fmt.Sprintf("  ✓  deleted %d worktree(s), reclaimed ~%s", m.deletedOK, domain.HumanBytes(m.reclaimed))
		if m.deletedErr > 0 {
			head += fmt.Sprintf(" · %d failed", m.deletedErr)
		}
		b.WriteString(styleGood.Render(head))
	} else {
		b.WriteString(styleWarn.Render(fmt.Sprintf("  %s  deleting %d worktree(s) in parallel — %d/%d done", spin, m.deletingTotal, done, m.deletingTotal)))
	}
	b.WriteString("\n\n")

	rows := m.deletingRows()
	budget := m.viewHeight() - 6 // title (2) + headline (2) + tally (2)
	if budget < 1 {
		budget = 1
	}
	shown, clipped := rows, false
	if len(rows) > budget {
		shown, clipped = rows[:budget-1], true
	}
	for _, r := range shown {
		st := m.status[r.Dir]
		b.WriteString("    " + statusGlyph(st, spin) + " " + fmt.Sprintf("%-24s", truncate(displayName(r), 24)))
		b.WriteString(styleDim.Render(statusLabel(st)))
		b.WriteString("\n")
	}
	if clipped {
		b.WriteString(styleDim.Render(fmt.Sprintf("    … and %d more", len(rows)-len(shown))))
		b.WriteString("\n")
	}

	b.WriteString("\n")
	if m.mode == modeDone {
		b.WriteString(styleDim.Render("  press any key to exit"))
	} else {
		inFlight := m.deletingTotal - done
		tally := fmt.Sprintf("  %d in flight", inFlight)
		if m.deletedOK > 0 {
			tally += fmt.Sprintf(" · %d done", m.deletedOK)
		}
		if m.deletedErr > 0 {
			tally += fmt.Sprintf(" · %d failed", m.deletedErr)
		}
		b.WriteString(styleDim.Render(tally))
	}
	b.WriteString("\n")
	return b.String()
}

// deletingRows are the worktrees in this delete batch, in display order.
func (m model) deletingRows() []Row {
	var rows []Row
	for _, ri := range m.order {
		if _, ok := m.status[m.rows[ri].Dir]; ok {
			rows = append(rows, m.rows[ri])
		}
	}
	return rows
}

func statusGlyph(status, spin string) string {
	switch {
	case status == "done":
		return styleGood.Render("✓")
	case strings.HasPrefix(status, "failed"):
		return styleWarn.Render("✗")
	default: // "deleting"
		return spin
	}
}

func statusLabel(status string) string {
	if status == "deleting" {
		return "  deleting…"
	}
	return "  " + status
}
