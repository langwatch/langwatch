package readmegen

import (
	"strings"
	"unicode/utf8"
)

// printWidth is the oxfmt line width; printed TypeScript is laid out to it so the pages stay formatted.
const printWidth = 100

// doc is a Wadler-style document: text, concat, group, indent, line and ifBreak.
type doc interface{}

type text string

type concat []doc

type group struct {
	body   doc
	broken bool
}

type indent struct{ body doc }

type ifBreak struct{ broken, flat doc }

type lineKind int

const (
	lineSpace lineKind = iota
	lineSoft
	lineHard
)

type line struct{ kind lineKind }

type command struct {
	indent int
	flat   bool
	body   doc
}

// markBreaks marks every group that holds a hard line, and reports whether body forces a break.
func markBreaks(body doc) bool {
	switch node := body.(type) {
	case line:
		return node.kind == lineHard
	case concat:
		forced := false
		for _, part := range node {
			forced = markBreaks(part) || forced
		}
		return forced
	case indent:
		return markBreaks(node.body)
	case ifBreak:
		return markBreaks(node.broken)
	case *group:
		node.broken = markBreaks(node.body) || node.broken
		return node.broken
	}
	return false
}

// layout prints body to the print width.
func layout(body doc) string {
	return render(body, printWidth)
}

// expand replaces a structural command with the commands it holds, in print order.
func expand(current command) ([]command, bool) {
	at := func(body doc) command { return command{current.indent, current.flat, body} }
	switch node := current.body.(type) {
	case concat:
		children := make([]command, 0, len(node))
		for _, part := range node {
			children = append(children, at(part))
		}
		return children, true
	case indent:
		return []command{{current.indent + 2, current.flat, node.body}}, true
	case ifBreak:
		if current.flat {
			return []command{at(node.flat)}, true
		}
		return []command{at(node.broken)}, true
	}
	return nil, false
}

func pushReversed(stack []command, children []command) []command {
	for index := len(children) - 1; index >= 0; index-- {
		stack = append(stack, children[index])
	}
	return stack
}

// printer holds the output and the column the next character lands in.
type printer struct {
	out      strings.Builder
	position int
}

func (pr *printer) text(value string) {
	pr.out.WriteString(value)
	pr.position += utf8.RuneCountInString(value)
}

func (pr *printer) line(current command, node line) {
	if current.flat && node.kind != lineHard {
		if node.kind == lineSpace {
			pr.text(" ")
		}
		return
	}
	trimmed := strings.TrimRight(pr.out.String(), " ")
	pr.out.Reset()
	pr.out.WriteString(trimmed + "\n" + strings.Repeat(" ", current.indent))
	pr.position = current.indent
}

func render(body doc, width int) string {
	markBreaks(body)
	pr := &printer{}
	stack := []command{{0, false, body}}
	for len(stack) > 0 {
		current := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if children, ok := expand(current); ok {
			stack = pushReversed(stack, children)
			continue
		}
		switch node := current.body.(type) {
		case text:
			pr.text(string(node))
		case *group:
			flat := current.flat || (!node.broken && fits(width-pr.position, command{current.indent, true, node.body}, stack))
			stack = append(stack, command{current.indent, flat, node.body})
		case line:
			pr.line(current, node)
		}
	}
	return pr.out.String()
}

// fits reports whether next, then the rest up to the first line break, fits in the room left.
func fits(room int, next command, rest []command) bool {
	pending := []command{next}
	restIndex := len(rest)
	for room >= 0 {
		if len(pending) == 0 {
			if restIndex == 0 {
				return true
			}
			restIndex--
			pending = append(pending, rest[restIndex])
			continue
		}
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if children, ok := expand(current); ok {
			pending = pushReversed(pending, children)
			continue
		}
		var done bool
		room, done = fitsOne(room, current, &pending)
		if done {
			return true
		}
	}
	return false
}

// fitsOne measures one leaf; done is true at the first line that breaks.
func fitsOne(room int, current command, pending *[]command) (int, bool) {
	switch node := current.body.(type) {
	case text:
		return room - utf8.RuneCountInString(string(node)), false
	case *group:
		*pending = append(*pending, command{current.indent, current.flat && !node.broken, node.body})
	case line:
		if !current.flat || node.kind == lineHard {
			return room, true
		}
		if node.kind == lineSpace {
			return room - 1, false
		}
	}
	return room, false
}
