// Package tsscan tokenises TypeScript and JavaScript well enough to read a
// file's module statements: strings, template nesting, regex against divide,
// comments and JSX are skipped exactly, so an import spelled inside any of
// them is never read as one. It is not a parser; see analyse.go for what it
// reads out of the token stream.
package tsscan

import (
	"strings"
)

// Kind is what a token is.
type Kind uint8

// The token kinds.
const (
	Ident Kind = iota
	String
	// Template is a template literal with substitutions; a no-substitution
	// template is a String, as TypeScript's isStringLiteralLike reads it.
	Template
	Number
	Regex
	Punct
)

// Token is one significant token. Depth counts the brackets, template
// substitutions and JSX expression containers it sits inside.
type Token struct {
	Kind    Kind
	Start   int32
	End     int32
	Depth   int32
	NewLine bool // a line break precedes it
	Text    string
}

type scanner struct {
	src     string
	pos     int
	depth   int32
	jsx     bool
	tokens  []Token
	sawJSX  bool
	newLine bool
}

func isIdentStart(c byte) bool {
	return c == '_' || c == '$' || c >= 0x80 || (c|0x20 >= 'a' && c|0x20 <= 'z')
}

func isIdentPart(c byte) bool { return isIdentStart(c) || (c >= '0' && c <= '9') }

// regexAfter lists the keywords after which `/` starts a regex and `<` may start JSX.
var regexAfter = map[string]bool{
	"return": true, "typeof": true, "case": true, "do": true, "else": true, "in": true,
	"instanceof": true, "new": true, "delete": true, "void": true, "throw": true,
	"yield": true, "await": true, "of": true, "extends": true,
}

// at is the byte at i, or 0 past the end.
func (s *scanner) at(i int) byte {
	if i < 0 || i >= len(s.src) {
		return 0
	}
	return s.src[i]
}

func (s *scanner) done() bool { return s.pos >= len(s.src) }

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func isBlank(c byte) bool { return c == ' ' || c == '\t' || c == '\n' || c == '\r' }

// expressionStart reports whether the previous token leaves the scanner where
// an expression may begin.
func (s *scanner) expressionStart() bool {
	if len(s.tokens) == 0 {
		return true
	}
	last := s.tokens[len(s.tokens)-1]
	switch last.Kind {
	case Ident:
		return regexAfter[last.Text]
	case Punct:
		return !closesExpression[last.Text]
	default:
		return false
	}
}

var closesExpression = map[string]bool{")": true, "]": true, "}": true, "++": true, "--": true}

func (s *scanner) emit(kind Kind, start int, text string) {
	s.tokens = append(s.tokens, Token{Kind: kind, Start: int32(start), End: int32(s.pos), Depth: s.depth, NewLine: s.newLine, Text: text})
	s.newLine = false
}

// skipTrivia advances over whitespace and comments.
func (s *scanner) skipTrivia() {
	for !s.done() {
		c := s.src[s.pos]
		switch {
		case c == '\n':
			s.newLine = true
			s.pos++
		case c == ' ' || c == '\t' || c == '\r' || c == '\f' || c == '\v':
			s.pos++
		case c == '/' && (s.at(s.pos+1) == '/' || s.at(s.pos+1) == '*'):
			s.skipComment()
		case !s.skipUnicodeSpace():
			return
		}
	}
}

func (s *scanner) skipComment() {
	rest := s.src[s.pos:]
	if rest[1] == '/' {
		end := strings.IndexByte(rest, '\n')
		if end < 0 {
			end = len(rest)
		}
		s.pos += end
		return
	}
	end := strings.Index(rest[2:], "*/")
	if end < 0 {
		s.pos = len(s.src)
		return
	}
	if strings.IndexByte(rest[:2+end], '\n') >= 0 {
		s.newLine = true
	}
	s.pos += end + 4
}

// unicodeSpaces are the non-ASCII trivia TypeScript skips, with whether each breaks a line.
var unicodeSpaces = []struct {
	text    string
	newLine bool
}{{"\xe2\x80\xa8", true}, {"\xe2\x80\xa9", true}, {"\xef\xbb\xbf", false}, {"\xc2\xa0", false}}

func (s *scanner) skipUnicodeSpace() bool {
	for _, space := range unicodeSpaces {
		if strings.HasPrefix(s.src[s.pos:], space.text) {
			s.pos += len(space.text)
			s.newLine = s.newLine || space.newLine
			return true
		}
	}
	return false
}

var puncts = []string{
	">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
	"=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=",
	"/=", "%=", "&=", "|=", "^=", "**", "<<", ">>",
}

// punctsByFirst indexes puncts by their first byte, longest first.
var punctsByFirst = func() (index [256][]string) {
	for _, p := range puncts {
		index[p[0]] = append(index[p[0]], p)
	}
	return index
}()

// scanCode reads tokens until the end, or, when inBrace, until the `}` that
// closes the brace the caller already consumed.
func (s *scanner) scanCode(inBrace bool) {
	local := 0
	for {
		s.skipTrivia()
		if s.done() || s.token(inBrace, &local) {
			return
		}
	}
}

// token reads one token at pos; it reports true on the `}` closing inBrace.
func (s *scanner) token(inBrace bool, local *int) bool {
	start, c := s.pos, s.src[s.pos]
	switch {
	case c == '#' && start == 0 && strings.HasPrefix(s.src, "#!"):
		s.skipLine()
	case isIdentStart(c) || (c == '#' && isIdentStart(s.at(start+1))):
		s.scanWord(start)
	case isDigit(c) || (c == '.' && isDigit(s.at(start+1))):
		s.scanNumber(start)
	case c == '"' || c == '\'':
		s.emit(String, start, s.readString(c))
	case c == '`':
		s.scanTemplate(start)
	case c == '/' && s.expressionStart():
		s.readRegex()
		s.emit(Regex, start, "")
	case c == '<' && s.jsx && s.expressionStart() && s.jsxAhead():
		s.sawJSX = true
		s.emit(Punct, start, "<jsx>")
		s.scanJSXElement()
	default:
		return s.scanPunct(start, inBrace, local)
	}
	return false
}

func (s *scanner) skipLine() {
	end := strings.IndexByte(s.src, '\n')
	if end < 0 {
		end = len(s.src)
	}
	s.pos = end
}

func (s *scanner) scanWord(start int) {
	s.pos++
	for isIdentPart(s.at(s.pos)) {
		s.pos++
	}
	s.emit(Ident, start, s.src[start:s.pos])
}

func (s *scanner) scanNumber(start int) {
	hex := strings.HasPrefix(s.src[start:], "0x") || strings.HasPrefix(s.src[start:], "0X")
	s.pos++
	for !s.done() {
		d := s.src[s.pos]
		exponentSign := (d == '+' || d == '-') && s.src[s.pos-1]|0x20 == 'e' && !hex
		if !isIdentPart(d) && d != '.' && !exponentSign {
			break
		}
		s.pos++
	}
	s.emit(Number, start, "")
}

var opens = map[string]bool{"{": true, "(": true, "[": true}

var closes = map[string]bool{"}": true, ")": true, "]": true}

// scanPunct reads a punctuator, keeping depth; it reports true on the `}` closing inBrace.
func (s *scanner) scanPunct(start int, inBrace bool, local *int) bool {
	text := s.src[s.pos : s.pos+1]
	for _, p := range punctsByFirst[s.src[s.pos]] {
		if strings.HasPrefix(s.src[s.pos:], p) {
			text = p
			break
		}
	}
	if text == "}" && inBrace && *local == 0 {
		s.pos++
		return true
	}
	if text == "}" {
		*local--
	}
	if closes[text] {
		s.depth--
	}
	s.pos += len(text)
	s.emit(Punct, start, text)
	if text == "{" {
		*local++
	}
	if opens[text] {
		s.depth++
	}
	return false
}

// readString consumes a quoted string and returns its cooked value.
func (s *scanner) readString(quote byte) string {
	s.pos++
	if end := strings.IndexAny(s.src[s.pos:], string(quote)+"\\\n"); end >= 0 && s.src[s.pos+end] == quote {
		text := s.src[s.pos : s.pos+end]
		s.pos += end + 1
		return text
	}
	var sb strings.Builder
	for !s.done() {
		c := s.src[s.pos]
		switch {
		case c == quote:
			s.pos++
			return sb.String()
		case c == '\n':
			return sb.String()
		case c == '\\' && s.pos+1 < len(s.src):
			s.pos++
			s.cookEscape(&sb)
		default:
			sb.WriteByte(c)
			s.pos++
		}
	}
	return sb.String()
}

var escapes = map[byte]string{'n': "\n", 't': "\t", 'r': "\r", '0': "\x00", '\n': ""}

func (s *scanner) cookEscape(sb *strings.Builder) {
	c := s.src[s.pos]
	s.pos++
	if c == '\r' {
		if s.at(s.pos) == '\n' {
			s.pos++
		}
		return
	}
	if cooked, ok := escapes[c]; ok {
		sb.WriteString(cooked)
		return
	}
	sb.WriteByte(c)
}

// scanTemplate reads a template literal, scanning each `${...}` as code.
func (s *scanner) scanTemplate(start int) {
	s.pos++
	var sb strings.Builder
	substituted := false
	for !s.done() && s.src[s.pos] != '`' {
		if s.at(s.pos) == '$' && s.at(s.pos+1) == '{' {
			if !substituted {
				substituted = true
				s.emit(Template, start, "")
			}
			s.pos += 2
			s.substitution("${")
			continue
		}
		s.templateText(&sb)
	}
	if !s.done() {
		s.pos++
	}
	if !substituted {
		s.emit(String, start, sb.String())
	}
}

// templateText reads one character or escape of template text.
func (s *scanner) templateText(sb *strings.Builder) {
	if s.src[s.pos] == '\\' && s.pos+1 < len(s.src) {
		s.pos++
		s.cookEscape(sb)
		return
	}
	sb.WriteByte(s.src[s.pos])
	s.pos++
}

func (s *scanner) readRegex() {
	s.pos++
	inClass := false
	for !s.done() {
		c := s.src[s.pos]
		s.pos++
		switch {
		case c == '\\':
			s.pos++
		case c == '[' || c == ']':
			inClass = c == '['
		case c == '/' && !inClass:
			for isIdentPart(s.at(s.pos)) {
				s.pos++
			}
			return
		case c == '\n':
			return
		}
	}
}

// jsxAhead reports whether the `<` at pos opens JSX rather than a generic
// arrow's type parameters (`<T,>` or `<T extends U>`).
func (s *scanner) jsxAhead() bool {
	i := s.pos + 1
	if s.at(i) == '>' {
		return true
	}
	if !isIdentStart(s.at(i)) {
		return false
	}
	for isIdentPart(s.at(i)) {
		i++
	}
	for isBlank(s.at(i)) {
		i++
	}
	return s.at(i) != ',' && !strings.HasPrefix(s.src[i:], "extends ")
}

func (s *scanner) skipSpace() {
	for !s.done() {
		c := s.src[s.pos]
		switch {
		case isBlank(c):
			s.pos++
		case c == '/' && (s.at(s.pos+1) == '/' || s.at(s.pos+1) == '*'):
			s.skipTrivia()
			s.newLine = false
		default:
			return
		}
	}
}

// expression scans a `{...}` JSX expression container as code.
func (s *scanner) expression() {
	s.pos++
	s.substitution("{")
}

// substitution scans code nested in JSX or a template up to its `}`, between
// marker tokens, so the code inside starts where an expression may.
func (s *scanner) substitution(open string) {
	start := s.pos
	s.emit(Punct, start, open)
	s.depth++
	s.scanCode(true)
	s.depth--
	s.emit(Punct, s.pos, "}")
}

func isTagPart(c byte) bool { return isIdentPart(c) || c == '.' || c == ':' || c == '-' }

func (s *scanner) skipTagName() {
	for !s.done() && isTagPart(s.src[s.pos]) {
		s.pos++
	}
}

// scanJSXElement reads one element or fragment from its `<`.
func (s *scanner) scanJSXElement() {
	s.pos++
	s.skipSpace()
	if s.at(s.pos) == '>' {
		s.pos++
		s.scanJSXChildren()
		return
	}
	s.skipTagName()
	for {
		s.skipSpace()
		if s.done() || s.tagPart() {
			return
		}
	}
}

// tagPart reads one piece of an opening tag; it reports true once the tag ends.
func (s *scanner) tagPart() bool {
	switch s.src[s.pos] {
	case '/':
		s.pos++
		s.skipSpace()
		if s.at(s.pos) == '>' {
			s.pos++
		}
		return true
	case '>':
		s.pos++
		s.scanJSXChildren()
		return true
	case '{':
		s.expression()
	case '<':
		s.skipTypeArguments()
	default:
		s.attribute()
	}
	return false
}

// skipTypeArguments skips `<Bar>` in `<Foo<Bar> />`.
func (s *scanner) skipTypeArguments() {
	depth := 0
	for ; !s.done(); s.pos++ {
		switch s.src[s.pos] {
		case '<':
			depth++
		case '>':
			depth--
		}
		if depth == 0 {
			s.pos++
			return
		}
	}
}

func (s *scanner) attribute() {
	s.skipTagName()
	s.skipSpace()
	if s.at(s.pos) != '=' {
		if c := s.at(s.pos); !s.done() && !isIdentStart(c) && c != '/' && c != '>' && c != '{' {
			s.pos++
		}
		return
	}
	s.pos++
	s.skipSpace()
	switch q := s.at(s.pos); q {
	case '"', '\'':
		end := strings.IndexByte(s.src[s.pos+1:], q)
		if end < 0 {
			s.pos = len(s.src)
		} else {
			s.pos += end + 2
		}
	case '{':
		s.expression()
	case '<':
		s.sawJSX = true
		s.scanJSXElement()
	}
}

// scanJSXChildren reads text, expressions and elements up to the closing tag.
func (s *scanner) scanJSXChildren() {
	for !s.done() {
		switch s.src[s.pos] {
		case '{':
			s.expression()
		case '<':
			if s.closingTag() {
				return
			}
			s.scanJSXElement()
		default:
			s.pos++
		}
	}
}

// closingTag skips `</...>` at pos and reports whether it was one.
func (s *scanner) closingTag() bool {
	j := s.pos + 1
	for isBlank(s.at(j)) {
		j++
	}
	if s.at(j) != '/' {
		return false
	}
	end := strings.IndexByte(s.src[j:], '>')
	if end < 0 {
		s.pos = len(s.src)
	} else {
		s.pos = j + end + 1
	}
	return true
}

// Tokens scans src. jsx enables JSX, as TypeScript does for .tsx, .jsx and .js.
func Tokens(src string, jsx bool) (tokens []Token, rendersJSX bool) {
	return tokensInto(nil, src, jsx)
}

func tokensInto(buffer []Token, src string, jsx bool) ([]Token, bool) {
	s := &scanner{src: src, jsx: jsx, tokens: buffer[:0]}
	s.scanCode(false)
	return s.tokens, s.sawJSX
}
