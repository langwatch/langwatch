// Proxy-port picker: where the portless proxy should listen.
//
// It follows the same rule as the prerequisite picker beside it — it CHOOSES
// and nothing more. Binding 443 asks for a password, and sudo cannot prompt
// from inside an alt-screen program, so the elevation runs after this closes
// with the terminal to itself. Run returns the decision; the caller acts.
package installtui

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/havenui"
)

// The range a process without privileges can bind.
const (
	lowestUserPort  = 1024
	highestUserPort = 65535
)

// ProxyPortChoice is what the developer decided.
type ProxyPortChoice struct {
	// Privileged asks for 443, which needs a password.
	Privileged bool
	// Port is the unprivileged port they typed, when they typed one.
	Port int
	// Confirmed is false when the picker was quit. Quitting means nothing:
	// the proxy is left exactly where it was.
	Confirmed bool
}

// AskProxyPort shows the picker and returns the decision.
func AskProxyPort(ctx context.Context, current int) (ProxyPortChoice, error) {
	out, err := tea.NewProgram(newProxyModel(current), tea.WithAltScreen(), tea.WithContext(ctx)).Run()
	if err != nil {
		return ProxyPortChoice{}, err
	}
	m, ok := out.(proxyModel)
	if !ok {
		return ProxyPortChoice{}, nil
	}
	return m.decided, nil
}

type proxyModel struct {
	current int
	cursor  int
	typing  bool
	digits  string
	note    string
	decided ProxyPortChoice
}

func newProxyModel(current int) proxyModel { return proxyModel{current: current} }

func (m proxyModel) Init() tea.Cmd { return nil }

func (m proxyModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	key, ok := msg.(tea.KeyMsg)
	if !ok {
		return m, nil
	}
	m.note = ""
	if key.String() == "q" && m.typing {
		return m, nil // a stray letter is not a quit while a number is being typed
	}
	switch key.String() {
	case "q", "esc", "ctrl+c":
		return m, tea.Quit
	case "up", "k":
		m.cursor, m.typing = 0, false
		return m, nil
	case "down", "j":
		m.cursor = 1
		return m, nil
	case "1":
		return m.pick(0)
	case "2":
		return m.pick(1)
	case "enter":
		return m.confirm()
	case "backspace":
		if m.typing && m.digits != "" {
			m.digits = m.digits[:len(m.digits)-1]
		}
		return m, nil
	}
	if m.typing && len(key.String()) == 1 && key.String() >= "0" && key.String() <= "9" {
		m.digits += key.String()
	}
	return m, nil
}

// pick moves to a row. On the typed-port row a digit is the answer, so "2"
// selects the row rather than starting the number with a 2.
func (m proxyModel) pick(row int) (tea.Model, tea.Cmd) {
	if m.typing {
		m.digits += strconv.Itoa(row + 1)
		return m, nil
	}
	m.cursor = row
	m.typing = row == 1
	return m, nil
}

func (m proxyModel) confirm() (tea.Model, tea.Cmd) {
	if m.cursor == 0 {
		m.decided = ProxyPortChoice{Privileged: true, Confirmed: true}
		return m, tea.Quit
	}
	port, err := strconv.Atoi(strings.TrimSpace(m.digits))
	if err != nil || port < lowestUserPort || port > highestUserPort {
		m.note = fmt.Sprintf("%d-%d", lowestUserPort, highestUserPort)
		return m, nil
	}
	m.decided = ProxyPortChoice{Port: port, Confirmed: true}
	return m, tea.Quit
}

func (m proxyModel) View() string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s\n", havenui.Title.Render("haven install"))
	fmt.Fprintf(&b, "%s\n\n", havenui.Muted.Render("  portless proxy port"))
	fmt.Fprintf(&b, "  bound to :%d — every URL carries it\n\n", m.current)
	b.WriteString(m.row(proxyRow{0, "1", "443", "privileged bind; sudo prompts after this closes"}))
	b.WriteString(m.row(proxyRow{1, "2", m.typedPort(), "unprivileged bind, 1024-65535"}))
	if m.note != "" {
		fmt.Fprintf(&b, "\n  %s\n", havenui.Warn.Render("✗ "+m.note))
	}
	fmt.Fprintf(&b, "\n  %s\n", havenui.Muted.Render(havenui.Keys("↑↓ move", "enter select", "esc keeps :"+strconv.Itoa(m.current))))
	return b.String()
}

// typedPort is the second row's subject: the number as it is being typed, so
// the row itself is the input rather than a prompt appearing somewhere else.
func (m proxyModel) typedPort() string {
	if !m.typing {
		return "a port"
	}
	if m.digits == "" {
		return "_"
	}
	return m.digits + "_"
}

// proxyRow is one line of the picker: which row it is, and what it says.
type proxyRow struct {
	index   int
	key     string
	subject string
	detail  string
}

func (m proxyModel) row(r proxyRow) string {
	marker := "  "
	style := havenui.Muted
	if m.cursor == r.index {
		marker = havenui.Selected.Render("▸ ")
		style = havenui.Selected
	}
	return fmt.Sprintf("  %s%s  %s  %s\n",
		marker,
		style.Render(r.key),
		havenui.Pad(r.subject, 18),
		havenui.Muted.Render(r.detail))
}
