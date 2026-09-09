package viewer

import "github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"

// MetricsTab is a fixed panel rather than a query box. A query box on a local
// dev screen is a promise the reader has to write PromQL to keep; the six
// questions anyone actually has about a local stack are known in advance, so
// they are asked the same way every time and the reader only has to look.

// MetricsTab is the metrics screen.
type MetricsTab struct {
	noHeader
	noAttention
	src    Sources
	series []sources.Series
	down   bool
}

// NewMetricsTab builds the metrics screen over Prometheus.
func NewMetricsTab(src Sources) *MetricsTab { return &MetricsTab{src: src} }

// Name is the tab's label and command name.
func (t *MetricsTab) Name() string { return "metrics" }

// Poll refreshes the panel. Nothing is asked when the stack is not listening.
func (t *MetricsTab) Poll() {
	if t.src.Metrics == nil {
		return
	}
	if t.down = !t.src.Metrics.Up(); t.down {
		return
	}
	if series, err := t.src.Metrics.Panel(); err == nil {
		t.series = series
	}
}

// labelWidth is the panel's label column; wide enough for the longest label so
// every value and sparkline starts at the same cell.
const labelWidth = 22

// Body renders one row per metric: a label, the current value, and the last ten
// minutes as a text sparkline.
func (t *MetricsTab) Body(f Frame) []Row {
	if t.down {
		return stackDownBody()
	}
	if len(t.series) == 0 {
		return emptyBody("metrics in the last ten minutes")
	}
	out := make([]string, 0, len(t.series))
	for _, series := range t.series {
		out = append(out, "  "+pad(series.Label, labelWidth)+
			pad(series.Value, 12)+"  "+dim(Sparkline(series.Samples)))
	}
	return lastNRows(indexedRows(out), f.Rows())
}

// Footer says what the panel covers.
func (t *MetricsTab) Footer() string {
	return dim("the last ten minutes, per application and per lane · this panel is fixed, there is nothing to type")
}

// Key takes nothing: the panel has no cursor and no filter.
func (t *MetricsTab) Key(string) bool { return false }

// Rows is the panel as plain data, in panel order.
func (t *MetricsTab) Rows() any { return t.series }
