package prunetui

import tea "github.com/charmbracelet/bubbletea"

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

func (m model) selectedRow() (Row, bool) {
	if m.cursor < 0 || m.cursor >= len(m.order) {
		return Row{}, false
	}
	return m.rows[m.order[m.cursor]], true
}
