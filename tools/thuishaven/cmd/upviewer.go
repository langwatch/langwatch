package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// The attached up viewer: what a human's `haven up` shows. The stack itself
// runs detached (startDetachedUp), so this is only a window onto its logs —
// ←/→ (or tab) switches between "all" (the launcher's combined stream:
// provisioning + every service interleaved) and each service's own capture,
// coloured and level-highlighted like `haven logs`. q detaches; the stack
// keeps running. Nothing here can stop the stack — that is `haven down`.

// viewerRingCap bounds how many lines each group holds in memory.
const viewerRingCap = 2000

// viewerAllGroup is the combined launcher stream's tab label.
const viewerAllGroup = "all"

// runUpViewer opens the viewer on a stack's log files until quit or ctx cancel.
func runUpViewer(ctx context.Context, slug string) error {
	m := newViewerModel(slug, stackLogPath(slug), filepath.Join(havenHome(), "logs", slug))
	p := tea.NewProgram(m, tea.WithAltScreen(), tea.WithContext(ctx))
	_, err := p.Run()
	if err != nil && ctx.Err() != nil { // Ctrl-C via the signal context is a clean detach
		return nil
	}
	return err
}

type viewerTickMsg struct{}

type viewerModel struct {
	slug     string
	combined string // the launcher's combined log file (provisioning + all lanes)
	capDir   string // per-service capture dir (logs/<slug>/)

	groups   []string            // tab order: "all" + captured services (CLI names)
	selected int                 // index into groups
	lines    map[string][]string // rendered lines per group, ring-capped
	offsets  map[string]int64    // read offset per file key ("all" or file service name)

	width, height int
}

func newViewerModel(slug, combined, capDir string) *viewerModel {
	return &viewerModel{
		slug:     slug,
		combined: combined,
		capDir:   capDir,
		groups:   []string{viewerAllGroup},
		lines:    map[string][]string{},
		offsets:  map[string]int64{},
	}
}

func (m *viewerModel) Init() tea.Cmd { return viewerTick() }

func viewerTick() tea.Cmd {
	return tea.Tick(300*time.Millisecond, func(time.Time) tea.Msg { return viewerTickMsg{} })
}

func (m *viewerModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		return m, nil
	case viewerTickMsg:
		m.ingest()
		return m, viewerTick()
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "esc", "ctrl+c":
			return m, tea.Quit
		case "right", "l", "tab":
			m.selected = (m.selected + 1) % len(m.groups)
		case "left", "h", "shift+tab":
			m.selected = (m.selected - 1 + len(m.groups)) % len(m.groups)
		default:
			// A digit jumps straight to that tab (1 = all).
			if n := digitKey(msg.String()); n > 0 && n <= len(m.groups) {
				m.selected = n - 1
			}
		}
	}
	return m, nil
}

func digitKey(s string) int {
	if len(s) == 1 && s[0] >= '1' && s[0] <= '9' {
		return int(s[0] - '0')
	}
	return 0
}

// ingest pulls appended bytes from every log file into the group rings, and
// discovers services whose capture appeared since the last pass (a later
// `up +svc` joins the tabs live). Keyed by the group's CURRENT name, so a
// selection index stays valid as groups only ever append.
func (m *viewerModel) ingest() {
	m.ingestCombined()
	for _, svc := range capturedServices(m.capDir) {
		cli := fileToCLIService(svc)
		if !m.hasGroup(cli) {
			m.groups = append(m.groups, cli)
		}
		m.ingestCapture(svc, cli)
	}
}

func (m *viewerModel) hasGroup(name string) bool {
	for _, g := range m.groups {
		if g == name {
			return true
		}
	}
	return false
}

// ingestCombined tails the launcher's combined file: lines already carry the
// supervisor's "name     | text" prefix, so colour is re-derived from it.
func (m *viewerModel) ingestCombined() {
	for _, raw := range m.readFresh(viewerAllGroup, m.combined) {
		m.push(viewerAllGroup, formatCombinedLine(raw))
	}
}

// ingestCapture tails one service's timestamped capture file.
func (m *viewerModel) ingestCapture(fileSvc, cli string) {
	for _, raw := range m.readFresh(fileSvc, filepath.Join(m.capDir, fileSvc+".log")) {
		if l, ok := parseLogLine(fileSvc, raw); ok {
			m.push(cli, formatLogLine(l, false))
		}
	}
}

// readFresh returns the whole lines appended to path since the last pass,
// starting over when the file rotated (shrank) underneath us.
func (m *viewerModel) readFresh(key, path string) []string {
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	offset := m.offsets[key]
	if info.Size() < offset {
		offset = 0
	}
	if info.Size() == offset {
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer func() { _ = f.Close() }()
	buf := make([]byte, info.Size()-offset)
	if _, err := f.ReadAt(buf, offset); err != nil {
		return nil
	}
	m.offsets[key] = info.Size()
	var out []string
	for _, raw := range strings.Split(string(buf), "\n") {
		if raw != "" {
			out = append(out, raw)
		}
	}
	return out
}

func (m *viewerModel) push(group, line string) {
	ring := append(m.lines[group], line)
	if len(ring) > viewerRingCap {
		ring = ring[len(ring)-viewerRingCap:]
	}
	m.lines[group] = ring
}

// formatCombinedLine colours a combined-stream line by its supervisor label
// prefix ("app      | booted") and level-highlights the payload; label-less
// lines (provisioning banners) pass through dimmed-label-free.
func formatCombinedLine(raw string) string {
	label, rest, ok := strings.Cut(raw, "|")
	name := strings.TrimSpace(label)
	if !ok || name == "" || strings.ContainsRune(name, ' ') {
		return highlightLevel(raw)
	}
	color := logServiceColors[fileToCLIService(name)]
	if color == "" {
		color = "90" // one-shot prep lanes (codegen, prepare, seed, deps, langy-image)
	}
	return fmt.Sprintf("\x1b[%sm%-8s\x1b[0m │%s", color, fileToCLIService(name), highlightLevel(rest))
}

func (m *viewerModel) View() string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("\x1b[1m haven up\x1b[0m \x1b[2m— %s · running in the background · q detaches (stack keeps running) · haven down stops\x1b[0m\n", m.slug))
	b.WriteString(" " + m.tabsLine() + "\n\n")
	body := m.height - 4
	if body < 1 {
		body = 20
	}
	lines := m.lines[m.groups[m.selected]]
	if len(lines) > body {
		lines = lines[len(lines)-body:]
	}
	if len(lines) == 0 {
		b.WriteString(" \x1b[2mwaiting for output…\x1b[0m\n")
	}
	for _, l := range lines {
		b.WriteString(" " + l + "\n")
	}
	return b.String()
}

// tabsLine renders the group tabs, the selected one inverted, each numbered
// for direct jumps.
func (m *viewerModel) tabsLine() string {
	parts := make([]string, len(m.groups))
	for i, g := range m.groups {
		label := fmt.Sprintf(" %d %s ", i+1, g)
		if i == m.selected {
			parts[i] = "\x1b[7m" + label + "\x1b[0m"
			continue
		}
		parts[i] = "\x1b[2m" + label + "\x1b[0m"
	}
	return strings.Join(parts, " ")
}
