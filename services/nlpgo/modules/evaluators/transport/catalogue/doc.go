package catalogue

import (
	"bytes"
	"slices"
	"strings"
	"unicode/utf8"
)

// doc is a Wadler-style layout document, the subset of prettier's doc
// algebra that oxfmt used to lay out evaluators.generated.ts.
type doc struct {
	kind          docKind
	text          string
	parts         []*doc
	contents      *doc
	states        []*doc // a conditional group's layouts, most compact first
	broken        bool   // a group that must break
	soft, hard    bool   // a line's flavor
	literal       bool   // a hard line that keeps no indentation
	breakContents *doc
	flatContents  *doc
	object        *jsObject // the object literal a group lays out, if any
}

type docKind int

const (
	docText docKind = iota
	docConcat
	docGroup
	docIndent
	docLine
	docIfBreak
	docBreakParent
)

func text(s string) *doc { return &doc{kind: docText, text: s} }

func concat(parts ...*doc) *doc { return &doc{kind: docConcat, parts: parts} }

func group(contents *doc, broken bool) *doc {
	return &doc{kind: docGroup, contents: contents, broken: broken}
}

func conditionalGroup(states ...*doc) *doc {
	return &doc{kind: docGroup, contents: states[0], states: states}
}

func indent(contents *doc) *doc { return &doc{kind: docIndent, contents: contents} }

func ifBreak(breakContents, flatContents *doc) *doc {
	return &doc{kind: docIfBreak, breakContents: breakContents, flatContents: flatContents}
}

var (
	line        = &doc{kind: docLine}
	softline    = &doc{kind: docLine, soft: true}
	breakParent = &doc{kind: docBreakParent}
	hardline    = concat(&doc{kind: docLine, hard: true}, breakParent)
	literalline = concat(&doc{kind: docLine, hard: true, literal: true}, breakParent)
)

func join(separator *doc, docs []*doc) *doc {
	parts := make([]*doc, 0, 2*len(docs))
	for i, d := range docs {
		if i > 0 {
			parts = append(parts, separator)
		}
		parts = append(parts, d)
	}
	return concat(parts...)
}

// children are d's direct parts; a conditional group's are its most
// compact layout only.
func children(d *doc) []*doc {
	switch d.kind {
	case docConcat:
		return d.parts
	case docGroup, docIndent:
		return []*doc{d.contents}
	case docIfBreak:
		var branches []*doc
		for _, branch := range []*doc{d.breakContents, d.flatContents} {
			if branch != nil {
				branches = append(branches, branch)
			}
		}
		return branches
	case docText, docLine, docBreakParent:
		return nil
	}
	return nil
}

// willBreak is prettier's: does d hold a forced break outside a
// conditional group's alternatives?
func willBreak(d *doc) bool {
	if d.kind == docBreakParent || d.hard || d.broken {
		return true
	}
	return slices.ContainsFunc(children(d), willBreak)
}

// propagateBreaks marks every group holding a forced break as broken,
// stopping at conditional groups, as prettier's propagateBreaks does.
func propagateBreaks(root *doc) {
	propagation := breakPropagation{visited: map[*doc]bool{}}
	propagation.walk(root)
}

type breakPropagation struct {
	visited map[*doc]bool
	groups  []*doc
}

func (b *breakPropagation) walk(d *doc) {
	switch d.kind {
	case docBreakParent:
		b.breakEnclosing()
	case docGroup:
		b.walkGroup(d)
	case docText, docLine, docConcat, docIndent, docIfBreak:
		for _, child := range children(d) {
			b.walk(child)
		}
	}
}

func (b *breakPropagation) walkGroup(d *doc) {
	b.groups = append(b.groups, d)
	if !b.visited[d] {
		b.visited[d] = true
		alternatives := d.states
		if alternatives == nil {
			alternatives = []*doc{d.contents}
		}
		for _, alternative := range alternatives {
			b.walk(alternative)
		}
	}
	b.groups = b.groups[:len(b.groups)-1]
	if d.broken {
		b.breakEnclosing()
	}
}

func (b *breakPropagation) breakEnclosing() {
	if n := len(b.groups); n > 0 && b.groups[n-1].states == nil {
		b.groups[n-1].broken = true
	}
}

type command struct {
	indent int
	flat   bool
	doc    *doc
}

// expand is what a concat, indent or ifBreak command stands for, in the
// order to push them.
func expand(c command) []command {
	d := c.doc
	switch d.kind {
	case docConcat:
		commands := make([]command, len(d.parts))
		for i, part := range d.parts {
			commands[len(d.parts)-1-i] = command{c.indent, c.flat, part}
		}
		return commands
	case docIndent:
		return []command{{c.indent + 2, c.flat, d.contents}}
	case docIfBreak:
		if branch := pick(c.flat, d); branch != nil {
			return []command{{c.indent, c.flat, branch}}
		}
	case docText, docLine, docGroup, docBreakParent:
	}
	return nil
}

// layout prints root within width, prettier's printDocToString. Each object
// literal it breaks is reported to brokeObject.
func layout(root *doc, width int, brokeObject func(*jsObject)) string {
	propagateBreaks(root)
	printer := layoutPrinter{width: width, brokeObject: brokeObject, commands: []command{{doc: root}}}
	for len(printer.commands) > 0 {
		c := printer.commands[len(printer.commands)-1]
		printer.commands = printer.commands[:len(printer.commands)-1]
		printer.step(c)
	}
	return string(printer.out)
}

type layoutPrinter struct {
	width       int
	brokeObject func(*jsObject)
	commands    []command
	out         []byte
	pos         int
	remeasure   bool
}

func (p *layoutPrinter) step(c command) {
	switch c.doc.kind {
	case docText:
		p.out = append(p.out, c.doc.text...)
		p.pos += utf8.RuneCountInString(c.doc.text)
	case docLine:
		p.line(c)
	case docGroup:
		p.group(c)
	case docConcat, docIndent, docIfBreak:
		p.commands = append(p.commands, expand(c)...)
	case docBreakParent:
	}
}

func (p *layoutPrinter) line(c command) {
	if c.flat && !c.doc.hard {
		if !c.doc.soft {
			p.out = append(p.out, ' ')
			p.pos++
		}
		return
	}
	if c.flat {
		p.remeasure = true
	}
	if c.doc.literal {
		p.out = append(p.out, '\n')
		p.pos = 0
		return
	}
	p.out = append(bytes.TrimRight(p.out, " \t"), '\n')
	p.out = append(p.out, strings.Repeat(" ", c.indent)...)
	p.pos = c.indent
}

func (p *layoutPrinter) group(c command) {
	d := c.doc
	if c.flat && !p.remeasure {
		if d.broken {
			p.breakGroup(c)
		} else {
			p.commands = append(p.commands, command{c.indent, true, d.contents})
		}
		return
	}
	p.remeasure = false
	if next := (command{c.indent, true, d.contents}); !d.broken && fits(next, p.commands, p.width-p.pos) {
		p.commands = append(p.commands, next)
		return
	}
	if d.states == nil {
		p.breakGroup(c)
		return
	}
	p.commands = append(p.commands, p.chooseState(c))
}

// chooseState is a conditional group's first alternative that fits flat,
// else its last one broken.
func (p *layoutPrinter) chooseState(c command) command {
	d := c.doc
	if !d.broken {
		for _, state := range d.states[1:] {
			if candidate := (command{c.indent, true, state}); fits(candidate, p.commands, p.width-p.pos) {
				return candidate
			}
		}
	}
	return command{c.indent, false, d.states[len(d.states)-1]}
}

func (p *layoutPrinter) breakGroup(c command) {
	if c.doc.object != nil {
		p.brokeObject(c.doc.object)
	}
	p.commands = append(p.commands, command{c.indent, false, c.doc.contents})
}

// fits is prettier's: does next, then the rest up to its first line break,
// fit in width columns?
func fits(next command, rest []command, width int) bool {
	restIndex := len(rest)
	stack := []command{next}
	for width >= 0 {
		if len(stack) == 0 {
			if restIndex == 0 {
				return true
			}
			restIndex--
			stack = append(stack, rest[restIndex])
			continue
		}
		c := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		used, lineBreak, inner := measure(c)
		if lineBreak {
			return true
		}
		width -= used
		stack = append(stack, inner...)
	}
	return false
}

// measure is one command's step of fits: the columns it takes, whether it
// ends the line, and what it stands for.
func measure(c command) (used int, lineBreak bool, inner []command) {
	d := c.doc
	switch d.kind {
	case docText:
		return utf8.RuneCountInString(d.text), false, nil
	case docLine:
		used, lineBreak = measureLine(c)
		return used, lineBreak, nil
	case docGroup:
		flat := c.flat && !d.broken
		contents := d.contents
		if d.states != nil && !flat {
			contents = d.states[len(d.states)-1]
		}
		return 0, false, []command{{c.indent, flat, contents}}
	case docConcat, docIndent, docIfBreak:
		return 0, false, expand(c)
	case docBreakParent:
	}
	return 0, false, nil
}

// measureLine is a line's columns in fits: a space, nothing, or the end.
func measureLine(c command) (used int, lineBreak bool) {
	switch {
	case !c.flat || c.doc.hard:
		return 0, true
	case c.doc.soft:
		return 0, false
	default:
		return 1, false
	}
}

func pick(flat bool, d *doc) *doc {
	if flat {
		return d.flatContents
	}
	return d.breakContents
}
