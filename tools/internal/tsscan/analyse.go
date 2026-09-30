package tsscan

import (
	"runtime"
	"slices"
	"strings"
)

// Import is one module specifier the file names, as the TS enforcer's
// moduleImports records it: every import and export-from declaration, every
// `import x = require()`, and every `import()`/`require()` call.
type Import struct {
	Line       int
	Specifier  string
	NonLiteral bool
	TypeOnly   bool
	Dynamic    bool
}

// Reference is one top-level import or export-from declaration and the names
// it takes from its module: the source name, never the local alias. Every is
// set for a namespace import, `export *` and `export * as`.
type Reference struct {
	Specifier string
	Names     []string
	Every     bool
}

// File is what a scan reads out of one source file.
type File struct {
	Imports    []Import
	References []Reference
	// Exports are the names the file's top-level statements publish, in order.
	Exports    []string
	RendersJSX bool
}

// tokenBuffers reuses token slices between files: the token stream is the
// scan's largest allocation and never outlives it.
// tokenBuffers is a free list, not a sync.Pool, which a GC empties: under a
// parallel scan that happens often enough for files to regrow their buffers.
var tokenBuffers = make(chan []Token, runtime.GOMAXPROCS(0))

// NonLiteralSpecifier is what a computed specifier is recorded as.
const NonLiteralSpecifier = "<non-literal module specifier>"

type analyser struct {
	src       string
	toks      []Token
	lineAt    int32
	lineCount int
	consumed  map[int]bool
	file      File
}

// Scan reads one file. jsx is TypeScript's script-kind rule: .tsx, .jsx, .js.
func Scan(src string, jsx bool) *File {
	var buffer []Token
	select {
	case buffer = <-tokenBuffers:
	default:
	}
	toks, rendersJSX := tokensInto(buffer, src, jsx)
	a := &analyser{src: src, toks: toks}
	a.file.RendersJSX = rendersJSX
	a.run()
	select {
	case tokenBuffers <- toks[:0]:
	default:
	}
	a.file.Exports = dedupe(a.file.Exports)
	a.file.detach()
	return &a.file
}

func dedupe(names []string) []string {
	seen := map[string]bool{}
	out := names[:0]
	for _, name := range names {
		if !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	return out
}

// detach clones every string, which points into the scanned source, so a
// cached File does not pin the file's text.
func (f *File) detach() {
	for i := range f.Imports {
		f.Imports[i].Specifier = strings.Clone(f.Imports[i].Specifier)
	}
	for i := range f.References {
		f.References[i].Specifier = strings.Clone(f.References[i].Specifier)
		cloneAll(f.References[i].Names)
	}
	cloneAll(f.Exports)
}

func cloneAll(names []string) {
	for i, name := range names {
		names[i] = strings.Clone(name)
	}
}

// JSXFor reports whether TypeScript parses a file of this name with JSX.
func JSXFor(path string) bool {
	return strings.HasSuffix(path, ".tsx") || strings.HasSuffix(path, ".jsx") || strings.HasSuffix(path, ".js")
}

// line is the 1-based line of offset. Records arrive in source order, so it
// counts forward from the previous answer rather than indexing the file.
func (a *analyser) line(offset int32) int {
	if offset < a.lineAt {
		a.lineAt, a.lineCount = 0, 0
	}
	a.lineCount += strings.Count(a.src[a.lineAt:offset], "\n")
	a.lineAt = offset
	return a.lineCount + 1
}

func (a *analyser) tok(i int) Token {
	if i < 0 || i >= len(a.toks) {
		return Token{Kind: Punct, Text: "<eof>"}
	}
	return a.toks[i]
}

func (a *analyser) is(i int, kind Kind, text string) bool {
	t := a.tok(i)
	return t.Kind == kind && t.Text == text && i < len(a.toks)
}

func (a *analyser) punct(i int, text string) bool { return a.is(i, Punct, text) }
func (a *analyser) ident(i int, text string) bool { return a.is(i, Ident, text) }
func (a *analyser) isIdent(i int) bool            { return a.tok(i).Kind == Ident }
func (a *analyser) isString(i int) bool           { return a.tok(i).Kind == String }

func (a *analyser) memberAccess(i int) bool { return a.punct(i-1, ".") || a.punct(i-1, "?.") }

// separatorAt reports whether token k is a `,` at depth.
func (a *analyser) separatorAt(k int, depth int32) bool {
	t := a.toks[k]
	return t.Kind == Punct && t.Text == "," && t.Depth == depth
}

// closer is the index of the bracket closing the one at i.
func (a *analyser) closer(i int) int {
	depth := a.toks[i].Depth
	for j := i + 1; j < len(a.toks); j++ {
		if t := a.toks[j]; t.Depth == depth && t.Kind == Punct && closes[t.Text] {
			return j
		}
	}
	return len(a.toks)
}

func (a *analyser) run() {
	for i, t := range a.toks {
		if t.Kind == Ident && !a.memberAccess(i) {
			a.keyword(i, t.Text)
		}
	}
}

func (a *analyser) keyword(i int, text string) {
	switch text {
	case "import":
		if a.punct(i+1, "(") {
			a.dynamic(i)
		} else if !a.punct(i+1, ".") && !a.punct(i-1, "@") {
			a.importDeclaration(i)
		}
	case "require":
		if a.punct(i+1, "(") && !a.consumed[i] && !a.method(i) {
			a.dynamic(i)
		}
	case "export":
		a.exportDeclaration(i)
	}
}

var methodModifiers = map[string]bool{
	"function": true, "async": true, "static": true, "public": true, "private": true,
	"protected": true, "get": true, "set": true, "override": true,
}

// method reports whether `require(` at i declares a function or method rather than calling one.
func (a *analyser) method(i int) bool {
	if prev := a.tok(i - 1); prev.Kind == Ident && methodModifiers[prev.Text] {
		return true
	}
	return a.punct(a.closer(i+1)+1, "{")
}

// importType reports whether `import(...)` at i, closed at closeAt, is a type:
// `typeof import("x")` or `import("x").T`, which TypeScript does not read as calls.
func (a *analyser) importType(i, closeAt int) bool {
	if a.ident(i-1, "typeof") {
		return true
	}
	return a.punct(closeAt+1, ".") && a.isIdent(closeAt+2) && !a.punct(closeAt+3, "(")
}

// dynamic records an `import(...)` or `require(...)` call.
func (a *analyser) dynamic(i int) {
	closeAt := a.closer(i + 1)
	if a.toks[i].Text == "import" && a.importType(i, closeAt) {
		return
	}
	arg := a.tok(i + 2)
	literal := i+2 < closeAt && arg.Kind == String && (i+3 == closeAt || a.punct(i+3, ","))
	record := Import{Line: a.line(a.toks[i].Start), Specifier: NonLiteralSpecifier, NonLiteral: true, Dynamic: true}
	if literal {
		record.Specifier, record.NonLiteral = arg.Text, false
	}
	a.file.Imports = append(a.file.Imports, record)
}

// element splits one `{ ... }` specifier into the name taken from the module
// and the name it is bound or exported under.
func element(parts []Token) (taken, bound string, ok bool) {
	typeModifier := len(parts) > 1 && parts[0].Kind == Ident && parts[0].Text == "type"
	typeIsTheName := len(parts) == 3 && parts[1].Text == "as"
	if typeModifier && !typeIsTheName {
		parts = parts[1:]
	}
	if len(parts) == 0 {
		return "", "", false
	}
	return parts[0].Text, parts[len(parts)-1].Text, true
}

// clauseElements reads `{ a, b as c }` from its `{` at i.
func (a *analyser) clauseElements(i int) (elements [][]Token, end int) {
	end = a.closer(i)
	var current []Token
	for j := i + 1; j < end; j++ {
		if a.separatorAt(j, a.toks[i].Depth+1) {
			elements = append(elements, current)
			current = nil
			continue
		}
		current = append(current, a.toks[j])
	}
	if len(current) > 0 {
		elements = append(elements, current)
	}
	return elements, end + 1
}

// origin is where a module statement sits and whether it is type-only.
type origin struct{ typeOnly, topLevel bool }

// from records the `from "x"` at j for ref, when there is one.
func (a *analyser) from(j int, ref Reference, o origin) {
	if !a.ident(j, "from") || !a.isString(j+1) {
		return
	}
	spec := a.toks[j+1]
	ref.Specifier = spec.Text
	a.file.Imports = append(a.file.Imports, Import{Line: a.line(spec.Start), Specifier: spec.Text, TypeOnly: o.typeOnly})
	if o.topLevel {
		a.file.References = append(a.file.References, ref)
	}
}

// typeModifier reports whether `type` at j makes an import type-only rather
// than naming a default import called `type`.
func (a *analyser) typeModifier(j int) bool {
	if !a.ident(j, "type") || a.punct(j+1, ",") || a.punct(j+1, "=") {
		return false
	}
	return !a.ident(j+1, "from") || !a.isString(j+2)
}

func (a *analyser) importDeclaration(i int) {
	o := origin{topLevel: a.toks[i].Depth == 0}
	j := i + 1
	if a.typeModifier(j) {
		o.typeOnly = true
		j++
	}
	switch {
	case a.isString(j):
		a.sideEffect(j, o)
	case a.isIdent(j) && a.punct(j+1, "="):
		a.importEquals(j+2, o.typeOnly)
	default:
		ref, next := a.importClause(j)
		a.from(next, ref, o)
	}
}

// sideEffect records `import "x"`, which takes no names.
func (a *analyser) sideEffect(j int, o origin) {
	a.file.Imports = append(a.file.Imports, Import{Line: a.line(a.toks[j].Start), Specifier: a.toks[j].Text, TypeOnly: o.typeOnly})
	if o.topLevel {
		a.file.References = append(a.file.References, Reference{Specifier: a.toks[j].Text})
	}
}

// importClause reads the names an import takes, from j to its `from`.
func (a *analyser) importClause(j int) (Reference, int) {
	ref := Reference{}
	if a.defaultImport(j) {
		ref.Names = append(ref.Names, "default")
		j++
		if a.punct(j, ",") {
			j++
		}
	}
	switch {
	case a.punct(j, "*"):
		ref.Every = true
		j += 3
	case a.punct(j, "{"):
		elements, end := a.clauseElements(j)
		for _, parts := range elements {
			if taken, _, ok := element(parts); ok {
				ref.Names = append(ref.Names, taken)
			}
		}
		j = end
	}
	return ref, j
}

// defaultImport reports whether j names a default import, one bound to the name `from` included.
func (a *analyser) defaultImport(j int) bool {
	if a.ident(j, "from") {
		return a.ident(j+1, "from")
	}
	return a.isIdent(j)
}

// importEquals reads `= require("x")` from the token after `=`.
func (a *analyser) importEquals(j int, typeOnly bool) {
	if !a.ident(j, "require") || !a.punct(j+1, "(") {
		return
	}
	if a.consumed == nil {
		a.consumed = map[int]bool{}
	}
	a.consumed[j] = true
	record := Import{Line: a.line(a.toks[j].Start), Specifier: NonLiteralSpecifier, NonLiteral: true, TypeOnly: typeOnly}
	if arg := a.tok(j + 2); arg.Kind == String {
		record.Specifier, record.NonLiteral = arg.Text, false
	}
	a.file.Imports = append(a.file.Imports, record)
}

func (a *analyser) publish(topLevel bool, names ...string) {
	if topLevel {
		a.file.Exports = append(a.file.Exports, names...)
	}
}

func (a *analyser) exportDeclaration(i int) {
	top := a.toks[i].Depth == 0
	j := i + 1
	if a.exportWithoutClause(j, top) {
		return
	}
	o := origin{topLevel: top}
	if a.ident(j, "type") && (a.punct(j+1, "{") || a.punct(j+1, "*")) {
		o.typeOnly = true
		j++
	}
	if a.exportClause(j, o) {
		return
	}
	for a.ident(j, "declare") || a.ident(j, "abstract") || a.ident(j, "async") {
		j++
	}
	if top {
		a.publish(true, a.declaredNames(j)...)
	}
}

// exportWithoutClause handles `export default`, `export =`, `export as
// namespace` and `export import`; it reports whether j began one.
func (a *analyser) exportWithoutClause(j int, top bool) bool {
	switch {
	case a.ident(j, "default"):
		a.publish(top, a.defaultExport(j+1)...)
	case a.punct(j, "="), a.ident(j, "as"):
	case a.ident(j, "import"):
		if a.isIdent(j+1) && a.punct(j+2, "=") {
			a.importEquals(j+3, false)
		}
	default:
		return false
	}
	return true
}

// exportClause handles `export *` and `export { ... }`; it reports whether j began one.
func (a *analyser) exportClause(j int, o origin) bool {
	switch {
	case a.punct(j, "*"):
		if a.ident(j+1, "as") {
			j += 2
		}
		a.from(j+1, Reference{Every: true}, o)
	case a.punct(j, "{"):
		elements, end := a.clauseElements(j)
		ref := Reference{}
		var names []string
		for _, parts := range elements {
			if taken, bound, ok := element(parts); ok {
				ref.Names = append(ref.Names, taken)
				names = append(names, bound)
			}
		}
		a.from(end, ref, o)
		a.publish(o.topLevel, names...)
	default:
		return false
	}
	return true
}

// functionName is the name of `function [*] name` at j.
func (a *analyser) functionName(j int) []string {
	if a.punct(j+1, "*") {
		j++
	}
	if a.isIdent(j + 1) {
		return []string{a.toks[j+1].Text}
	}
	return nil
}

// className is the name of `class name` at j; `class extends` has none.
func (a *analyser) className(j int) []string {
	if n := a.tok(j + 1); n.Kind == Ident && n.Text != "extends" && n.Text != "implements" {
		return []string{n.Text}
	}
	return nil
}

// nextName is the identifier after j.
func (a *analyser) nextName(j int) []string {
	if a.isIdent(j + 1) {
		return []string{a.toks[j+1].Text}
	}
	return nil
}

// defaultExport is what `export default` publishes, from the token after it.
func (a *analyser) defaultExport(j int) []string {
	for a.ident(j, "async") || a.ident(j, "abstract") {
		j++
	}
	switch {
	case a.ident(j, "function"):
		return a.functionName(j)
	case a.ident(j, "class"):
		return a.className(j)
	case a.ident(j, "interface") && a.isIdent(j+1):
		return a.nextName(j)
	}
	return []string{"default"}
}

func (a *analyser) declaredNames(j int) []string {
	if !a.isIdent(j) {
		return nil
	}
	switch a.toks[j].Text {
	case "function":
		return a.functionName(j)
	case "class":
		return a.className(j)
	case "interface", "type", "enum", "namespace", "module":
		return a.nextName(j)
	case "global":
		return []string{"global"}
	case "const":
		if a.ident(j+1, "enum") {
			return a.nextName(j + 1)
		}
		return a.declarators(j + 1)
	case "let", "var", "using":
		return a.declarators(j + 1)
	}
	return nil
}

var statementStarts = map[string]bool{
	"export": true, "import": true, "const": true, "let": true, "var": true, "function": true,
	"class": true, "interface": true, "enum": true, "declare": true, "namespace": true,
	"abstract": true, "if": true, "for": true, "while": true, "return": true, "throw": true,
}

// declarators reads the names a variable statement binds, from its first binding.
func (a *analyser) declarators(j int) []string {
	depth := a.tok(j).Depth
	var names []string
	for j >= 0 && j < len(a.toks) {
		bound, after := a.binding(j)
		names = append(names, bound...)
		j = a.nextDeclarator(after, depth)
	}
	return names
}

var angleSteps = map[string]int{"<": 1, ">": -1, ">>": -2, ">>>": -3}

// nextDeclarator is the index of the declarator after the one ending at
// after, or -1 when the statement ends first. Commas inside `<...>` type
// arguments do not separate declarators.
func (a *analyser) nextDeclarator(after int, depth int32) int {
	angle := 0
	for k := after; k < len(a.toks); k++ {
		t := a.toks[k]
		if t.Depth < depth || (t.Depth == depth && a.statementEnds(k, after)) {
			return -1
		}
		if t.Depth == depth && t.Kind == Punct && a.separatesDeclarators(k, &angle) {
			return k + 1
		}
	}
	return -1
}

// separatesDeclarators reads the punctuator at k, keeping the `<...>` depth.
func (a *analyser) separatesDeclarators(k int, angle *int) bool {
	text := a.toks[k].Text
	if step, ok := angleSteps[text]; ok {
		*angle = max(0, *angle+step)
	}
	if text == "=" {
		*angle = 0
	}
	return text == "," && *angle == 0 && a.startsDeclarator(k+1)
}

// statementEnds reports whether token k, at the declaration's depth, ends it:
// a `;`, or a statement keyword on a new line.
func (a *analyser) statementEnds(k, after int) bool {
	t := a.toks[k]
	if t.Kind == Punct && t.Text == ";" {
		return true
	}
	return t.NewLine && k > after && t.Kind == Ident && statementStarts[t.Text]
}

var declaratorFollowers = []string{"=", ":", ",", ";", "!"}

func (a *analyser) startsDeclarator(k int) bool {
	t := a.tok(k)
	if t.Kind == Punct {
		return t.Text == "{" || t.Text == "["
	}
	if t.Kind != Ident {
		return false
	}
	after := a.tok(k + 1)
	if k+1 >= len(a.toks) || after.NewLine {
		return true
	}
	return after.Kind == Punct && slices.Contains(declaratorFollowers, after.Text)
}

// pattern is a destructuring pattern being read: its inner depth and kind.
type pattern struct {
	depth  int32
	object bool
}

// binding reads the names one binding (identifier or pattern) at j binds.
func (a *analyser) binding(j int) (names []string, after int) {
	t := a.tok(j)
	if t.Kind == Ident {
		return []string{t.Text}, j + 1
	}
	if t.Kind != Punct || (t.Text != "{" && t.Text != "[") {
		return nil, j + 1
	}
	end := a.closer(j)
	p := pattern{depth: t.Depth + 1, object: t.Text == "{"}
	start := j + 1
	for k := j + 1; k <= end; k++ {
		if k < end && !a.separatorAt(k, p.depth) {
			continue
		}
		if k > start {
			names = append(names, a.patternElement(start, k, p)...)
		}
		start = k + 1
	}
	return names, end + 1
}

func (a *analyser) patternElement(start, end int, p pattern) []string {
	if a.punct(start, "...") {
		names, _ := a.binding(start + 1)
		return names
	}
	if !p.object {
		names, _ := a.binding(start)
		return names
	}
	for k := start; k < end; k++ {
		if t := a.toks[k]; t.Depth == p.depth && t.Kind == Punct && t.Text == ":" {
			names, _ := a.binding(k + 1)
			return names
		}
	}
	return a.nextName(start - 1)
}
