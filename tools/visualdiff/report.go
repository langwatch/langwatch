package visualdiff

import (
	"encoding/json"
	"fmt"
	"html"
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
	NotFound       bool     `json:"notFound"`
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

// Classification is the verdict on one row.
type Classification string

const (
	// ClassRegression is the candidate throwing, or failing a step, where the base does not.
	ClassRegression Classification = "regression"
	// ClassRestoreGap is the candidate calling an endpoint that answers 404 — a
	// screen that came back without the route behind it.
	ClassRestoreGap Classification = "restore-gap"
	// ClassIntendedRestore is the base having no such screen where the candidate renders one.
	ClassIntendedRestore Classification = "intended-restore"
	// ClassNoise is a small difference with nothing wrong on either side.
	ClassNoise Classification = "noise"
	// ClassChanged is a real visual difference that none of the rules explain.
	ClassChanged Classification = "changed"
)

// NoiseRatio is the diff ratio below which an error-free difference is noise.
const NoiseRatio = 0.02

// Row pairs one screen's two captures.
type Row struct {
	Kind      string         `json:"kind"`
	Key       string         `json:"key"`
	Index     int            `json:"index"`
	Label     string         `json:"label"`
	Base      *Capture       `json:"base"`
	Candidate *Capture       `json:"candidate"`
	Ratio     float64        `json:"ratio"`
	DiffFile  string         `json:"diffFile"`
	Class     Classification `json:"class"`
	Why       string         `json:"why"`
}

// Finding reports whether a row is something to look at. Noise is not.
func (row Row) Finding() bool {
	return row.Class == ClassRegression || row.Class == ClassRestoreGap
}

// apiNotFound reports whether any recorded failed request is a 404 on an API
// path — the signature of a screen restored without its endpoint.
func apiNotFound(entries []string) []string {
	var hits []string
	for _, entry := range entries {
		if strings.Contains(entry, "404") && strings.Contains(entry, "/api/") {
			hits = append(hits, entry)
		}
	}
	return hits
}

// onlyIn returns the entries present in candidate and absent from base,
// compared on their first 80 characters so a trailing id never reads as a new
// error.
func onlyIn(candidate, base []string) []string {
	seen := map[string]bool{}
	for _, entry := range base {
		seen[head(entry)] = true
	}
	var out []string
	for _, entry := range candidate {
		if !seen[head(entry)] {
			out = append(out, entry)
		}
	}
	return out
}

func head(value string) string {
	if len(value) > 80 {
		return value[:80]
	}
	return value
}

// Classify is the rule-based first pass. It is deliberately a first pass:
// every row keeps both screenshots so a person can overrule it, and anything
// the rules cannot explain lands in "changed" rather than being waved through
// as noise.
//
// The order matters. A candidate that throws is a regression even where the
// base had no screen at all, so the failure rules run before the
// restore rules, and the noise rule runs last so it can never swallow one.
func Classify(row Row) (Classification, string) {
	base, candidate := row.Base, row.Candidate
	if candidate == nil {
		return ClassRegression, "no capture on the candidate"
	}
	if base == nil {
		return ClassIntendedRestore, "no capture on the base"
	}
	if candidate.Error != "" && base.Error == "" {
		return ClassRegression, "candidate failed where the base did not: " + head(candidate.Error)
	}
	newErrors := onlyIn(candidate.ConsoleErrors, base.ConsoleErrors)
	if len(newErrors) > 0 {
		return ClassRegression, "candidate console error the base does not have: " + head(newErrors[0])
	}
	if hits := apiNotFound(onlyIn(candidate.FailedRequests, base.FailedRequests)); len(hits) > 0 {
		return ClassRestoreGap, "candidate calls an endpoint that answers 404: " + head(hits[0])
	}
	if base.NotFound && !candidate.NotFound {
		return ClassIntendedRestore, "the base has no such screen and the candidate renders one"
	}
	if row.Ratio < NoiseRatio {
		return ClassNoise, fmt.Sprintf("differs by %.2f%% with no errors on either side", row.Ratio*100)
	}
	return ClassChanged, fmt.Sprintf("differs by %.2f%%", row.Ratio*100)
}

// BuildRows pairs the captures by screen, attaches the runner's diffs and
// classifies every row. Rows sort worst-first: findings, then by diff ratio.
func BuildRows(captures []Capture, diffs []Diff) []Row {
	rows, order := pairCaptures(captures)
	for _, diff := range diffs {
		if row, ok := rows[rowKey{diff.Kind, diff.Key, diff.Index}]; ok {
			row.Ratio = diff.Ratio
			row.DiffFile = diff.File
		}
	}
	out := make([]Row, 0, len(order))
	for _, identity := range order {
		row := rows[identity]
		row.Class, row.Why = Classify(*row)
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
	return os.WriteFile(filepath.Join(dir, "report.html"), []byte(renderHTML(rows, meta)), 0o600)
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

func renderMarkdown(rows []Row, meta ReportMeta) string {
	var out strings.Builder
	fmt.Fprintf(&out, "# Visual diff — %s vs %s\n\n", meta.BaseRef, meta.CandidateRef)
	fmt.Fprintf(&out, "%d rows, %d findings, viewport %s.\n\n", len(rows), CountFindings(rows), meta.Viewport)
	fmt.Fprintf(&out, "| Class | Screen | Diff | Why |\n| --- | --- | --- | --- |\n")
	for index := range rows {
		row := &rows[index]
		if row.Class == ClassNoise {
			continue
		}
		fmt.Fprintf(&out, "| %s | %s | %.2f%% | %s |\n",
			row.Class, rowTitle(*row), row.Ratio*100, strings.ReplaceAll(row.Why, "|", "/"))
	}
	return out.String()
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
	case ClassRegression:
		return "#b42318"
	case ClassRestoreGap:
		return "#b54708"
	case ClassIntendedRestore:
		return "#175cd3"
	case ClassChanged:
		return "#344054"
	default:
		return "#667085"
	}
}

func renderHTML(rows []Row, meta ReportMeta) string {
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
		writeSideDetail(&out, "base", row.Base)
		writeSideDetail(&out, "candidate", row.Candidate)
		fmt.Fprint(&out, "<div class=\"shots\">")
		writeFigure(&out, "base", row.Base)
		writeFigure(&out, "candidate", row.Candidate)
		if row.DiffFile != "" {
			fmt.Fprintf(&out, "<figure><figcaption>diff</figcaption><img loading=\"lazy\" src=\"file://%s\"></figure>", html.EscapeString(row.DiffFile))
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

func writeFigure(out *strings.Builder, side string, capture *Capture) {
	if capture == nil || capture.Screenshot == "" {
		fmt.Fprintf(out, "<figure><figcaption>%s</figcaption></figure>", side)
		return
	}
	fmt.Fprintf(out, "<figure><figcaption>%s <span class=\"mono\">%s</span></figcaption><img loading=\"lazy\" src=\"file://%s\"></figure>",
		side, html.EscapeString(capture.URL), html.EscapeString(capture.Screenshot))
}
