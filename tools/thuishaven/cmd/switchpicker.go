package cmd

import (
	"context"
	"fmt"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// The `haven switch` picker: bare `haven switch` in a terminal lists every
// worktree, live stacks first, and prints the chosen directory.
//
// The split of streams is the whole trick. A child process cannot cd its parent
// shell, so the answer has to travel out through stdout for `cd "$(haven
// switch)"` to work — which means stdout is a pipe in every real use, and the
// UI has to be drawn somewhere else. It draws on stderr, reads stdin, and
// stdout carries exactly one line: the directory. Style-wise it is the play
// picker's sibling: plain bubbletea, arrow/j/k to move, enter to choose, q to
// leave.

// pickSwitchTarget runs the picker and prints the chosen directory. Quitting
// without choosing prints nothing and is not an error — the shell function
// treats an empty answer as "stay where you are".
func pickSwitchTarget(ctx context.Context, targets []app.SwitchTarget) error {
	p := tea.NewProgram(
		switchPickerModel{targets: targets},
		tea.WithAltScreen(),
		tea.WithContext(ctx),
		tea.WithOutput(os.Stderr),
		tea.WithInput(os.Stdin),
	)
	out, err := p.Run()
	// Ctrl-C via the signal context is a clean quit — you chose not to move.
	if ctx.Err() != nil {
		return nil //nolint:nilerr // an interrupted picker chose nothing; that is not a failure
	}
	if err != nil {
		return err
	}
	final, ok := out.(switchPickerModel)
	if !ok || final.chosen == "" {
		return nil
	}
	fmt.Println(final.chosen)
	// Nothing captured the answer, so the developer is looking at a bare path
	// where they expected to have moved. Say what installs the cd, once.
	if isCharDevice(os.Stdout) {
		fmt.Fprintln(os.Stderr, "\nTo make this an actual cd, add to ~/.zshrc:")
		fmt.Fprintln(os.Stderr, `  eval "$(haven shell-init)"`)
	}
	return nil
}

type switchPickerModel struct {
	targets []app.SwitchTarget
	cursor  int
	chosen  string
	height  int
}

func (m switchPickerModel) Init() tea.Cmd { return nil }

func (m switchPickerModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.height = msg.Height
		return m, nil
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "esc", "ctrl+c":
			return m, tea.Quit
		case "down", "j":
			if m.cursor < len(m.targets)-1 {
				m.cursor++
			}
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "enter":
			m.chosen = m.targets[m.cursor].Dir
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m switchPickerModel) View() string {
	var b strings.Builder
	b.WriteString("\x1b[1m haven switch\x1b[0m \x1b[2m· ● = stack up · enter cd's there · q quits\x1b[0m\n\n")
	rows := m.height - 4
	if rows < 1 {
		rows = 20
	}
	start := 0
	if m.cursor >= rows {
		start = m.cursor - rows + 1
	}
	end := min(start+rows, len(m.targets))
	for i := start; i < end; i++ {
		t := m.targets[i]
		dot := "\x1b[2m○\x1b[0m"
		if t.IsUp {
			dot = "\x1b[32m●\x1b[0m"
		}
		line := fmt.Sprintf(" %s %-28s \x1b[2m%s\x1b[0m", dot, truncateCell(t.Name, 28), t.Dir)
		if i == m.cursor {
			b.WriteString("\x1b[7m" + line + "\x1b[0m\n")
			continue
		}
		b.WriteString(line + "\n")
	}
	return b.String()
}
