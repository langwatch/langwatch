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
//
// The package is split by responsibility: this file holds the public surface
// (Run, Actions, Row) plus the model struct and its Update loop; model.go holds
// the state transitions and the delete sequencing; order.go holds sorting and
// scroll geometry; view.go holds rendering.
package prunetui

import (
	"context"
	"time"

	tea "github.com/charmbracelet/bubbletea"
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
			return m, nil // input is ignored while the parallel delete streams back
		case modeDone:
			return m, tea.Quit
		default:
			return m.updateBrowse(msg)
		}
	}
	return m, nil
}
