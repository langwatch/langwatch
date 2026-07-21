package prunetui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

var (
	accent     = lipgloss.AdaptiveColor{Light: "#ed8926", Dark: "#f59e3f"}
	styleTitle = lipgloss.NewStyle().Bold(true).Foreground(accent)
	styleDim   = lipgloss.NewStyle().Faint(true)
	styleSel   = lipgloss.NewStyle().Foreground(accent).Bold(true)
	styleLive  = lipgloss.NewStyle().Foreground(lipgloss.Color("42"))
	styleWarn  = lipgloss.NewStyle().Foreground(lipgloss.Color("203")).Bold(true)
	styleGood  = lipgloss.NewStyle().Foreground(lipgloss.Color("42"))
	styleGone  = lipgloss.NewStyle().Foreground(lipgloss.Color("213"))
)

var spinnerFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

// View assembles three measured parts — a fixed header, a scrolling list window,
// and a footer — so header + list + footer never exceeds the terminal height and
// the header can't scroll off the top. Every line is finally clamped to the
// terminal width so a long row can't soft-wrap and break the vertical budget.
func (m model) View() string {
	header := m.renderHeader()
	footer := m.renderFooter()
	budget := m.viewHeight() - countLines(header) - countLines(footer) - 1
	if budget < 1 {
		budget = 1
	}
	return clampLines(header+m.renderList(budget)+footer, m.width)
}

func (m model) viewHeight() int {
	if m.height > 0 {
		return m.height
	}
	return 24
}

// scrollCap is the conservative row budget ensureVisible scrolls against — a
// little smaller than View's exact budget so the cursor is never pushed to the
// very edge as the footer grows or shrinks between modes.
func (m model) scrollCap() int {
	c := m.viewHeight() - 11
	if c < 1 {
		return 1
	}
	return c
}

func (m model) renderHeader() string {
	sel := m.countSelected()
	n := len(m.rows)
	parts := []string{fmt.Sprintf("%d worktree(s)", n)}
	if m.metaCount < n {
		parts = append(parts, fmt.Sprintf("reading %d/%d", m.metaCount, n))
	}
	// Sizes are measured only for deletable worktrees (protected ones are never
	// reclaimed), so the sizing progress counts against that target, not n.
	if target := m.sizeTarget(); m.sizeCount < target {
		parts = append(parts, fmt.Sprintf("sizing %d/%d %s", m.sizeCount, target, spinnerFrames[m.spin%len(spinnerFrames)]))
	}
	parts = append(parts, "sort: "+sortNames[m.sort])
	if sel > 0 {
		parts = append(parts, fmt.Sprintf("%d selected · reclaim ~%s", sel, domain.HumanBytes(m.selectedBytes())))
	}

	var b strings.Builder
	b.WriteString(styleTitle.Render(" ⌂ haven prune "))
	b.WriteString(styleDim.Render("  " + strings.Join(parts, " · ")))
	b.WriteString("\n")
	b.WriteString(styleDim.Render(" " + strings.Repeat("─", m.divider())))
	b.WriteString("\n\n")
	return b.String()
}

func (m model) divider() int {
	w := m.width - 2
	if w < 20 {
		return 20
	}
	if w > 88 {
		return 88
	}
	return w
}

// renderList windows the rows into at most budget lines, keeping the cursor
// visible, and adds a one-line "… a–b of n" indicator when the list is clipped.
func (m model) renderList(budget int) string {
	n := len(m.order)
	if n == 0 {
		return styleDim.Render("  no worktrees found") + "\n"
	}
	clipped := n > budget
	rowBudget := budget
	if clipped {
		rowBudget = budget - 1
		if rowBudget < 1 {
			rowBudget = 1
		}
	}
	top := m.top
	if top > n-rowBudget {
		top = n - rowBudget
	}
	if top < 0 {
		top = 0
	}
	// keep the cursor inside the window even if a resize left top stale
	if m.cursor < top {
		top = m.cursor
	}
	if m.cursor >= top+rowBudget {
		top = m.cursor - rowBudget + 1
	}
	end := top + rowBudget
	if end > n {
		end = n
	}

	var b strings.Builder
	for pos := top; pos < end; pos++ {
		b.WriteString(m.renderRow(pos, m.rows[m.order[pos]]))
	}
	if clipped {
		b.WriteString(styleDim.Render(fmt.Sprintf("  … %d–%d of %d (↑↓ scroll)", top+1, end, n)))
		b.WriteString("\n")
	}
	return b.String()
}

func (m model) renderRow(pos int, r Row) string {
	isCursor := pos == m.cursor
	marker := "  "
	nameStyle := lipgloss.NewStyle()
	if isCursor {
		marker, nameStyle = "▸ ", styleSel
	}

	box := "[ ]"
	switch {
	case !r.Deletable:
		box = styleDim.Render(" · ")
	case m.selected[r.Dir]:
		box = styleGood.Render("[x]")
	}

	name := displayName(r)
	if r.IsLive {
		name += " " + styleLive.Render("●")
	}
	line := fmt.Sprintf("%s%s %s  %s", marker, box, nameStyle.Render(fmt.Sprintf("%-24s", truncate(name, 24))), styleDim.Render(m.facts(r)))
	// Non-highlighted rows carry a dim preview of where the worktree lives; the
	// highlighted row shows its full path in the footer detail instead.
	if !isCursor {
		line += "   " + styleDim.Render("┄ "+pathPreview(r.Dir)+" ┄")
	}
	return line + "\n"
}

// facts is the right-hand column: a protected tag, or a loading spinner until the
// meta lands, then idle age + size (a dim placeholder until the slower size pass
// reaches it) + database chips + live / uncommitted / origin-gone flags.
func (m model) facts(r Row) string {
	if !r.Deletable {
		switch {
		case r.IsPrimary:
			return "primary · protected"
		case r.IsCurrent:
			return "current · protected"
		default:
			return "protected"
		}
	}
	if !r.MetaKnown {
		return spinnerFrames[m.spin%len(spinnerFrames)] + " scanning…"
	}
	idle := "idle ?"
	if r.StaleKnown {
		idle = "idle " + domain.HumanAge(r.StaleFor)
	}
	size := styleDim.Render("   …")
	if r.SizeKnown {
		size = fmt.Sprintf("%8s", domain.HumanBytes(r.DiskBytes))
	}
	parts := []string{fmt.Sprintf("%-9s", idle), size}
	if chips := dbChips(r); chips != "" {
		parts = append(parts, chips)
	}
	if r.IsLive {
		parts = append(parts, "live")
	}
	if r.IsDirty {
		parts = append(parts, styleWarn.Render("uncommitted"))
	}
	if r.OriginGone {
		parts = append(parts, styleGone.Render("origin-gone"))
	}
	return strings.Join(parts, "  ")
}

func (m model) renderFooter() string {
	var b strings.Builder
	switch m.mode {
	case modeConfirm:
		n := m.countSelected()
		b.WriteString("\n")
		b.WriteString(styleWarn.Render(fmt.Sprintf("  Delete %d worktree(s) — stops their stacks, drops their databases, removes their", n)))
		b.WriteString("\n")
		b.WriteString(styleWarn.Render(fmt.Sprintf("  directories (uncommitted changes included). Reclaims ~%s.", domain.HumanBytes(m.selectedBytes()))))
		b.WriteString("\n")
		b.WriteString(styleWarn.Render(fmt.Sprintf("  type %q to confirm: %s▏", confirmWord, m.confirm)))
		b.WriteString("\n")
	case modeDeleting:
		done := m.deletedOK + m.deletedErr
		inFlight := m.deletingTotal - done
		spin := spinnerFrames[m.spin%len(spinnerFrames)]
		b.WriteString("\n")
		b.WriteString(styleWarn.Render(fmt.Sprintf("  %s deleting in parallel — %d/%d done", spin, done, m.deletingTotal)))
		b.WriteString("\n")
		tally := fmt.Sprintf("  %d in flight", inFlight)
		if m.deletedOK > 0 {
			tally += fmt.Sprintf(" · %d done", m.deletedOK)
		}
		if m.deletedErr > 0 {
			tally += fmt.Sprintf(" · %d failed", m.deletedErr)
		}
		b.WriteString(styleDim.Render(tally))
		b.WriteString("\n")
	case modeDone:
		msg := fmt.Sprintf("  deleted %d worktree(s), reclaimed ~%s", m.deletedOK, domain.HumanBytes(m.reclaimed))
		if m.deletedErr > 0 {
			msg += fmt.Sprintf(", %d failed", m.deletedErr)
		}
		b.WriteString("\n")
		b.WriteString(styleGood.Render(msg))
		b.WriteString("\n")
		b.WriteString(styleDim.Render("  press any key to exit"))
		b.WriteString("\n")
	default:
		b.WriteString("\n")
		b.WriteString(m.renderDetail())
		if m.anyDeletable() {
			b.WriteString(styleDim.Render("  ↑↓ move · space toggle · a all · n none · s sort · enter delete · q quit"))
		} else {
			b.WriteString(styleDim.Render("  no other worktrees to prune · q quit"))
		}
		b.WriteString("\n")
		if m.actions.SharedNote != "" {
			b.WriteString(styleDim.Render("  " + m.actions.SharedNote))
			b.WriteString("\n")
		}
	}
	return b.String()
}

// renderDetail is the two-line panel for the highlighted worktree: where it
// lives, and exactly what deleting it reclaims. Fixed height so the footer (and
// therefore the list budget) stays stable as the cursor moves.
func (m model) renderDetail() string {
	r, ok := m.selectedRow()
	if !ok {
		return "\n\n"
	}
	var b strings.Builder
	b.WriteString(styleDim.Render("  " + r.Dir))
	b.WriteString("\n")
	switch {
	case !r.Deletable:
		b.WriteString(styleDim.Render("  protected — never deleted by prune"))
	case r.MetaKnown:
		b.WriteString(styleDim.Render("  reclaims: " + reclaimDetail(r)))
	default:
		b.WriteString(styleDim.Render("  scanning…"))
	}
	b.WriteString("\n")
	return b.String()
}
