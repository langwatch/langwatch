package viewer

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

type simulatorResult struct {
	items []sources.SimulatorItem
	err   error
}

type mailDetailResult struct {
	id    string
	lines []string
	err   error
}

// SimulatorTab lets a project inspect its inbox and identity tenants.
type SimulatorTab struct {
	noAttention
	src                             Sources
	name, browserURL, notice, query string
	recipient                       string
	items                           []sources.SimulatorItem
	cursor                          int
	prompt                          bool
	polled                          time.Time
	pending                         chan simulatorResult
	detail                          detailPanel
	opened                          *sources.SimulatorItem
	detailPending                   chan mailDetailResult
	addresses                       bool
}

// NewSimulatorTab builds the mail or identity screen.
func NewSimulatorTab(name string, src Sources) *SimulatorTab {
	return &SimulatorTab{name: name, src: src}
}

// Name is the simulator's service name.
func (t *SimulatorTab) Name() string { return t.name }

// Rows returns the same summaries shown in the terminal.
func (t *SimulatorTab) Rows() any { return t.items }

// Poll keeps network waits off the terminal's event loop.
func (t *SimulatorTab) Poll() {
	t.collectDetail()

	if t.pending != nil {
		select {
		case result := <-t.pending:
			t.pending = nil
			t.accept(result)
		default:
			return
		}
	}
	if t.src.Simulator == nil || time.Since(t.polled) < 2*time.Second {
		return
	}
	port, browserURL := t.src.Simulator(t.name)
	t.browserURL = strings.TrimRight(browserURL, "/")
	if port == 0 {
		t.notice = "Not running in this stack. Start with haven up +" + t.name
		return
	}
	t.polled = time.Now()
	t.pending = make(chan simulatorResult, 1)
	ch, name := t.pending, t.name
	go func() {
		items, err := sources.ReadSimulator(port, name)
		ch <- simulatorResult{items: items, err: err}
	}()
}

func (t *SimulatorTab) accept(result simulatorResult) {
	if result.err != nil {
		t.notice = "Could not refresh; retrying. " + result.err.Error()
		return
	}
	selected := ""
	if rows := t.filtered(); t.cursor < len(rows) {
		selected = rows[t.cursor].ID
	}
	t.items, t.notice = result.items, ""
	rows := t.filtered()
	t.cursor = minInt(t.cursor, maxInt(len(rows)-1, 0))
	for i, row := range rows {
		if row.ID == selected {
			t.cursor = i
		}
	}
}

func (t *SimulatorTab) filtered() []sources.SimulatorItem {
	var out []sources.SimulatorItem
	items := t.items
	if t.addresses {
		items = t.recipientItems()
	}
	for _, item := range items {
		if !t.matchesRecipient(item) {
			continue
		}
		if strings.Contains(strings.ToLower(item.Title+" "+item.Detail), strings.ToLower(t.query)) {
			out = append(out, item)
		}
	}
	return out
}

// Header pins the simulator name, result count and address above its list.
func (t *SimulatorTab) Header() []string {
	title, noun := "Mail", "messages"
	description := "This stack's inbox · accepts any recipient address · messages stay local"
	if t.name == "idp" {
		title, noun = "Identity providers", "providers"
		description = "Choose a provider to inspect its users and registered applications"
	}
	if t.addresses {
		title, noun = "Mail / Recipients", "addresses"
		description = "Addresses in retained mail · enter filters the inbox to this recipient"
	}
	if t.opened != nil {
		title += " / Details"
	}
	rows := []string{" " + bold(title) + dim(fmt.Sprintf("  ·  %d %s", len(t.filtered()), noun)), " " + dim(description)}
	if t.recipient != "" {
		rows = append(rows, " "+dim("Recipient: "+t.recipient+" · esc Clear"))
	}
	if t.query != "" {
		rows = append(rows, " "+dim("Filter: "+t.query+" · esc Clear"))
	}
	if t.notice != "" {
		rows = append(rows, " "+red(t.notice))
	}
	return append(rows, "")
}

// Body keeps the selected summary visible as the list grows.
func (t *SimulatorTab) Body(f Frame) []Row {
	if t.opened != nil {
		return t.detail.body(f)
	}
	items := t.filtered()
	if len(items) == 0 {
		message := "Nothing here yet."
		if t.query != "" {
			message = "No matches. Esc clears the filter."
		} else if t.pending != nil {
			message = "Loading…"
		}
		return textRows([]string{" " + dim(message)})
	}
	count := maxInt(f.Rows()/2, 1)
	start := maxInt(t.cursor-count+1, 0)
	var rows []Row
	for i := start; i < minInt(start+count, len(items)); i++ {
		prefix := "  "
		if i == t.cursor {
			prefix = "› "
		}
		title := prefix + items[i].Title
		detail := "  " + dim(items[i].Detail)
		if i == t.cursor {
			title = SelectedLine(title, max(0, f.Width-2))
			detail = SelectedLine(detail, max(0, f.Width-2))
		}
		rows = append(rows, Row{Text: title}, Row{Text: detail})
	}
	return rows[:minInt(len(rows), f.Rows())]
}

// Footer displays search input, refresh failures or available actions.
func (t *SimulatorTab) Footer() string {
	if t.opened != nil {
		return t.detail.footer() + " · o Browser"
	}
	if t.prompt {
		return "/" + t.query + "▏  enter applies · esc clears"
	}
	help := "↑↓ Select · enter Details · o Browser · / Search"
	if t.name == "mail" {
		help += " · a Recipients"
		if t.addresses {
			help = "↑↓ Select · enter Filter inbox · a Inbox · / Search"
		}
	}
	return help
}

// Key handles filtering, selection and browser handoff.
func (t *SimulatorTab) Key(k string) bool {
	if t.opened != nil {
		switch k {
		case "esc":
			t.opened = nil
			return true
		case "o":
			t.openSelected()
			return true
		default:
			return t.detail.key(k)
		}
	}

	if t.prompt {
		t.searchKey(k)
		return true
	}
	rows := t.filtered()
	switch k {
	case "/":
		t.prompt = true
	case "esc":
		return t.clearFilter()
	case "up", "k", "wheelup":
		t.cursor = maxInt(t.cursor-1, 0)
	case "down", "j", "wheeldown":
		t.cursor = minInt(t.cursor+1, maxInt(len(rows)-1, 0))
	case "a":
		if t.name != "mail" {
			return false
		}
		t.addresses, t.query, t.recipient, t.cursor = !t.addresses, "", "", 0
	case "enter":
		t.inspectSelected(rows)
	case "o":
		t.openSelected()
	default:
		return false
	}
	return true
}

func (t *SimulatorTab) searchKey(k string) {
	switch k {
	case "enter":
		t.prompt = false
	case "esc":
		t.prompt, t.query = false, ""
	case "backspace":
		t.query = trimLastRune(t.query)
	default:
		if len([]rune(k)) == 1 {
			t.query += k
		}
	}
	t.cursor = 0
}

func (t *SimulatorTab) openSelected() {
	if t.src.Open == nil || t.browserURL == "" {
		return
	}
	url := t.browserURL
	rows := t.filtered()
	if t.opened != nil {
		url += t.opened.Path
	} else if t.cursor < len(rows) {
		url += rows[t.cursor].Path
	}
	if err := t.src.Open(url); err != nil {
		t.notice = err.Error()
	}
}

func (t *SimulatorTab) inspect(item sources.SimulatorItem) {
	t.opened = &item
	t.detail = detailPanel{lines: append([]string{bold(item.Title), "", item.Detail, ""}, item.Preview...)}
	if t.name != "mail" || t.src.Simulator == nil {
		return
	}
	port, _ := t.src.Simulator(t.name)
	if port == 0 {
		return
	}
	t.detail.lines = append(t.detail.lines, "", "Loading message…")
	ch := make(chan mailDetailResult, 1)
	t.detailPending = ch
	go func() {
		lines, err := sources.ReadMailDetail(port, item.ID)
		ch <- mailDetailResult{id: item.ID, lines: lines, err: err}
	}()
}

func (t *SimulatorTab) recipientItems() []sources.SimulatorItem {
	counts := map[string]int{}
	for _, item := range t.items {
		seen := map[string]bool{}
		for _, address := range item.Recipients {
			address = strings.ToLower(address)
			if !seen[address] {
				counts[address]++
				seen[address] = true
			}
		}
	}
	var out []sources.SimulatorItem
	for address, count := range counts {
		out = append(out, sources.SimulatorItem{ID: address, Title: address, Detail: fmt.Sprintf("%d messages · enter to filter inbox", count)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Title < out[j].Title })
	return out
}

func (t *SimulatorTab) collectDetail() {
	if t.detailPending == nil {
		return
	}
	var result mailDetailResult
	select {
	case result = <-t.detailPending:
	default:
		return
	}
	t.detailPending = nil
	if t.opened == nil || t.opened.ID != result.id {
		return
	}
	lines := append([]string{bold(t.opened.Title), ""}, t.opened.Preview...)
	if result.err != nil {
		lines = append(lines, "", "Could not load message. Press esc and enter to retry.")
	} else {
		lines = append(lines, result.lines...)
	}
	t.detail.lines = lines
}

func (t *SimulatorTab) matchesRecipient(item sources.SimulatorItem) bool {
	if t.addresses || t.recipient == "" {
		return true
	}
	for _, address := range item.Recipients {
		if strings.EqualFold(address, t.recipient) {
			return true
		}
	}
	return false
}

func (t *SimulatorTab) clearFilter() bool {
	if !t.addresses && t.query == "" && t.recipient == "" {
		return false
	}
	t.addresses, t.query, t.recipient, t.cursor = false, "", "", 0
	return true
}

func (t *SimulatorTab) inspectSelected(rows []sources.SimulatorItem) {
	if t.cursor >= len(rows) {
		return
	}
	item := rows[t.cursor]
	if t.addresses {
		t.recipient, t.query, t.addresses, t.cursor = item.Title, "", false, 0
		return
	}
	t.inspect(item)
}
