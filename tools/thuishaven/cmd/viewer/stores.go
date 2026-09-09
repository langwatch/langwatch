package viewer

import (
	"fmt"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// StoresTab is each database server against the limit haven gave it. A limit
// without the number in front of it is trivia; the two together are the only
// warning anyone gets before a connection pool or a memory cap turns into a
// stack that is mysteriously slow.

// meterWidth is how wide a store's usage bar is drawn.
const meterWidth = 24

// StoresTab is the stores screen.
type StoresTab struct {
	src   Sources
	stats []sources.StoreStat
}

// NewStoresTab builds the stores screen over the managed servers.
func NewStoresTab(src Sources) *StoresTab { return &StoresTab{src: src} }

// Name is the tab's label and command name.
func (t *StoresTab) Name() string { return "stores" }

// Poll re-probes every managed server.
func (t *StoresTab) Poll() {
	if t.src.Stores == nil {
		return
	}
	if stats, err := t.src.Stores.Stats(); err == nil {
		t.stats = stats
	}
}

// Body renders one row per server: what is in use, against what limit, with a
// meter, and a mark once it is past nine tenths of that limit.
func (t *StoresTab) Body(f Frame) []string {
	if len(t.stats) == 0 {
		return emptyBody("managed database servers")
	}
	out := make([]string, 0, len(t.stats))
	for _, stat := range t.stats {
		out = append(out, "  "+pad(stat.Name, 12)+pad(stat.Measure, 13)+
			pad(usage(stat), 22)+Bar(stat.Fraction(), meterWidth)+mark(stat))
	}
	return lastN(out, f.Rows())
}

// usage spells "used of limit" in the store's own unit.
func usage(stat sources.StoreStat) string {
	if stat.Limit <= 0 {
		return sources.FormatValue(stat.Used, stat.Unit) + " / no limit"
	}
	return sources.FormatValue(stat.Used, stat.Unit) + " / " + sources.FormatValue(stat.Limit, stat.Unit)
}

// mark is the warning a store past its threshold carries.
func mark(stat sources.StoreStat) string {
	if !stat.Marked() {
		return ""
	}
	return " " + yellow(fmt.Sprintf("%.0f%% of the limit", stat.Fraction()*100))
}

// Footer says what the meters are measured against.
func (t *StoresTab) Footer() string {
	return dim("each server against the limit haven gave it · a value past ninety percent is marked")
}

// Key takes nothing: the panel has no cursor.
func (t *StoresTab) Key(string) bool { return false }

// Rows is the store panel as plain data.
func (t *StoresTab) Rows() any { return t.stats }
