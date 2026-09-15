package viewer

import (
	"fmt"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// ProfilesTab answers the question traces and metrics cannot: which function
// burned the CPU. Traces say which call was slow and metrics say the process
// was busy; without this the last step of a performance investigation is a
// guess or a reproduction that never quite matches.

// ProfilesTab is the profiles screen.
type ProfilesTab struct {
	noHeader
	noAttention
	src      Sources
	services []sources.ServiceProfile
	cursor   int
	down     bool
	toast    string
}

// NewProfilesTab builds the profiles screen over Pyroscope.
func NewProfilesTab(src Sources) *ProfilesTab { return &ProfilesTab{src: src} }

// Name is the tab's label and command name.
func (t *ProfilesTab) Name() string { return "profiles" }

// Poll refreshes the per-service lists. Nothing is asked when the stack is not
// listening.
func (t *ProfilesTab) Poll() {
	if t.src.Profiles == nil {
		return
	}
	if t.down = !t.src.Profiles.Up(); t.down {
		return
	}
	if services, err := t.src.Profiles.Top(); err == nil {
		t.services = services
	}
}

// Body renders the selected service's two top-ten lists side by side.
func (t *ProfilesTab) Body(f Frame) []Row {
	if t.down {
		return stackDownBody()
	}
	if len(t.services) == 0 {
		return emptyBody("profiles in the last ten minutes")
	}
	out := []string{" " + t.serviceLine()}
	service := t.services[clamp(t.cursor, len(t.services)-1)]
	out = append(out, " "+bold("CPU"))
	out = append(out, entryRows(service.CPU)...)
	out = append(out, " "+bold("heap"))
	out = append(out, entryRows(service.Heap)...)
	return lastNRows(indexedRows(out), f.Rows())
}

// entryRows renders one top-ten list.
func entryRows(entries []sources.ProfileEntry) []string {
	if len(entries) == 0 {
		return []string{"   " + dim("nothing sampled")}
	}
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		out = append(out, fmt.Sprintf("   %s %s", pad(fmt.Sprintf("%4.1f%%", entry.Share*100), 7), entry.Function))
	}
	return out
}

// serviceLine renders the service selector, the current one inverted.
func (t *ProfilesTab) serviceLine() string {
	line := ""
	for i, service := range t.services {
		label := " " + service.Service + " "
		if i == t.cursor {
			line += sgrReverse + label + sgrReset + " "
			continue
		}
		line += dim(label) + " "
	}
	return line
}

// Footer names the keys, and any toast the last `o` left behind.
func (t *ProfilesTab) Footer() string {
	if t.toast != "" {
		return dim(t.toast)
	}
	return dim("↑↓ and [ ] moves between services · o opens this service's flame graph in Grafana")
}

// Key moves between services and opens the flame graph.
func (t *ProfilesTab) Key(k string) bool {
	t.toast = ""
	switch k {
	case "up", "k":
		t.cursor = maxInt(t.cursor-1, 0)
	case "down", "j":
		t.cursor = minInt(t.cursor+1, maxInt(len(t.services)-1, 0))
	case "]":
		t.moveService(1)
	case "[":
		t.moveService(-1)
	case "o":
		t.openInGrafana()
	default:
		return false
	}
	return true
}

// moveService cycles the services, wrapping - the same two keys, with the same
// wrap, as the log tab's application sub-tabs, because they are the same
// gesture: move sideways through this tab's own list.
func (t *ProfilesTab) moveService(delta int) {
	if len(t.services) == 0 {
		return
	}
	count := len(t.services)
	t.cursor = ((t.cursor+delta)%count + count) % count
}

// openInGrafana sends the selected service's flame graph to the browser.
func (t *ProfilesTab) openInGrafana() {
	if t.cursor >= len(t.services) || t.src.Profiles == nil || t.src.Open == nil {
		return
	}
	url := t.src.Profiles.GrafanaURL(t.services[t.cursor].Service)
	if err := t.src.Open(url); err != nil {
		t.toast = "could not open the browser: " + err.Error()
	}
}

// SubTabs is the services this tab moves between.
func (t *ProfilesTab) SubTabs() []string {
	out := make([]string, 0, len(t.services))
	for _, service := range t.services {
		out = append(out, service.Service)
	}
	return out
}

// SelectedSubTab is the service on screen.
func (t *ProfilesTab) SelectedSubTab() string { return t.Selected() }

// MoveSubTab cycles the services.
func (t *ProfilesTab) MoveSubTab(delta int) { t.moveService(delta) }

// Rows is every service's lists as plain data.
func (t *ProfilesTab) Rows() any { return t.services }

// Selected is the service the cursor sits on, for the tests.
func (t *ProfilesTab) Selected() string {
	if t.cursor >= len(t.services) {
		return ""
	}
	return t.services[t.cursor].Service
}
