package viewer

import (
	"strings"

	"github.com/charmbracelet/x/ansi"
)

// SelectedLine paints the complete selection in either a light or dark terminal.
func SelectedLine(text string, width int) string {
	if width > 0 {
		text = ansi.Truncate(text, width, "…")
	}
	text += strings.Repeat(" ", max(0, width-ansi.StringWidth(text)))
	return sgrReverse + strings.ReplaceAll(text, sgrReset, sgrReset+sgrReverse) + sgrReset
}

// detailPanel scrolls wrapped content from its beginning, independently of live logs.
type detailPanel struct {
	lines                 []string
	offset, height, total int
}

func (p *detailPanel) body(f Frame) []Row {
	var wrapped []string
	width := max(1, f.Width-2)
	for _, line := range p.lines {
		for _, physical := range strings.Split(line, "\n") {
			wrapped = append(wrapped, strings.Split(ansi.Hardwrap(physical, width, true), "\n")...)
		}
	}
	p.height, p.total = f.Rows(), len(wrapped)
	p.offset = min(max(0, p.offset), max(0, len(wrapped)-p.height))
	return textRows(wrapped[p.offset:min(len(wrapped), p.offset+p.height)])
}

func (p *detailPanel) key(k string) bool {
	switch k {
	case "up", "k", "wheelup":
		p.offset -= wheelOrLine(k)
	case "down", "j", "wheeldown":
		p.offset += wheelOrLine(k)
	case "pgup", "b":
		p.offset -= p.height
	case "pgdown", " ":
		p.offset += p.height
	case "home", "g":
		p.offset = 0
	case "end", "G":
		p.offset = max(0, p.total-p.height)
	default:
		return false
	}
	p.offset = min(max(0, p.offset), max(0, p.total-p.height))
	return true
}

func (p *detailPanel) footer() string {
	return "↑↓ Scroll · space/b Page · esc Back  " + dim(itoa(min(p.offset+1, p.total))+"–"+itoa(min(p.offset+p.height, p.total))+" of "+itoa(p.total))
}
