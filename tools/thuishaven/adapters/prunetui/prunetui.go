// Package prunetui is the interactive prune picker: one screen listing every
// worktree with the footprint deleting it would reclaim — disk size, its
// ClickHouse/Postgres databases, how long it has sat idle, and whether its branch
// was merged and deleted upstream — with the stale ones pre-ticked so the common
// cleanup is one keypress. Like hubtui it never imports the app core: it renders
// the rows it is given and acts through the callbacks it is constructed with, so
// the composition root stays the only place that knows both sides. The concurrent
// scanning lives in the app layer; this package streams two loading states (fast
// meta, slow size), sorts and windows the list so a machine with dozens of
// worktrees never pushes the header off the top, and collects the choice.
package prunetui

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// confirmWord is what the user types to arm the bulk delete — one deliberate act
// standing in for typing each worktree's name, since they have already ticked the
// exact set. It gates discarding real data (databases, uncommitted work).
const confirmWord = "delete"

// Row is one worktree as the picker shows it. The identity + guard fields are
// known up front. The meta fields fill in first (MetaKnown), the disk size fills
// in later (SizeKnown) — two loading states, because the size is much slower to
// measure than the git/database facts.
type Row struct {
	Dir       string
	Branch    string
	Slug      string
	IsPrimary bool
	IsCurrent bool
	IsLive    bool
	Deletable bool

	MetaKnown  bool
	HasCHDB    bool
	HasPGDB    bool
	RedisDB    int
	IsDirty    bool
	OriginGone bool
	StaleFor   time.Duration
	StaleKnown bool

	SizeKnown bool
	DiskBytes int64
}

// MetaResult is a worktree's cheap facts, pushed in as the meta queue completes.
type MetaResult struct {
	HasCHDB    bool
	HasPGDB    bool
	RedisDB    int
	IsDirty    bool
	OriginGone bool
	StaleFor   time.Duration
	StaleKnown bool
}

// Actions wires the picker to the world. Scan runs the two concurrent scan
// queues, calling onMeta as each worktree's meta lands and onSize as each disk
// size lands; it blocks until both finish and is run in its own goroutine.
// DeleteAll removes the confirmed worktrees concurrently — stopping stacks,
// dropping databases, removing directories — calling onDone once per worktree the
// moment it finishes, so the picker streams live progress instead of freezing on a
// slow one. Threshold is the idle age at or beyond which a worktree is pre-ticked.
type Actions struct {
	Rows       []Row
	Threshold  time.Duration
	Scan       func(ctx context.Context, onMeta func(index int, meta MetaResult), onSize func(index int, bytes int64))
	DeleteAll  func(ctx context.Context, dirs []string, onDone func(dir string, err error))
	SharedNote string
}

// Run blocks in the picker. It returns nil when the user quits or the deletions
// finish; a non-nil error only for an unexpected TUI failure (a clean ctx-cancel
// quit is nil).
func Run(ctx context.Context, a Actions) error {
	// A child context so a late scan callback can never block on a Send after the
	// program has exited: cancelling it makes bubbletea's Send a no-op.
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	p := tea.NewProgram(newModel(runCtx, a), tea.WithAltScreen(), tea.WithContext(runCtx))
	if a.Scan != nil {
		go a.Scan(runCtx,
			func(i int, meta MetaResult) { p.Send(metaDoneMsg{index: i, meta: meta}) },
			func(i int, bytes int64) { p.Send(sizeDoneMsg{index: i, bytes: bytes}) },
		)
	}
	_, err := p.Run()
	cancel()
	if err != nil && ctx.Err() != nil { // ctrl+c via signal context is a clean quit
		return nil
	}
	return err
}

type mode int

const (
	modeBrowse mode = iota
	modeConfirm
	modeDeleting
	modeDone
)

// sortMode is how the list is ordered. Cycled with "s"; protected worktrees always
// sink to the bottom regardless, since they are never the thing being cleaned up.
type sortMode int

const (
	sortStale sortMode = iota // most idle first — the cleanup order, and the default
	sortSize                  // largest on disk first
	sortName                  // alphabetical by slug
	sortDirty                 // uncommitted first
	sortGone                  // origin-deleted (merged + pruned) first
	sortModeCount
)

var sortNames = map[sortMode]string{
	sortStale: "most idle",
	sortSize:  "largest",
	sortName:  "name",
	sortDirty: "uncommitted",
	sortGone:  "origin-gone",
}

func (s sortMode) next() sortMode { return (s + 1) % sortModeCount }

type (
	tickMsg     struct{}
	metaDoneMsg struct {
		index int
		meta  MetaResult
	}
	sizeDoneMsg struct {
		index int
		bytes int64
	}
	deleteDoneMsg struct {
		dir string
		err error
	}
	deletesFinishedMsg struct{}
)

// deleteResult is one worktree's delete outcome, streamed over the model's channel.
type deleteResult struct {
	dir string
	err error
}

type model struct {
	ctx      context.Context
	actions  Actions
	rows     []Row
	order    []int // display order: positions into rows, per the current sort
	sort     sortMode
	selected map[string]bool // keyed by Dir
	touched  map[string]bool // rows the user toggled by hand (suppresses auto-select)
	cursor   int             // position within order
	top      int             // first order-position shown in the scrolling window
	mode     mode
	confirm  string // the text typed at the confirm prompt
	spin     int
	width    int
	height   int

	metaCount int
	sizeCount int

	// deletion progress
	delCh         chan deleteResult // per-worktree outcomes stream in over this
	status        map[string]string // dir -> "deleting" / "done" / "failed: …"
	deletingTotal int
	deletedOK     int
	deletedErr    int
	reclaimed     int64
}

func newModel(ctx context.Context, a Actions) model {
	m := model{
		ctx:      ctx,
		actions:  a,
		rows:     append([]Row(nil), a.Rows...),
		selected: map[string]bool{},
		touched:  map[string]bool{},
		status:   map[string]string{},
	}
	m.order = m.computeOrder()
	return m
}

func (m model) Init() tea.Cmd { return tick() }

func tick() tea.Cmd {
	return tea.Tick(150*time.Millisecond, func(time.Time) tea.Msg { return tickMsg{} })
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.ensureVisible()
		return m, nil
	case tickMsg:
		m.spin++
		return m, tick()
	case metaDoneMsg:
		m.applyMeta(msg.index, msg.meta)
		return m, nil
	case sizeDoneMsg:
		m.applySize(msg.index, msg.bytes)
		return m, nil
	case deleteDoneMsg:
		return m.afterDelete(msg)
	case deletesFinishedMsg:
		m.mode = modeDone
		return m, nil
	case tea.KeyMsg:
		switch m.mode {
		case modeConfirm:
			return m.updateConfirm(msg)
		case modeDeleting:
			return m, nil // input is ignored while the bounded, sequential delete runs
		case modeDone:
			return m, tea.Quit
		default:
			return m.updateBrowse(msg)
		}
	}
	return m, nil
}

// applyMeta folds one completed meta scan into its row and, unless the user has
// already touched that row, pre-ticks it when it is stale enough and safe. This
// runs on the fast queue, so selection is ready long before the sizes arrive. Once
// the whole meta pass has landed, the list is re-sorted so the default ordering
// (most idle first) reflects real staleness rather than the initial load order.
func (m *model) applyMeta(i int, r MetaResult) {
	if i < 0 || i >= len(m.rows) {
		return
	}
	row := &m.rows[i]
	if !row.MetaKnown {
		m.metaCount++
	}
	row.MetaKnown = true
	row.HasCHDB = r.HasCHDB
	row.HasPGDB = r.HasPGDB
	row.RedisDB = r.RedisDB
	row.IsDirty = r.IsDirty
	row.OriginGone = r.OriginGone
	row.StaleFor = r.StaleFor
	row.StaleKnown = r.StaleKnown
	if !m.touched[row.Dir] && row.Deletable && !row.IsLive && !row.IsDirty &&
		row.StaleKnown && row.StaleFor >= m.actions.Threshold {
		m.selected[row.Dir] = true
	}
	if m.metaCount == len(m.rows) && m.sortUsesMeta() {
		m.resort()
	}
}

// applySize folds one completed disk size into its row, re-sorting only when the
// list is actually ordered by size (so sizes settling into place don't reshuffle a
// name- or staleness-sorted list underneath the user).
func (m *model) applySize(i int, bytes int64) {
	if i < 0 || i >= len(m.rows) {
		return
	}
	row := &m.rows[i]
	if !row.SizeKnown {
		m.sizeCount++
	}
	row.SizeKnown = true
	row.DiskBytes = bytes
	if m.sort == sortSize {
		m.resort()
	}
}

func (m model) sortUsesMeta() bool { return m.sort != sortSize }

func (m model) updateBrowse(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "esc", "ctrl+c":
		return m, tea.Quit
	case "up", "k":
		if m.cursor > 0 {
			m.cursor--
			m.ensureVisible()
		}
	case "down", "j":
		if m.cursor < len(m.order)-1 {
			m.cursor++
			m.ensureVisible()
		}
	case "s":
		m.sort = m.sort.next()
		m.resort()
	case " ", "x":
		m.toggle(m.rowAt(m.cursor))
	case "a":
		m.selectAll(true)
	case "n":
		m.selectAll(false)
	case "enter", "d":
		if m.countSelected() > 0 {
			m.mode = modeConfirm
			m.confirm = ""
		}
	}
	return m, nil
}

func (m model) updateConfirm(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc", "ctrl+c":
		m.mode = modeBrowse
		m.confirm = ""
	case "backspace":
		if len(m.confirm) > 0 {
			m.confirm = m.confirm[:len(m.confirm)-1]
		}
	case "enter":
		if m.confirm == confirmWord {
			return m.startDeleting()
		}
		m.mode = modeBrowse
		m.confirm = ""
	default:
		if msg.Type == tea.KeyRunes {
			m.confirm += string(msg.Runes)
		}
	}
	return m, nil
}

// startDeleting hands the ticked worktrees to DeleteAll, which tears them down
// concurrently, and starts listening for the per-worktree outcomes. Every ticked
// worktree is marked "deleting" up front because they all go at once; each flips to
// "done" / "failed" as its result streams back over the channel — so the UI keeps
// updating and never freezes on a slow teardown.
func (m model) startDeleting() (tea.Model, tea.Cmd) {
	m.mode = modeDeleting
	m.status = map[string]string{}
	var dirs []string
	for _, ri := range m.order {
		r := m.rows[ri]
		if r.Deletable && m.selected[r.Dir] {
			dirs = append(dirs, r.Dir)
			m.status[r.Dir] = "deleting"
		}
	}
	m.deletingTotal = len(dirs)
	if len(dirs) == 0 {
		m.mode = modeDone
		return m, nil
	}
	// Buffered to the worktree count so the workers never block reporting back even
	// if the event loop is mid-render; the goroutine closes it when the batch is
	// done (DeleteAll has also pruned git's admin by then), which ends the listen.
	ch := make(chan deleteResult, len(dirs))
	m.delCh = ch
	deleteAll, ctx := m.actions.DeleteAll, m.ctx
	go func() {
		if deleteAll != nil {
			deleteAll(ctx, dirs, func(dir string, err error) { ch <- deleteResult{dir: dir, err: err} })
		}
		close(ch)
	}()
	return m, waitDelete(ch)
}

// waitDelete blocks on the next delete outcome; a closed channel means the whole
// batch (and its final git prune) has finished.
func waitDelete(ch chan deleteResult) tea.Cmd {
	return func() tea.Msg {
		r, ok := <-ch
		if !ok {
			return deletesFinishedMsg{}
		}
		return deleteDoneMsg{dir: r.dir, err: r.err}
	}
}

func (m model) afterDelete(msg deleteDoneMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.status[msg.dir] = "failed: " + oneLine(msg.err.Error())
		m.deletedErr++
	} else {
		m.status[msg.dir] = "done"
		m.deletedOK++
		m.reclaimed += m.diskOf(msg.dir)
	}
	return m, waitDelete(m.delCh) // keep listening until the channel closes
}

// rowAt maps a display position to its row index, or -1 when out of range.
func (m model) rowAt(pos int) int {
	if pos < 0 || pos >= len(m.order) {
		return -1
	}
	return m.order[pos]
}

func (m *model) toggle(i int) {
	if i < 0 || i >= len(m.rows) {
		return
	}
	r := m.rows[i]
	if !r.Deletable {
		return
	}
	m.touched[r.Dir] = true
	m.selected[r.Dir] = !m.selected[r.Dir]
}

func (m *model) selectAll(on bool) {
	for _, r := range m.rows {
		if !r.Deletable {
			continue
		}
		m.touched[r.Dir] = true
		m.selected[r.Dir] = on
	}
}

// --- ordering ----------------------------------------------------------------

// computeOrder returns the row indices in display order for the current sort.
// Protected worktrees always sort last (they are never cleanup targets); within a
// tier, the sort key decides, with slug name as the stable tiebreak.
func (m model) computeOrder() []int {
	idx := make([]int, len(m.rows))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool {
		ra, rb := m.rows[idx[a]], m.rows[idx[b]]
		if ra.Deletable != rb.Deletable {
			return ra.Deletable
		}
		return m.less(ra, rb)
	})
	return idx
}

func (m model) less(a, b Row) bool {
	switch m.sort {
	case sortSize:
		if a.SizeKnown != b.SizeKnown {
			return a.SizeKnown // measured sizes ahead of the still-loading ones
		}
		if a.DiskBytes != b.DiskBytes {
			return a.DiskBytes > b.DiskBytes
		}
	case sortDirty:
		if a.IsDirty != b.IsDirty {
			return a.IsDirty
		}
	case sortGone:
		if a.OriginGone != b.OriginGone {
			return a.OriginGone
		}
	case sortName:
		// name is the tiebreak below — nothing extra
	default: // sortStale
		if a.StaleKnown != b.StaleKnown {
			return a.StaleKnown // known staleness ahead of the still-loading ones
		}
		if a.StaleFor != b.StaleFor {
			return a.StaleFor > b.StaleFor
		}
	}
	return strings.ToLower(displayName(a)) < strings.ToLower(displayName(b))
}

// resort recomputes the order and keeps the cursor on the same worktree it was on,
// so re-sorting (or a sort-key change) never yanks the highlight to a different row.
func (m *model) resort() {
	var focus string
	if m.cursor >= 0 && m.cursor < len(m.order) {
		focus = m.rows[m.order[m.cursor]].Dir
	}
	m.order = m.computeOrder()
	m.cursor = 0
	for pos, ri := range m.order {
		if m.rows[ri].Dir == focus {
			m.cursor = pos
			break
		}
	}
	m.ensureVisible()
}

// ensureVisible scrolls the window so the cursor stays on screen. It uses a
// conservative row budget (a little smaller than View's exact one) so the cursor
// is always comfortably inside the rendered window even as the footer height
// varies between modes.
func (m *model) ensureVisible() {
	vis := m.scrollCap()
	if m.cursor < m.top {
		m.top = m.cursor
	}
	if m.cursor >= m.top+vis {
		m.top = m.cursor - vis + 1
	}
	maxTop := len(m.order) - vis
	if maxTop < 0 {
		maxTop = 0
	}
	if m.top > maxTop {
		m.top = maxTop
	}
	if m.top < 0 {
		m.top = 0
	}
}

func (m model) countSelected() int {
	n := 0
	for _, r := range m.rows {
		if r.Deletable && m.selected[r.Dir] {
			n++
		}
	}
	return n
}

func (m model) selectedBytes() int64 {
	var b int64
	for _, r := range m.rows {
		if r.Deletable && m.selected[r.Dir] && r.SizeKnown {
			b += r.DiskBytes
		}
	}
	return b
}

func (m model) diskOf(dir string) int64 {
	for _, r := range m.rows {
		if r.Dir == dir {
			return r.DiskBytes
		}
	}
	return 0
}

func (m model) anyDeletable() bool {
	for _, r := range m.rows {
		if r.Deletable {
			return true
		}
	}
	return false
}

// sizeTarget is how many rows the size pass will ever report: only deletable
// worktrees are sized, so the sizing progress indicator counts against this.
func (m model) sizeTarget() int {
	n := 0
	for _, r := range m.rows {
		if r.Deletable {
			n++
		}
	}
	return n
}

// --- view --------------------------------------------------------------------

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
	b.WriteString(styleDim.Render(" "+strings.Repeat("─", m.divider())) + "\n\n")
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
		b.WriteString(styleDim.Render(fmt.Sprintf("  … %d–%d of %d (↑↓ scroll)", top+1, end, n)) + "\n")
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
		b.WriteString(styleWarn.Render(fmt.Sprintf("  Delete %d worktree(s) — stops their stacks, drops their databases, removes their", n)) + "\n")
		b.WriteString(styleWarn.Render(fmt.Sprintf("  directories (uncommitted changes included). Reclaims ~%s.", domain.HumanBytes(m.selectedBytes()))) + "\n")
		b.WriteString(styleWarn.Render(fmt.Sprintf("  type %q to confirm: %s▏", confirmWord, m.confirm)) + "\n")
	case modeDeleting:
		done := m.deletedOK + m.deletedErr
		inFlight := m.deletingTotal - done
		spin := spinnerFrames[m.spin%len(spinnerFrames)]
		b.WriteString("\n")
		b.WriteString(styleWarn.Render(fmt.Sprintf("  %s deleting in parallel — %d/%d done", spin, done, m.deletingTotal)) + "\n")
		tally := fmt.Sprintf("  %d in flight", inFlight)
		if m.deletedOK > 0 {
			tally += fmt.Sprintf(" · %d done", m.deletedOK)
		}
		if m.deletedErr > 0 {
			tally += fmt.Sprintf(" · %d failed", m.deletedErr)
		}
		b.WriteString(styleDim.Render(tally) + "\n")
	case modeDone:
		msg := fmt.Sprintf("  deleted %d worktree(s), reclaimed ~%s", m.deletedOK, domain.HumanBytes(m.reclaimed))
		if m.deletedErr > 0 {
			msg += fmt.Sprintf(", %d failed", m.deletedErr)
		}
		b.WriteString("\n")
		b.WriteString(styleGood.Render(msg) + "\n")
		b.WriteString(styleDim.Render("  press any key to exit") + "\n")
	default:
		b.WriteString("\n")
		b.WriteString(m.renderDetail())
		if m.anyDeletable() {
			b.WriteString(styleDim.Render("  ↑↓ move · space toggle · a all · n none · s sort · enter delete · q quit") + "\n")
		} else {
			b.WriteString(styleDim.Render("  no other worktrees to prune · q quit") + "\n")
		}
		if m.actions.SharedNote != "" {
			b.WriteString(styleDim.Render("  "+m.actions.SharedNote) + "\n")
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
	b.WriteString(styleDim.Render("  "+r.Dir) + "\n")
	switch {
	case !r.Deletable:
		b.WriteString(styleDim.Render("  protected — never deleted by prune") + "\n")
	case r.MetaKnown:
		b.WriteString(styleDim.Render("  reclaims: "+reclaimDetail(r)) + "\n")
	default:
		b.WriteString(styleDim.Render("  scanning…") + "\n")
	}
	return b.String()
}

func (m model) selectedRow() (Row, bool) {
	if m.cursor < 0 || m.cursor >= len(m.order) {
		return Row{}, false
	}
	return m.rows[m.order[m.cursor]], true
}

func displayName(r Row) string {
	if r.Slug != "" {
		return r.Slug
	}
	return filepath.Base(r.Dir)
}

// pathPreview shortens a worktree path to its last two segments, so the inline
// preview shows where it lives without the full absolute path.
func pathPreview(dir string) string {
	segs := strings.Split(strings.Trim(dir, "/"), "/")
	if len(segs) <= 2 {
		return dir
	}
	return "…/" + strings.Join(segs[len(segs)-2:], "/")
}

func dbChips(r Row) string {
	var chips []string
	if r.HasCHDB {
		chips = append(chips, "ch")
	}
	if r.HasPGDB {
		chips = append(chips, "pg")
	}
	return strings.Join(chips, " ")
}

func reclaimDetail(r Row) string {
	size := "size …"
	if r.SizeKnown {
		size = domain.HumanBytes(r.DiskBytes) + " disk"
	}
	parts := []string{size}
	if r.HasCHDB {
		parts = append(parts, "ClickHouse "+domain.DatabaseForSlug(r.Slug))
	}
	if r.HasPGDB {
		parts = append(parts, "Postgres "+domain.DatabaseForSlug(r.Slug))
	}
	if r.RedisDB >= 0 {
		parts = append(parts, fmt.Sprintf("redis db %d", r.RedisDB))
	}
	if r.OriginGone {
		parts = append(parts, "branch merged + deleted upstream")
	}
	return strings.Join(parts, " · ")
}

// countLines counts the rendered lines in s (each ends with "\n").
func countLines(s string) int { return strings.Count(s, "\n") }

// clampLines truncates every line to w display cells (ANSI-aware) so no line can
// soft-wrap and push the layout past the terminal height. Newlines are preserved,
// so it never changes the line count View budgeted for.
func clampLines(s string, w int) string {
	if w <= 0 {
		return s
	}
	clamp := lipgloss.NewStyle().MaxWidth(w)
	lines := strings.Split(s, "\n")
	for i, ln := range lines {
		lines[i] = clamp.Render(ln)
	}
	return strings.Join(lines, "\n")
}

// truncate bounds a cell to n runes so one long name can't shear the layout.
func truncate(s string, n int) string {
	if n < 1 {
		n = 1
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

// oneLine flattens a multi-line error to a single line for a status cell.
func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}
