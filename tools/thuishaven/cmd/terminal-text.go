package cmd

import (
	"strings"

	"github.com/charmbracelet/x/ansi"
)

// Child processes may emit cursor motion, tabs or carriage returns. Only
// colors may reach the renderer: every other cell belongs to the viewer.
func terminalText(text string) string {
	var out strings.Builder
	var state byte
	column := 0
	for len(text) > 0 {
		seq, width, n, next := ansi.DecodeSequence(text, state, nil)
		if n == 0 {
			break
		}
		text, state = text[n:], next
		switch {
		case seq == "\n":
			out.WriteByte('\n')
			column = 0
		case seq == "\t":
			spaces := 4 - column%4
			out.WriteString(strings.Repeat(" ", spaces))
			column += spaces
		case strings.HasPrefix(seq, "\x1b[") && strings.HasSuffix(seq, "m"):
			out.WriteString(seq)
		case width > 0:
			out.WriteString(seq)
			column += width
		}
	}
	return out.String()
}
