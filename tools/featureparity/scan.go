package featureparity

import (
	"regexp"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// jsSpace is the set JavaScript's \s and String.prototype.trim use; Go's \s is
// ASCII-only and unicode.IsSpace differs (it adds U+0085 and drops U+FEFF).
const jsSpace = `[\t\n\x{0B}\f\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]`

// jsRegexp compiles a pattern written with JavaScript's \s.
func jsRegexp(pattern string) *regexp.Regexp {
	return regexp.MustCompile(strings.ReplaceAll(pattern, `\s`, jsSpace))
}

func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', 0x0B, '\f', '\r', ' ', 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}

func jsTrim(s string) string { return strings.TrimFunc(s, isJSSpace) }

// Scenario is one scenario read from a feature file: title, tags and line.
type Scenario struct {
	Title string
	Tags  []string
	Line  int
}

// BindingRef is where a binding annotation sits in a test file.
type BindingRef struct {
	File string
	Line int
}

// Binding is a test's claim to prove the scenario with Title.
type Binding struct {
	Title string
	Ref   BindingRef
}

var (
	scenarioLine    = jsRegexp(`^Scenario(?:\s+Outline)?:\s*([^\n\r\x{2028}\x{2029}]+)$`)
	gherkinBodyHead = []string{"Given", "When", "Then", "And", "But", "|"}
)

// ParseFeature reads the scenarios of one .feature source, with feature-level
// tags applied to every scenario.
func ParseFeature(raw string) []Scenario {
	parser := &featureParser{}
	for i, line := range strings.Split(raw, "\n") {
		parser.line(i+1, jsTrim(line))
	}
	return parser.scenarios
}

// featureParser carries the tags seen so far through a feature file's lines.
type featureParser struct {
	scenarios                []Scenario
	featureTags, pendingTags []string
	featureSeen              bool
}

// line reads one trimmed line, numbered from 1.
func (p *featureParser) line(number int, trimmed string) {
	if strings.HasPrefix(trimmed, "#") || trimmed == "" {
		return
	}
	if strings.HasPrefix(trimmed, "@") {
		p.pendingTags = append(p.pendingTags, tagsOf(trimmed)...)
		return
	}
	if !p.featureSeen && strings.HasPrefix(trimmed, "Feature:") {
		p.featureTags, p.pendingTags, p.featureSeen = p.pendingTags, nil, true
		return
	}
	if m := scenarioLine.FindStringSubmatch(trimmed); m != nil {
		tags := append(append([]string{}, p.featureTags...), p.pendingTags...)
		p.scenarios = append(p.scenarios, Scenario{Title: jsTrim(m[1]), Tags: tags, Line: number})
		p.pendingTags = nil
		return
	}
	if !isGherkinBody(trimmed) {
		p.pendingTags = nil
	}
}

// tagsOf is the @tags on a tag line.
func tagsOf(trimmed string) []string {
	var tags []string
	for _, t := range strings.FieldsFunc(trimmed, isJSSpace) {
		if strings.HasPrefix(t, "@") {
			tags = append(tags, t)
		}
	}
	return tags
}

// isGherkinBody reports a line that opens a step, a table or a doc string.
func isGherkinBody(trimmed string) bool {
	for _, p := range gherkinBodyHead {
		if strings.HasPrefix(trimmed, p) {
			return true
		}
	}
	return false
}

// annotationRE is the Node tool's ANNOTATION_RE run at one JavaScript line start;
// the last group stands in for JS multiline `$`, which also stops before \r and
// U+2028/U+2029, and is given back when it consumed a terminator.
var annotationRE = regexp.MustCompile(`^[ \t]*(?:(?://|/\*|\*|#)[ \t]*)*@scenario[ \t]+(?:"([^"\n]+)"|'([^'\n]+)'|([^\n*]+?))[ \t]*(\*/|[\n\r\x{2028}\x{2029}]|\z)`)

var markedAnnotation = regexp.MustCompile(`^[ \t]*(?://|/\*|\*|#)`)

// Annotation is one `@scenario` token: Index is where its line starts, End is
// just past the match.
type Annotation struct {
	Title      string
	Index, End int
}

// lineStartBefore is the JavaScript multiline `^` position at or before at.
func lineStartBefore(src string, at int) int {
	for i := at - 1; i >= 0; i-- {
		switch src[i] {
		case '\n', '\r':
			return i + 1
		case 0xA8, 0xA9: // last byte of U+2028 / U+2029
			if i >= 2 && src[i-2] == 0xE2 && src[i-1] == 0x80 {
				return i + 1
			}
		}
	}
	return 0
}

// FindScenarioAnnotations is the Node tool's findScenarioAnnotations.
func FindScenarioAnnotations(src string) []Annotation {
	scan := &annotationScan{src: src}
	var found []Annotation
	lastIndex, lastTried := 0, -1
	for from := 0; ; {
		k := strings.Index(src[from:], "@scenario")
		if k < 0 {
			return found
		}
		occ := from + k
		from = occ + 1
		s := lineStartBefore(src, occ)
		if s < lastIndex || s == lastTried {
			continue
		}
		lastTried = s
		annotation, matched := scan.at(s)
		if !matched {
			continue
		}
		lastIndex = annotation.End
		if scan.counts(annotation) {
			found = append(found, annotation)
		}
	}
}

// annotationScan is one source's annotation search, with its markerless
// binding spans computed once, on first need.
type annotationScan struct {
	src       string
	spans     [][2]int
	spansDone bool
}

// at matches an annotation starting at line start s, title and all.
func (scan *annotationScan) at(s int) (Annotation, bool) {
	src := scan.src
	m := annotationRE.FindStringSubmatchIndex(src[s:])
	if m == nil {
		return Annotation{}, false
	}
	end := m[1]
	if term := src[s+m[8] : s+m[9]]; term != "*/" {
		end -= len(term)
	}
	return Annotation{Title: annotationTitle(src[s:], m), Index: s, End: s + end}, true
}

// annotationTitle is the first title group the match filled, trimmed.
func annotationTitle(rest string, m []int) string {
	for g := 1; g <= 3; g++ {
		if m[2*g] >= 0 {
			return jsTrim(rest[m[2*g]:m[2*g+1]])
		}
	}
	return ""
}

// counts reports an annotation with a title that is marked, or that sits
// inside a markerless binding.
func (scan *annotationScan) counts(annotation Annotation) bool {
	if annotation.Title == "" {
		return false
	}
	whole := scan.src[annotation.Index:annotation.End]
	if markedAnnotation.MatchString(whole) {
		return true
	}
	return scan.inMarkerlessSpan(annotation.Index + strings.Index(whole, "@scenario"))
}

// inMarkerlessSpan reports an offset inside a markerless binding span.
func (scan *annotationScan) inMarkerlessSpan(at int) bool {
	if !scan.spansDone {
		scan.spans, scan.spansDone = markerlessBindingSpans(scan.src), true
	}
	for _, sp := range scan.spans {
		if at >= sp[0] && at < sp[1] {
			return true
		}
	}
	return false
}

func spanEnd(src string, from int, closer string) int {
	if at := strings.Index(src[from:], closer); at >= 0 {
		return from + at + len(closer)
	}
	return len(src)
}

// markerlessBindingSpans are the block comments and triple-quoted strings a
// marker-less annotation may live in.
func markerlessBindingSpans(src string) [][2]int {
	var spans [][2]int
	for i := 0; i < len(src); {
		end := -1
		switch {
		case strings.HasPrefix(src[i:], "/*"):
			end = spanEnd(src, i+2, "*/")
		case strings.HasPrefix(src[i:], `"""`):
			end = spanEnd(src, i+3, `"""`)
		case strings.HasPrefix(src[i:], "'''"):
			end = spanEnd(src, i+3, "'''")
		}
		if end < 0 {
			i++
			continue
		}
		spans = append(spans, [2]int{i, end})
		i = end
	}
	return spans
}

func isSourceSpace(c byte) bool { return c == ' ' || c == '\t' || c == '\n' || c == '\r' }

func at(src string, i int) byte {
	if i < len(src) {
		return src[i]
	}
	return 0
}

func indexFrom(src string, from int, sub string) int {
	if from > len(src) {
		return -1
	}
	if k := strings.Index(src[from:], sub); k >= 0 {
		return from + k
	}
	return -1
}

func pastTSComment(src string, i int) int {
	ch, next := at(src, i), at(src, i+1)
	if ch == '*' && next == '/' {
		return i + 2
	}
	if ch == '*' || (ch == '/' && next == '/') {
		return pastToken(src, i, "\n")
	}
	if ch == '/' && next == '*' {
		return pastToken(src, i+2, "*/")
	}
	return i
}

// pastToken is the index just past the first token at or after from, or -1.
func pastToken(src string, from int, token string) int {
	if at := indexFrom(src, from, token); at >= 0 {
		return at + len(token)
	}
	return -1
}

var testCallRE = jsRegexp(`^(?:(?:void|await)\s+)?(?:it|test|tester\.run)(?:\.[a-zA-Z]+)?(?:<[^>\n]+>)?\s*\(`)

// IsFollowedByTestCall is the TS proximity check: a test call follows start.
func IsFollowedByTestCall(src string, start int) bool {
	for i := start; i < len(src); {
		if isSourceSpace(src[i]) {
			i++
			continue
		}
		next := pastTSComment(src, i)
		if next == -1 {
			return false
		}
		if next != i {
			i = next
			continue
		}
		return testCallRE.MatchString(src[i:])
	}
	return false
}

var (
	goTestFuncRE      = jsRegexp(`^func\s+Test[A-Za-z0-9_]*\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s+\*testing\.T\s*\)`)
	goSubtestHeadRE   = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*\.Run\(`)
	goSubtestClosure  = jsRegexp(`^func\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s+\*testing\.T\s*\)\s*\{`)
	goSubtestScanUnit = 4096 // UTF-16 code units, as the Node tool counts them
)

func skipGoSpaceAndComments(src string, start, limit int) int {
	for i := start; i < limit; {
		if isSourceSpace(src[i]) {
			i++
			continue
		}
		next := pastGoComment(src, i, limit)
		if next == i || next == -1 {
			return next
		}
		i = next
	}
	return -1
}

func pastGoComment(src string, i, limit int) int {
	if at(src, i) != '/' {
		return i
	}
	switch at(src, i+1) {
	case '*':
		c := indexFrom(src, i+2, "*/")
		if c == -1 || c+2 > limit {
			return -1
		}
		return c + 2
	case '/':
		nl := indexFrom(src, i, "\n")
		if nl == -1 || nl+1 > limit {
			return -1
		}
		return nl + 1
	}
	return i
}

func pastGoQuotedLiteral(rest string, start, limit int) int {
	quote := rest[start]
	for i := start + 1; i < limit; {
		c := rest[i]
		if c == '\\' {
			i += 2
			continue
		}
		if c == '\n' {
			return -1
		}
		i++
		if c == quote {
			return i
		}
	}
	return -1
}

func pastGoOpaque(rest string, i, limit int) int {
	ch := rest[i]
	if ch == '"' || ch == '\'' {
		return pastGoQuotedLiteral(rest, i, limit)
	}
	if ch == '`' {
		c := indexFrom(rest, i+1, "`")
		if c == -1 || c >= limit {
			return -1
		}
		return c + 1
	}
	if ch == '/' && (at(rest, i+1) == '/' || at(rest, i+1) == '*') {
		return skipGoSpaceAndComments(rest, i, limit)
	}
	return i
}

func topLevelCommaAt(rest string, start, limit int) int {
	depth := 0
	for i := start; i < limit; {
		next := pastGoOpaque(rest, i, limit)
		if next == -1 {
			return -1
		}
		if next != i {
			i = next
			continue
		}
		if stop, comma := bracketStep(rest[i], &depth); stop {
			if comma {
				return i
			}
			return -1
		}
		i++
	}
	return -1
}

// bracketStep tracks depth over one byte. It stops at a top-level comma
// (comma true) or at a closer with nothing open (comma false).
func bracketStep(ch byte, depth *int) (stop, comma bool) {
	switch ch {
	case '(', '[', '{':
		*depth++
	case ')', ']', '}':
		if *depth == 0 {
			return true, false
		}
		*depth--
	case ',':
		return *depth == 0, true
	}
	return false, false
}

// byteOffsetAfterUnits advances n UTF-16 code units from byte offset from.
func byteOffsetAfterUnits(s string, from, n int) int {
	i := from
	for n > 0 && i < len(s) {
		r, size := utf8.DecodeRuneInString(s[i:])
		i += size
		n -= len(utf16.Encode([]rune{r}))
	}
	return i
}

func isGoSubtestDeclaration(rest string) bool {
	head := goSubtestHeadRE.FindStringIndex(rest)
	if head == nil {
		return false
	}
	limit := byteOffsetAfterUnits(rest, head[1], goSubtestScanUnit)
	comma := topLevelCommaAt(rest, head[1], limit)
	if comma == -1 {
		return false
	}
	closure := skipGoSpaceAndComments(rest, comma+1, limit)
	if closure == -1 {
		return false
	}
	return goSubtestClosure.MatchString(rest[closure:])
}

// IsFollowedByGoTestFunc is the Go proximity check: `func TestX(t *testing.T)`
// or a `x.Run(name, func(t *testing.T) {` subtest follows start.
func IsFollowedByGoTestFunc(src string, start int) bool {
	i := skipGoSpaceAndComments(src, start, len(src))
	if i == -1 {
		return false
	}
	rest := src[i:]
	return goTestFuncRE.MatchString(rest) || isGoSubtestDeclaration(rest)
}

func pastBalancedParens(src string, open int) int {
	depth, j := 1, open+1
	for j < len(src) && depth > 0 {
		switch src[j] {
		case '(':
			depth++
		case ')':
			depth--
		}
		j++
	}
	return j
}

func pastPythonDecorator(src string, i int) int {
	j := i + 1
	for j < len(src) && src[j] != '\n' && src[j] != '(' {
		j++
	}
	if j < len(src) && src[j] == '(' {
		j = pastBalancedParens(src, j)
	}
	for j < len(src) && src[j] != '\n' {
		j++
	}
	return j + 1
}

var pythonTestFuncRE = jsRegexp(`^(?:async\s+)?def\s+test_[A-Za-z0-9_]*\s*\(`)

func isFollowedByPythonTestFunc(src string, start int) bool {
	for i := start; i < len(src); {
		switch ch := src[i]; {
		case isSourceSpace(ch):
			i++
		case ch == '#':
			nl := indexFrom(src, i, "\n")
			if nl == -1 {
				return false
			}
			i = nl + 1
		case ch == '@':
			i = pastPythonDecorator(src, i)
		default:
			return pythonTestFuncRE.MatchString(src[i:])
		}
	}
	return false
}

// hashAnnotationRE is BATS_ANNOTATION_RE, which the Python hash form shares.
var hashAnnotationRE = regexp.MustCompile(`^[ \t]*#[ \t]*@scenario[ \t]+(?:"([^"\r\n]+)"|'([^'\r\n]+)')[ \t\r]*$`)

func hashTitle(line string) string {
	m := hashAnnotationRE.FindStringSubmatch(line)
	if m == nil {
		return ""
	}
	if m[1] != "" {
		return jsTrim(m[1])
	}
	return jsTrim(m[2])
}

var (
	batsTestLineRE  = regexp.MustCompile(`^@test\b`)
	shellTestLineRE = regexp.MustCompile(`^test_[A-Za-z0-9_]*[ \t]*\([ \t]*\)[ \t]*\{`)
)

func nextCodeLineMatches(re *regexp.Regexp) func([]string, int) bool {
	return func(lines []string, from int) bool {
		for _, line := range lines[min(from, len(lines)):] {
			trimmed := jsTrim(line)
			if trimmed == "" || strings.HasPrefix(trimmed, "#") {
				continue
			}
			return re.MatchString(trimmed)
		}
		return false
	}
}

func lineOf(src string, index int) int { return strings.Count(src[:index], "\n") + 1 }

// blockBindings are the ANNOTATION_RE bindings a proximity check accepts.
func blockBindings(file, src string, follows func(string, int) bool) []Binding {
	var out []Binding
	for _, a := range FindScenarioAnnotations(src) {
		if follows(src, a.End) {
			out = append(out, Binding{Title: a.Title, Ref: BindingRef{File: file, Line: lineOf(src, a.Index)}})
		}
	}
	return out
}

// hashBindings are the `# @scenario "..."` bindings whose next code line runs.
func hashBindings(file, src string, isTestLine func([]string, int) bool) []Binding {
	var out []Binding
	lines := strings.Split(src, "\n")
	for i, line := range lines {
		if title := hashTitle(line); title != "" && isTestLine(lines, i+1) {
			out = append(out, Binding{Title: title, Ref: BindingRef{File: file, Line: i + 1}})
		}
	}
	return out
}

// pythonBindings are the block form followed by the hash form, as in Node.
func pythonBindings(file, src string) []Binding {
	out := blockBindings(file, src, isFollowedByPythonTestFunc)
	offset := 0
	for i, line := range strings.Split(src, "\n") {
		offset += len(line) + 1
		title := hashTitle(line)
		if title == "" || !isFollowedByPythonTestFunc(src, offset) {
			continue
		}
		out = append(out, Binding{Title: title, Ref: BindingRef{File: file, Line: i + 1}})
	}
	return out
}
