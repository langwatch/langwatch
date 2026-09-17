package cmd

import (
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer"
)

func (m *viewerModel) rule() string {
	width := m.width
	if width <= 0 {
		width = 80
	}
	return dimText(strings.Repeat("─", width))
}

func (m *viewerModel) clearExpansion() {
	m.expandedIDs = map[int64]bool{}
	m.frozenRows = nil
	m.anchorID, m.anchorOffset, m.expansionScroll = 0, 0, 0
}

func (m *viewerModel) globalHelp() string {
	if m.height > 0 && m.height < 16 && !m.destroyOnQuit {
		return "←→ Tabs · ? Help · q Detach · X Stop stack"
	}
	navigation := m.navFooter() + " · ? Help"
	if m.destroyOnQuit {
		return navigation + " · q Quit & destroy sandbox"
	}
	return navigation + " · q Detach (stack stays running) · X Stop stack"
}

func (m *viewerModel) helpView(chrome []string) string {
	m.rowIDs, m.serviceRows = nil, nil
	rows := []string{
		"  \x1b[1mKeyboard shortcuts\x1b[0m", "  ? / esc Close help",
		"", "  NAVIGATE   ←→ / tab Tabs · 1–9 / 0 Jump",
		"             [ / ] Services · ↑↓ / j k Select",
		"  INSPECT    enter Details · o Browser",
		"  SEARCH     / Search · n / N Next / previous",
		"  BACK       esc Back / clear; otherwise detach",
		"", "  LOGS       click Expand · ↑↓ Scroll details",
		"             f Resume live · a / w / e Severity",
		"             space / b Page · d / u Half page",
		"             g / G Top / bottom · L Source",
		"", "  SESSION    r Restart selected · a Restart all",
		"  LIFECYCLE  q Detach · X then X Stop stack",
	}
	if m.destroyOnQuit {
		rows[7] = "  BACK       esc Back (never destroys the sandbox)"
		rows[15] = "  LIFECYCLE  q Quit and destroy sandbox"
	}

	for _, row := range rows {
		chrome = append(chrome, cutRow(row, m.width))
	}
	return strings.Join(m.clampToTerminal(chrome), "\n")
}

func (m *viewerModel) sessionRows(budget int) []string {
	m.serviceRows = map[int]int{}
	if !m.snap.Found {
		return []string{"  Connecting to this stack… Services appear as they register."}
	}
	rows := []string{}
	if budget >= 4 {
		rows = append(rows, "  \x1b[1mServices\x1b[0m  "+dimText(m.snap.Branch), "  "+dimText("Select a deployable to inspect logs or simulator."))
	}
	count := min(len(m.snap.Services), max(1, budget-len(rows)))
	if budget >= 10 {
		count = min(count, budget-len(rows)-3)
	}
	start := max(0, m.cursor-count+1)
	for i := start; i < min(start+count, len(m.snap.Services)); i++ {
		m.serviceRows[m.bodyStart+len(rows)] = i
		rows = append(rows, cutRow(m.serviceRow(i, m.snap.Services[i]), m.width))
	}
	if budget-len(rows) >= 2 {
		rows = append(rows, "", "  "+dimText("Shared infrastructure")+"  "+m.serversLine())
	}

	return rows
}

// SelectedLine keeps the highlight through nested ANSI resets and fills the row.
func selectedLine(text string, width int) string { return viewer.SelectedLine(text, width) }
