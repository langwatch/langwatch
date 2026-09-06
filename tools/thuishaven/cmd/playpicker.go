package cmd

import (
	"context"
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// pickOpenPR is `haven play` with no argument in a terminal: list the repo's
// open PRs (via gh) and let the user pick one. Returns picked=false when the
// user quit without choosing. Style-wise it is the hub's smaller sibling:
// plain bubbletea, arrow/j/k to move, enter to choose, q/esc to leave.
func pickOpenPR(ctx context.Context, repoRoot string) (number int, picked bool, err error) {
	prs, err := app.ListOpenPlayPRs(ctx, repoRoot)
	if err != nil {
		return 0, false, err
	}
	if len(prs) == 0 {
		fmt.Println("no open PRs to play")
		return 0, false, nil
	}
	m := playPickerModel{prs: prs}
	p := tea.NewProgram(m, tea.WithAltScreen(), tea.WithContext(ctx))
	out, err := p.Run()
	if err != nil {
		if ctx.Err() != nil { // Ctrl-C via the signal context is a clean quit
			return 0, false, nil
		}
		return 0, false, err
	}
	final := out.(playPickerModel)
	if final.chosen == 0 {
		return 0, false, nil
	}
	return final.chosen, true, nil
}

type playPickerModel struct {
	prs    []app.PlayPR
	cursor int
	chosen int
	height int
}

func (m playPickerModel) Init() tea.Cmd { return nil }

func (m playPickerModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.height = msg.Height
		return m, nil
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "esc", "ctrl+c":
			return m, tea.Quit
		case "down", "j":
			if m.cursor < len(m.prs)-1 {
				m.cursor++
			}
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "enter":
			m.chosen = m.prs[m.cursor].Number
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m playPickerModel) View() string {
	var b strings.Builder
	b.WriteString("\x1b[1m haven play\x1b[0m \x1b[2m· pick a PR to run in a throwaway sandbox · enter runs · q quits\x1b[0m\n\n")
	rows := m.height - 4
	if rows < 1 {
		rows = 20
	}
	start := 0
	if m.cursor >= rows {
		start = m.cursor - rows + 1
	}
	end := min(start+rows, len(m.prs))
	for i := start; i < end; i++ {
		pr := m.prs[i]
		line := fmt.Sprintf(" #%-6d %-52s %s", pr.Number, truncateCell(pr.Title, 52), pr.HeadRefName)
		if i == m.cursor {
			b.WriteString("\x1b[7m" + line + "\x1b[0m\n")
			continue
		}
		b.WriteString(line + "\n")
	}
	return b.String()
}
