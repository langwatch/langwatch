package dashboard

import (
	"fmt"
	"html/template"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Extras is everything the page shows beyond the registry cards: the machine's
// partitioned memory picture, the stackless worktrees, and the daemon's recent
// reaping. It arrives through a callback so the adapter stays ignorant of the
// app core; a zero Extras degrades to the registry-only page.
type Extras struct {
	Summary   SummaryView
	Worktrees []WorktreeView
	Events    []EventView
	// StackRSS is each live stack's whole-tree resident set by launcher pid —
	// the accurate per-card number (group RSS sees only the launcher itself).
	StackRSS map[int]uint64
}

// SummaryView is the machine header: every process attributed once.
type SummaryView struct {
	TotalRAM   uint64
	StacksRSS  uint64
	ServerRSS  map[string]uint64
	AgentRSS   uint64
	AgentCount int
	ToolingRSS uint64
	OtherRSS   uint64
	Pressure   string
}

// DevRSS is everything attributed to dev work, summed.
func (s SummaryView) DevRSS() uint64 {
	total := s.StacksRSS + s.AgentRSS + s.ToolingRSS
	for _, rss := range s.ServerRSS {
		total += rss
	}
	return total
}

// WorktreeView is a worktree with no registered stack.
type WorktreeView struct {
	Slug, Branch, Dir    string
	IsPrimary, IsCurrent bool
}

// EventView is one daemon reclamation, newest first.
type EventView struct {
	At                   time.Time
	Kind, Target, Reason string
}

// stackCard is renderCard's result: the card's view data plus the per-stack
// numbers renderHTML aggregates into the page-level stats.
type stackCard struct {
	view          cardView
	isLive        bool
	servicesUp    int
	servicesTotal int
}

// cardView is one stack card as the template sees it — slug, live/stale pill,
// chips, worktree dir, and a row per service with a liveness dot.
type cardView struct {
	Slug       string
	Badge      string
	BadgeClass string
	Branch     string
	Dir        string
	OpenURL    string // the card's primary action; empty hides it
	Chips      []chipView
	Rows       []rowView
}

type chipView struct {
	Label      string
	Value      string
	IsBaseline bool
}

// rowView is one service line. IsSub marks the api sub-row rendered under the
// app service (the API shares app's origin, so it has no hostname of its own).
type rowView struct {
	DotClass string
	Name     string
	URL      string
	Host     string
	Port     string // pre-rendered ":<n>", empty when the port is unknown
	IsSub    bool
}

// statView renders as Value, then a dim "/ Of" when Of is set — plain fields,
// so the template's auto-escaping stays in charge of every byte.
type statView struct {
	Value string
	Of    string
	Label string
}

type barView struct {
	DevPct, OtherPct     int
	DevLabel, OtherLabel string
	Breakdown            string
}

type wtRow struct {
	Name, Branch, Dir, Note string
}

type eventRow struct {
	Age, Kind, Target, Reason string
}

type pageView struct {
	ObsURL, ObsHost string
	TelURL, TelHost string
	Pressure        string // shown as a header pill when not green/empty
	Stats           []statView
	Bar             *barView
	SharedNote      string
	Cards           []cardView
	Worktrees       []wtRow
	Events          []eventRow
	IsEmpty         bool
}

// sharedServiceNames are the machine-wide servers every stack's routing table
// carries. Their rows repeated identically on every card, so the cards keep
// only the stack's own services and the shared set is stated once.
var sharedServiceNames = map[string]bool{
	domain.ClickHouseService: true,
	domain.PostgresService:   true,
	domain.RedisService:      true,
}

// renderCard builds one stack's view data and per-stack aggregates. treeRSS is
// the stack's whole-tree footprint (0 hides the chip).
func renderCard(s domain.Stack, probes Probes, treeRSS uint64) stackCard {
	var c stackCard
	c.isLive = s.LauncherPID != 0
	if c.isLive && probes.ProcessAlive != nil {
		c.isLive = probes.ProcessAlive(s.LauncherPID)
	}
	badge := "stale"
	if c.isLive {
		badge = "live"
	}

	c.view = cardView{
		Slug:       s.Slug,
		Badge:      badge,
		BadgeClass: badge,
		Branch:     s.Branch,
		Dir:        s.WorktreeDir,
		OpenURL:    appURL(s),
		Chips:      cardChips(s, c.isLive, treeRSS),
	}
	c.view.Rows, c.servicesUp, c.servicesTotal = cardRows(s, probes)
	return c
}

func appURL(s domain.Stack) string {
	for _, svc := range s.Services {
		if svc.Name == "app" && svc.URL != "" {
			return svc.URL
		}
	}
	return ""
}

func cardChips(s domain.Stack, isLive bool, treeRSS uint64) []chipView {
	var chips []chipView
	if s.ClickHouseDatabase != "" {
		chips = append(chips, chipView{Label: "clickhouse", Value: s.ClickHouseDatabase})
	}
	chips = append(chips, chipView{Label: "redis db", Value: fmt.Sprintf("%d", s.RedisDB)})
	if isLive && treeRSS > 0 {
		chips = append(chips, chipView{Label: "ram", Value: "~" + humanBytesU(treeRSS)})
	}
	if !s.UpdatedAt.IsZero() {
		chips = append(chips, chipView{Label: "heartbeat", Value: shortAge(time.Since(s.UpdatedAt))})
	}
	if s.IsBaseline {
		chips = append(chips, chipView{IsBaseline: true})
	}
	return chips
}

// cardRows lists the stack's OWN services — the shared servers are stated once
// for the page, not repeated on every card.
func cardRows(s domain.Stack, probes Probes) (rows []rowView, up, total int) {
	for _, svc := range s.Services {
		if sharedServiceNames[svc.Name] {
			continue
		}
		total++
		dotClass := "down"
		if probes.PortInUse != nil && svc.Port != 0 && probes.PortInUse(svc.Port) {
			dotClass = "up"
			up++
		}
		rows = append(rows, rowView{DotClass: dotClass, Name: svc.Name, URL: svc.URL, Host: svc.Hostname, Port: portText(svc.Port)})
		// The API shares app's origin — show it as a sub-row so the single URL
		// is unmistakable (no separate api.<slug> hostname).
		if svc.Name == "app" && s.APIPort != 0 {
			rows = append(rows, rowView{IsSub: true, Name: "└ api", URL: svc.URL + "/api", Host: svc.Hostname + "/api", Port: portText(s.APIPort)})
		}
	}
	return rows, up, total
}

// portText renders a port for display; a zero port (not yet allocated) shows
// nothing rather than a lying ":0".
func portText(port int) string {
	if port == 0 {
		return ""
	}
	return fmt.Sprintf(":%d", port)
}

// pageAggregates are the card-derived counts the stats row shows.
type pageAggregates struct {
	total, live, servicesUp, servicesTotal, databases int
}

// renderInputs groups everything renderHTML needs beyond the registry itself.
type renderInputs struct {
	sharedURL func(string) string
	probes    Probes
	extras    Extras
}

// renderHTML draws the machine: the partitioned RAM picture up top, one card
// per stack, the shared servers once, the stackless worktrees, and the
// daemon's recent reaping.
func renderHTML(stacks []domain.Stack, in renderInputs) string {
	agg := pageAggregates{total: len(stacks)}
	var cards []cardView
	for i := range stacks {
		c := renderCard(stacks[i], in.probes, in.extras.StackRSS[stacks[i].LauncherPID])
		cards = append(cards, c.view)
		if c.isLive {
			agg.live++
		}
		agg.servicesUp += c.servicesUp
		agg.servicesTotal += c.servicesTotal
		if stacks[i].ClickHouseDatabase != "" {
			agg.databases++
		}
		agg.databases++ // the Redis DB every stack gets
	}

	page := pageView{
		ObsURL: in.sharedURL("observability"), ObsHost: hostFromURL(in.sharedURL("observability")),
		TelURL: in.sharedURL("telemetry"), TelHost: hostFromURL(in.sharedURL("telemetry")),
		Stats:      pageStats(agg, in.extras.Summary),
		Bar:        machineBar(in.extras.Summary),
		SharedNote: sharedNote(in.extras.Summary.ServerRSS),
		Cards:      cards,
		Worktrees:  worktreeRows(in.extras.Worktrees),
		Events:     eventRows(in.extras.Events),
		IsEmpty:    len(stacks) == 0,
	}
	if p := in.extras.Summary.Pressure; p != "" && p != "green" {
		page.Pressure = p
	}

	var b strings.Builder
	if err := pageTmpl.Execute(&b, page); err != nil {
		// The template is static and the data is plain values, so this cannot
		// fail at runtime — but a page saying so beats a blank one if it ever does.
		return "<!doctype html><title>haven</title><p>dashboard render error: " +
			template.HTMLEscapeString(err.Error())
	}
	return b.String()
}

func pageStats(agg pageAggregates, s SummaryView) []statView {
	ram := statView{Value: "—", Label: "dev ram"}
	if dev := s.DevRSS(); dev > 0 {
		ram.Value = "~" + humanBytesU(dev)
		if s.TotalRAM > 0 {
			ram.Of = humanBytesU(s.TotalRAM)
		}
	}
	return []statView{
		{Value: fmt.Sprintf("%d", agg.live), Of: fmt.Sprintf("%d", agg.total), Label: "stacks live"},
		{Value: fmt.Sprintf("%d", agg.servicesUp), Of: fmt.Sprintf("%d", agg.servicesTotal), Label: "services up"},
		ram,
		{Value: fmt.Sprintf("%d", s.AgentCount), Label: "agents"},
		{Value: fmt.Sprintf("%d", agg.databases), Label: "databases"},
	}
}

// machineBar sizes the two-color RAM bar: dev work, other work, free track.
// Summed RSS double-counts shared pages, so segments are clamped to the bar.
func machineBar(s SummaryView) *barView {
	if s.TotalRAM == 0 || s.DevRSS() == 0 {
		return nil
	}
	devPct := min(100, int(s.DevRSS()*100/s.TotalRAM))
	otherPct := min(100-devPct, int(s.OtherRSS*100/s.TotalRAM))
	var parts []string
	if s.StacksRSS > 0 {
		parts = append(parts, "stacks ~"+humanBytesU(s.StacksRSS))
	}
	if servers := sumRSS(s.ServerRSS); servers > 0 {
		parts = append(parts, "servers ~"+humanBytesU(servers))
	}
	if s.AgentRSS > 0 {
		parts = append(parts, fmt.Sprintf("agents ~%s (%d)", humanBytesU(s.AgentRSS), s.AgentCount))
	}
	if s.ToolingRSS > 0 {
		parts = append(parts, "tooling ~"+humanBytesU(s.ToolingRSS))
	}
	return &barView{
		DevPct:     devPct,
		OtherPct:   otherPct,
		DevLabel:   "dev work ~" + humanBytesU(s.DevRSS()),
		OtherLabel: "everything else ~" + humanBytesU(s.OtherRSS),
		Breakdown:  strings.Join(parts, " · "),
	}
}

func sharedNote(servers map[string]uint64) string {
	var parts []string
	for _, name := range []string{"clickhouse", "postgres", "redis", "containers"} {
		if rss := servers[name]; rss > 0 {
			parts = append(parts, fmt.Sprintf("%s ~%s", name, humanBytesU(rss)))
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return "Shared by every stack: " + strings.Join(parts, " · ")
}

func worktreeRows(worktrees []WorktreeView) []wtRow {
	var rows []wtRow
	for _, w := range worktrees {
		name := w.Slug
		if name == "" {
			if i := strings.LastIndexByte(w.Dir, '/'); i >= 0 {
				name = w.Dir[i+1:]
			} else {
				name = w.Dir
			}
		}
		note := ""
		switch {
		case w.IsPrimary:
			note = "primary, protected"
		case w.IsCurrent:
			note = "current, protected"
		}
		rows = append(rows, wtRow{Name: name, Branch: w.Branch, Dir: w.Dir, Note: note})
	}
	return rows
}

func eventRows(events []EventView) []eventRow {
	const maxEvents = 12
	var rows []eventRow
	for _, ev := range events {
		if len(rows) == maxEvents {
			break
		}
		age := "now"
		if !ev.At.IsZero() {
			age = shortAge(time.Since(ev.At))
		}
		rows = append(rows, eventRow{Age: age, Kind: ev.Kind, Target: ev.Target, Reason: ev.Reason})
	}
	return rows
}

func sumRSS(m map[string]uint64) uint64 {
	var total uint64
	for _, v := range m {
		total += v
	}
	return total
}

func shortAge(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds ago", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd ago", int(d.Hours()/24))
	}
}

func humanBytesU(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%dB", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f%cB", float64(b)/float64(div), "KMGTPE"[exp])
}

func hostFromURL(u string) string {
	u = strings.TrimPrefix(strings.TrimPrefix(u, "https://"), "http://")
	if i := strings.IndexByte(u, ':'); i >= 0 {
		return u[:i]
	}
	return u
}

var pageTmpl = template.Must(template.New("page").Parse(pageTemplate))
