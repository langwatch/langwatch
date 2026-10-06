package readmegen

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	startMarker = "<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->"
	startPrefix = "<!-- readme:generated:start"
	endMarker   = "<!-- readme:generated:end -->"
)

// table renders a Markdown table padded the way the formatter pads one, so a
// formatted page and a generated page are the same bytes.
func table(header []string, rows [][]string) string {
	widths := make([]int, len(header))
	measure := func(cells []string) {
		for index, cell := range cells {
			widths[index] = max(widths[index], utf8.RuneCountInString(cell), 3)
		}
	}
	measure(header)
	for _, row := range rows {
		measure(row)
	}
	var out strings.Builder
	line := func(cells []string) {
		out.WriteString("|")
		for index, cell := range cells {
			out.WriteString(" " + cell + strings.Repeat(" ", widths[index]-utf8.RuneCountInString(cell)) + " |")
		}
		out.WriteString("\n")
	}
	line(header)
	rule := make([]string, len(header))
	for index := range rule {
		rule[index] = strings.Repeat("-", widths[index])
	}
	line(rule)
	for _, row := range rows {
		line(row)
	}
	return out.String()
}

// cell escapes the one character a table cell cannot hold.
func cell(text string) string {
	return strings.ReplaceAll(text, "|", `\|`)
}

func code(text string) string {
	return "`" + text + "`"
}

func link(label, target string) string {
	return "[" + label + "](" + target + ")"
}

// orDash is the text, or an en dash for an empty cell.
func orDash(text string) string {
	if text == "" {
		return "–"
	}
	return text
}

// page is one README the generator owns the block of.
type page struct {
	Path  string // relative to the root, slash-separated
	Title string
	Body  string // the generated block's content, without the markers
}

// splice puts the page's block into the existing file, keeping everything
// outside the markers. A file without markers keeps its whole text above.
func splice(existing string, p page) string {
	head, tail := "# "+p.Title+"\n", ""
	if existing != "" {
		head = existing
		if start := strings.Index(existing, startPrefix); start >= 0 {
			head = existing[:start]
			if end := strings.Index(existing[start:], endMarker); end >= 0 {
				tail = existing[start+end+len(endMarker):]
			}
		}
	}
	head = strings.TrimRight(head, "\n") + "\n\n"
	tail = strings.TrimLeft(tail, "\n")
	if tail != "" {
		tail = "\n" + tail
	}
	return head + startMarker + "\n\n" + strings.TrimRight(p.Body, "\n") + "\n\n" + endMarker + "\n" + tail
}

// described reports whether the text above the block holds a paragraph: a
// line that is not the title, a heading, a comment or blank.
func described(content string) bool {
	head := content
	if start := strings.Index(content, startPrefix); start >= 0 {
		head = content[:start]
	}
	inComment := false
	for _, line := range strings.Split(head, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case inComment:
			inComment = !strings.Contains(trimmed, "-->")
		case strings.HasPrefix(trimmed, "<!--"):
			inComment = !strings.Contains(trimmed, "-->")
		case trimmed == "", strings.HasPrefix(trimmed, "#"):
		default:
			return true
		}
	}
	return false
}

type edit struct {
	op   byte
	text string
	i, j int
}

// unifiedDiff is a line diff of two texts with three lines of context.
func unifiedDiff(path, before, after string) string {
	edits := editScript(strings.Split(before, "\n"), strings.Split(after, "\n"))
	var changed []int
	for index, e := range edits {
		if e.op != ' ' {
			changed = append(changed, index)
		}
	}
	var out strings.Builder
	fmt.Fprintf(&out, "--- a/%s\n+++ b/%s\n", path, path)
	for first := 0; first < len(changed); {
		last := first
		for last+1 < len(changed) && changed[last+1]-changed[last] <= 7 {
			last++
		}
		writeHunk(&out, edits[max(0, changed[first]-3):min(len(edits), changed[last]+4)])
		first = last + 1
	}
	return out.String()
}

// editScript is the longest-common-subsequence edit from a to b.
func editScript(a, b []string) []edit {
	lcs := lcsTable(a, b)
	var edits []edit
	i, j := 0, 0
	for i < len(a) || j < len(b) {
		switch {
		case i < len(a) && j < len(b) && a[i] == b[j]:
			edits = append(edits, edit{' ', a[i], i, j})
			i, j = i+1, j+1
		case j < len(b) && (i == len(a) || lcs[i][j+1] >= lcs[i+1][j]):
			edits = append(edits, edit{'+', b[j], i, j})
			j++
		default:
			edits = append(edits, edit{'-', a[i], i, j})
			i++
		}
	}
	return edits
}

// lcsTable holds, at [i][j], the longest common subsequence of a[i:] and b[j:].
func lcsTable(a, b []string) [][]int {
	lcs := make([][]int, len(a)+1)
	for i := range lcs {
		lcs[i] = make([]int, len(b)+1)
	}
	for i := len(a) - 1; i >= 0; i-- {
		for j := len(b) - 1; j >= 0; j-- {
			lcs[i][j] = max(lcs[i+1][j], lcs[i][j+1])
			if a[i] == b[j] {
				lcs[i][j] = lcs[i+1][j+1] + 1
			}
		}
	}
	return lcs
}

func writeHunk(out *strings.Builder, hunk []edit) {
	oldCount, newCount := 0, 0
	for _, e := range hunk {
		if e.op != '+' {
			oldCount++
		}
		if e.op != '-' {
			newCount++
		}
	}
	fmt.Fprintf(out, "@@ -%d,%d +%d,%d @@\n", hunk[0].i+1, oldCount, hunk[0].j+1, newCount)
	for _, e := range hunk {
		out.WriteString(string(e.op) + e.text + "\n")
	}
}
