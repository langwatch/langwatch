package prunetui

import (
	"sort"
	"strings"
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
