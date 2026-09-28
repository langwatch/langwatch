package visualdiff

import (
	"encoding/json"
	"fmt"
	"html"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Capture is one screen photographed on one side. The runner emits one of
// these per route and per flow step, as a JSON line.
type Capture struct {
	Kind           string   `json:"kind"` // "route" or "flow"
	Key            string   `json:"key"`  // the route path, or the flow id
	Index          int      `json:"index"`
	Label          string   `json:"label"`
	Side           string   `json:"side"` // "base" or "candidate"
	URL            string   `json:"url"`
	Screenshot     string   `json:"screenshot"`
	ConsoleErrors  []string `json:"consoleErrors"`
	FailedRequests []string `json:"failedRequests"`
	// ModuleFailures are the page's own modules that failed to load: the
	// dev server's failure under load, never the screen's (ClassCaptureFailed).
	ModuleFailures []string `json:"moduleFailures,omitempty"`
	NotFound       bool     `json:"notFound"`
	Blank          bool     `json:"blank"`
	AriaSnapshot   string   `json:"ariaSnapshot,omitempty"`
	Error          string   `json:"error"`
	DurationMS     int      `json:"durationMs"`
}

// Diff is one pixel comparison, computed by the runner (which already holds
// both PNGs) and reported back on its own JSON line.
type Diff struct {
	Kind  string  `json:"kind"`
	Key   string  `json:"key"`
	Index int     `json:"index"`
	Ratio float64 `json:"ratio"`
	File  string  `json:"file"`
}

// BuildRows pairs the captures by screen, attaches the runner's diffs and
// classifies every row. Rows sort worst-first: findings, then by diff ratio.
func BuildRows(captures []Capture, diffs []Diff) []Row {
	rows, order := pairCaptures(captures)
	for _, diff := range diffs {
		if row, ok := rows[rowKey{diff.Kind, diff.Key, diff.Index}]; ok {
			row.Ratio, row.Diffed, row.DiffFile = diff.Ratio, true, diff.File
		}
	}
	out := make([]Row, 0, len(order))
	for _, identity := range order {
		row := rows[identity]
		row.Class, row.Why = Classify(*row)
		if row.Base != nil && row.Candidate != nil {
			row.Text = CompareText(row.Base.AriaSnapshot, row.Candidate.AriaSnapshot)
		}
		out = append(out, *row)
	}
	sort.SliceStable(out, func(a, b int) bool {
		if out[a].Finding() != out[b].Finding() {
			return out[a].Finding()
		}
		return out[a].Ratio > out[b].Ratio
	})
	return out
}

// rowKey identifies one screen across both sides.
type rowKey struct {
	kind  string
	name  string
	index int
}

// pairCaptures groups both sides' captures by screen, keeping the order the
// runner reported them in.
func pairCaptures(captures []Capture) (map[rowKey]*Row, []rowKey) {
	order := []rowKey{}
	rows := map[rowKey]*Row{}
	for index := range captures {
		capture := captures[index]
		identity := rowKey{capture.Kind, capture.Key, capture.Index}
		row, seen := rows[identity]
		if !seen {
			row = &Row{Kind: capture.Kind, Key: capture.Key, Index: capture.Index, Label: capture.Label}
			rows[identity] = row
			order = append(order, identity)
		}
		if row.Label == "" {
			row.Label = capture.Label
		}
		if capture.Side == "base" {
			row.Base = &capture
			continue
		}
		row.Candidate = &capture
	}
	return rows, order
}

// ReportMeta names the run in the report's header.
type ReportMeta struct {
	BaseRef      string `json:"baseRef"`
	CandidateRef string `json:"candidateRef"`
	BaseURL      string `json:"baseUrl"`
	CandidateURL string `json:"candidateUrl"`
	Viewport     string `json:"viewport"`
	StartedAt    string `json:"startedAt"`
}

// WriteReport writes the three artifacts: the HTML page a person reads, the
// findings.md a review quotes, and the findings.json another tool consumes.
func WriteReport(dir string, rows []Row, meta ReportMeta) error {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return err
	}
	document := struct {
		Meta ReportMeta `json:"meta"`
		Rows []Row      `json:"rows"`
	}{meta, rows}
	encoded, err := json.MarshalIndent(document, "", " ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "findings.json"), encoded, 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "findings.md"), []byte(renderMarkdown(rows, meta)), 0o600); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "report.html"), []byte(renderHTML(dir, rows, meta)), 0o600)
}

// CountFindings counts the rows worth a person's attention.
func CountFindings(rows []Row) int {
	count := 0
	for index := range rows {
		if rows[index].Finding() {
			count++
		}
	}
	return count
}

func rowTitle(row Row) string {
	if row.Kind == "route" {
		return row.Key
	}
	return fmt.Sprintf("%s · %d %s", row.Key, row.Index, row.Label)
}

// renderMarkdown lists the findings only, one line each with its text
// evidence; every other row is in findings.json and report.html.
func renderMarkdown(rows []Row, meta ReportMeta) string {
	var out strings.Builder
	fmt.Fprintf(&out, "# Visual diff — %s vs %s\n\n", meta.BaseRef, meta.CandidateRef)
	fmt.Fprintf(&out, "%d rows, %d findings, viewport %s.\n\n", len(rows), CountFindings(rows), meta.Viewport)
	if CountFindings(rows) == 0 {
		return out.String()
	}
	fmt.Fprintf(&out, "| Class | Screen | Why | Evidence |\n| --- | --- | --- | --- |\n")
	for index := range rows {
		row := &rows[index]
		if !row.Finding() {
			continue
		}
		fmt.Fprintf(&out, "| %s | %s | %s | %s |\n",
			row.Class, rowTitle(*row), markdownCell(row.Why), markdownCell(RowEvidence(*row)))
	}
	return out.String()
}

func markdownCell(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(value, "|", "/"), "\n", " ")
}

// RowEvidence is a row's text evidence on one line: where the candidate
// ended, its new failed API calls and its role diff.
func RowEvidence(row Row) string {
	if row.Candidate == nil {
		return ""
	}
	parts := []string{"url " + finalPath(row.Candidate.URL)}
	var baseFailures []string
	if row.Base != nil {
		baseFailures = row.Base.FailedRequests
	}
	for _, request := range NewAPIFailures(baseFailures, row.Candidate.FailedRequests) {
		parts = append(parts, "req "+head(request))
	}
	if summary := row.Text.Summary(); summary != "" {
		parts = append(parts, "controls "+summary)
	}
	return strings.Join(parts, " · ")
}

const reportStyle = `body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:24px;color:#101828;background:#fff}
h1{margin:0 0 4px}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#667085}
.row{border:1px solid #eaecf0;border-radius:8px;padding:10px;margin:10px 0}
.row.finding{border-color:#fda29b;background:#fffbfa}
.pill{color:#fff;border-radius:10px;padding:1px 8px;font-size:12px}
.shots{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px}
figure{margin:0}figcaption{font-size:12px;color:#667085;margin-bottom:4px}
img{width:100%;border:1px solid #eaecf0;border-radius:4px}
.err{color:#b42318;font-size:12px;font-family:ui-monospace,monospace}
.net{color:#b54708;font-size:12px;font-family:ui-monospace,monospace}`

func classColour(class Classification) string {
	switch class {
	case ClassRegression, ClassMissingCandidate, ClassBrokenBoth, ClassBlank, ClassNotFound, ClassCaptureFailed:
		return "#b42318"
	case ClassAPIError, ClassRedirect, ClassControls, ClassMissingBase:
		return "#b54708"
	case ClassIntendedRestore:
		return "#175cd3"
	case ClassChanged:
		return "#344054"
	default:
		return "#667085"
	}
}

func renderHTML(dir string, rows []Row, meta ReportMeta) string {
	var out strings.Builder
	fmt.Fprintf(&out, "<!doctype html><meta charset=\"utf-8\"><title>Visual diff — %s vs %s</title>\n<style>%s</style>\n",
		html.EscapeString(meta.BaseRef), html.EscapeString(meta.CandidateRef), reportStyle)
	fmt.Fprintf(&out, "<h1>Visual diff</h1>\n<p class=\"mono\">base %s (%s) vs candidate %s (%s) — %s, started %s — %d rows, %d findings</p>\n",
		html.EscapeString(meta.BaseRef), html.EscapeString(meta.BaseURL),
		html.EscapeString(meta.CandidateRef), html.EscapeString(meta.CandidateURL),
		html.EscapeString(meta.Viewport), html.EscapeString(meta.StartedAt), len(rows), CountFindings(rows))
	for index := range rows {
		row := &rows[index]
		class := ""
		if row.Finding() {
			class = " finding"
		}
		fmt.Fprintf(&out, "<div class=\"row%s\"><b>%s</b> <span class=\"pill\" style=\"background:%s\">%s</span> <span class=\"mono\">%.2f%% — %s</span>\n",
			class, html.EscapeString(rowTitle(*row)), classColour(row.Class), row.Class, row.Ratio*100, html.EscapeString(row.Why))
		if evidence := RowEvidence(*row); evidence != "" {
			fmt.Fprintf(&out, "<div class=\"mono\">%s</div>", html.EscapeString(evidence))
		}
		writeSideDetail(&out, "base", row.Base)
		writeSideDetail(&out, "candidate", row.Candidate)
		fmt.Fprint(&out, "<div class=\"shots\">")
		writeFigure(&out, figure{dir: dir, side: "base", capture: row.Base})
		writeFigure(&out, figure{dir: dir, side: "candidate", capture: row.Candidate})
		if row.DiffFile != "" {
			fmt.Fprintf(&out, "<figure><figcaption>diff</figcaption><img loading=\"lazy\" src=\"%s\"></figure>", html.EscapeString(ImageSource(dir, row.DiffFile)))
		}
		fmt.Fprint(&out, "</div></div>\n")
	}
	return out.String()
}

func writeSideDetail(out *strings.Builder, side string, capture *Capture) {
	if capture == nil {
		fmt.Fprintf(out, "<div class=\"err\">%s: no capture</div>", side)
		return
	}
	if capture.Error != "" {
		fmt.Fprintf(out, "<div class=\"err\">%s error: %s</div>", side, html.EscapeString(capture.Error))
	}
	for _, entry := range capture.ConsoleErrors {
		fmt.Fprintf(out, "<div class=\"err\">%s console: %s</div>", side, html.EscapeString(entry))
	}
	for _, entry := range capture.FailedRequests {
		fmt.Fprintf(out, "<div class=\"net\">%s network: %s</div>", side, html.EscapeString(entry))
	}
}

// figure is one side's screenshot, placed relative to the report's directory.
type figure struct {
	dir     string
	side    string
	capture *Capture
}

func writeFigure(out *strings.Builder, one figure) {
	capture := one.capture
	if capture == nil || capture.Screenshot == "" {
		fmt.Fprintf(out, "<figure><figcaption>%s</figcaption></figure>", one.side)
		return
	}
	fmt.Fprintf(out, "<figure><figcaption>%s <span class=\"mono\">%s</span></figcaption><img loading=\"lazy\" src=\"%s\"></figure>",
		one.side, html.EscapeString(capture.URL), html.EscapeString(ImageSource(one.dir, capture.Screenshot)))
}

// ImageSource is an image's address relative to the report's directory, so
// a report opened from a downloaded CI artifact still shows its screenshots.
// A path that cannot be made relative keeps its file:// address.
func ImageSource(dir, path string) string {
	relative, err := filepath.Rel(dir, path)
	if err != nil || !filepath.IsAbs(path) {
		return "file://" + path
	}
	return (&url.URL{Path: filepath.ToSlash(relative)}).String()
}
