package prunetui

import (
	"fmt"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// newestFirstPreview is how many of the ticked rows the confirmation names.
// Enough that a mis-ticked piece of recent work is on the screen being read, few
// enough that the summary stays one screen whatever the batch size.
const newestFirstPreview = 5

// renderConfirmScreen is the last screen before anything is deleted: one kind,
// counted and sized, with the newest ticked rows named — the ones a mistake
// costs most — and the typed confirmation. It replaces the browse list entirely,
// so the numbers being agreed to are not competing with a hundred rows.
func (m model) renderConfirmScreen() string {
	var b strings.Builder
	b.WriteString(styleTitle.Render(m.title()))
	b.WriteString("\n\n")

	n := m.countSelected()
	b.WriteString(styleWarn.Render(fmt.Sprintf("  Reclaim %s · %s",
		m.actions.Kind.Count(n), domain.HumanBytes(m.selectedBytes()))))
	b.WriteString("\n")
	if m.actions.ConfirmNote != "" {
		b.WriteString(styleDim.Render("  " + m.actions.ConfirmNote))
		b.WriteString("\n")
	}
	b.WriteString("\n")

	newest := m.newestSelected(newestFirstPreview)
	if len(newest) > 0 {
		b.WriteString(styleDim.Render("  newest of what is ticked:"))
		b.WriteString("\n")
		for _, r := range newest {
			b.WriteString("    " + fmt.Sprintf("%-24s", truncate(displayName(r), 24)))
			b.WriteString(styleDim.Render(confirmRowFacts(r)))
			b.WriteString("\n")
		}
		if rest := n - len(newest); rest > 0 {
			b.WriteString(styleDim.Render(fmt.Sprintf("    … and %s older", m.actions.Kind.Count(rest))))
			b.WriteString("\n")
		}
	}

	b.WriteString("\n")
	b.WriteString(styleWarn.Render(fmt.Sprintf("  type %q to confirm (esc cancels): %s▏", confirmWord, m.confirm)))
	b.WriteString("\n")
	return b.String()
}

// confirmRowFacts is one previewed row's age, size and reason — the three
// things that decide whether a tick was a mistake.
func confirmRowFacts(r Row) string {
	age := ageLabel(r) + " ?"
	if r.StaleKnown {
		age = ageLabel(r) + " " + domain.HumanAge(r.StaleFor)
	}
	size := "size …"
	if r.SizeKnown {
		size = domain.HumanBytes(r.DiskBytes)
	}
	parts := []string{fmt.Sprintf("%-10s", age), fmt.Sprintf("%8s", size)}
	if r.Reason != "" {
		parts = append(parts, r.Reason)
	}
	return strings.Join(parts, "  ")
}

// newestSelected is the ticked rows ordered youngest first, capped at limit. It
// reads the selection rather than the display order, so the preview is the same
// whichever sort the list happens to be in.
func (m model) newestSelected(limit int) []Row {
	var rows []Row
	for _, r := range m.rows {
		if r.Deletable && m.selected[r.Dir] {
			rows = append(rows, r)
		}
	}
	sort.SliceStable(rows, func(a, b int) bool {
		if rows[a].StaleKnown != rows[b].StaleKnown {
			return rows[a].StaleKnown
		}
		return rows[a].StaleFor < rows[b].StaleFor
	})
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows
}
