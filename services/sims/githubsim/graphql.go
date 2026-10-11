package githubsim

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode"
)

// A small GraphQL reader: enough of the language for the queries gh sends (operations,
// aliases, arguments, variables, inline fragments, fragment spreads, @include/@skip).
// Type conditions are ignored: every fragment's fields join the parent selection.

type gqlField struct {
	alias, name string
	args        map[string]any
	sel         []*gqlField
}

func (f *gqlField) key() string {
	if f.alias != "" {
		return f.alias
	}
	return f.name
}

type gqlParser struct {
	src       string
	pos       int
	vars      map[string]any
	fragments map[string][]*gqlField
	pending   map[string]int // fragment name -> start offset, parsed on first spread
}

type gqlOperation struct {
	kind string
	sel  []*gqlField
}

func parseGraphQL(query string, vars map[string]any, operationName string) (op gqlOperation, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("%v", r)
		}
	}()
	p := &gqlParser{src: query, vars: vars, fragments: map[string][]*gqlField{}, pending: map[string]int{}}
	// First pass: note where each fragment starts so a spread can come before its definition.
	for p.skip(); p.pos < len(p.src); p.skip() {
		start := p.pos
		word := p.peekName()
		if word == "fragment" {
			p.name()
			p.pending[p.name()] = start
		}
		p.skipDefinition()
	}
	var ops []gqlOperation
	var names []string
	p.pos = 0
	for p.skip(); p.pos < len(p.src); p.skip() {
		kind, name := "query", ""
		if p.src[p.pos] != '{' {
			kind = p.name()
			if kind == "fragment" {
				p.skipDefinition()
				continue
			}
			p.skip()
			if p.pos < len(p.src) && isNameStart(p.src[p.pos]) {
				name = p.name()
			}
			p.skip()
			if p.peek('(') {
				p.skipBalanced('(', ')')
			}
			p.directives()
		}
		ops = append(ops, gqlOperation{kind: kind, sel: p.selectionSet()})
		names = append(names, name)
	}
	for i, o := range ops {
		if operationName == "" || names[i] == operationName {
			return o, nil
		}
	}
	return gqlOperation{}, fmt.Errorf("no operation named %q", operationName)
}

func isNameStart(c byte) bool { return c == '_' || unicode.IsLetter(rune(c)) }

func (p *gqlParser) skip() {
	for p.pos < len(p.src) {
		c := p.src[p.pos]
		switch {
		case c == '#':
			for p.pos < len(p.src) && p.src[p.pos] != '\n' {
				p.pos++
			}
		case c == ',' || unicode.IsSpace(rune(c)):
			p.pos++
		default:
			return
		}
	}
}

func (p *gqlParser) peek(c byte) bool {
	p.skip()
	return p.pos < len(p.src) && p.src[p.pos] == c
}

func (p *gqlParser) expect(c byte) {
	if !p.peek(c) {
		panic(fmt.Sprintf("expected %q at %d", c, p.pos))
	}
	p.pos++
}

func (p *gqlParser) peekName() string {
	save := p.pos
	defer func() { p.pos = save }()
	if p.pos < len(p.src) && isNameStart(p.src[p.pos]) {
		return p.name()
	}
	return ""
}

func (p *gqlParser) name() string {
	p.skip()
	start := p.pos
	for p.pos < len(p.src) && (isNameStart(p.src[p.pos]) || (p.src[p.pos] >= '0' && p.src[p.pos] <= '9')) {
		p.pos++
	}
	if start == p.pos {
		panic(fmt.Sprintf("expected a name at %d", p.pos))
	}
	return p.src[start:p.pos]
}

func (p *gqlParser) skipBalanced(open, closing byte) {
	p.expect(open)
	for depth := 1; depth > 0 && p.pos < len(p.src); p.pos++ {
		switch p.src[p.pos] {
		case '"':
			p.stringValue()
			p.pos--
		case open:
			depth++
		case closing:
			depth--
		}
	}
}

// skipDefinition moves past one top-level definition (up to and including its outer braces).
func (p *gqlParser) skipDefinition() {
	for p.pos < len(p.src) && p.src[p.pos] != '{' {
		if p.src[p.pos] == '(' {
			p.skipBalanced('(', ')')
			continue
		}
		p.pos++
	}
	if p.pos < len(p.src) {
		p.skipBalanced('{', '}')
	}
}

// directives reads @name(args) and reports false when @skip(if:true) or @include(if:false) drops the node.
func (p *gqlParser) directives() bool {
	keep := true
	for p.peek('@') {
		p.pos++
		name := p.name()
		var args map[string]any
		if p.peek('(') {
			args = p.arguments()
		}
		cond, _ := args["if"].(bool)
		if (name == "skip" && cond) || (name == "include" && !cond) {
			keep = false
		}
	}
	return keep
}

func (p *gqlParser) selectionSet() []*gqlField {
	p.expect('{')
	var out []*gqlField
	for !p.peek('}') {
		if strings.HasPrefix(p.src[p.pos:], "...") {
			p.pos += 3
			p.skip()
			word := p.peekName()
			switch {
			case word == "on":
				p.name()
				p.name()
				fallthrough
			case word == "" || p.peek('@') || p.peek('{'):
				keep := p.directives()
				sel := p.selectionSet()
				if keep {
					out = append(out, sel...)
				}
			default:
				name := p.name()
				if p.directives() {
					out = append(out, p.fragment(name)...)
				}
			}
			continue
		}
		f := &gqlField{name: p.name()}
		if p.peek(':') {
			p.pos++
			f.alias, f.name = f.name, p.name()
		}
		if p.peek('(') {
			f.args = p.arguments()
		}
		keep := p.directives()
		if p.peek('{') {
			f.sel = p.selectionSet()
		}
		if keep {
			out = append(out, f)
		}
	}
	p.pos++
	return out
}

func (p *gqlParser) fragment(name string) []*gqlField {
	if sel, ok := p.fragments[name]; ok {
		return sel
	}
	start, ok := p.pending[name]
	if !ok {
		panic("unknown fragment " + name)
	}
	save := p.pos
	p.pos = start
	p.name() // fragment
	p.name() // its name
	p.name() // on
	p.name() // type
	p.directives()
	sel := p.selectionSet()
	p.fragments[name] = sel
	p.pos = save
	return sel
}

func (p *gqlParser) arguments() map[string]any {
	p.expect('(')
	out := map[string]any{}
	for !p.peek(')') {
		key := p.name()
		p.expect(':')
		out[key] = p.value()
	}
	p.pos++
	return out
}

func (p *gqlParser) value() any {
	p.skip()
	c := p.src[p.pos]
	switch {
	case c == '$':
		p.pos++
		return p.vars[p.name()]
	case c == '"':
		return p.stringValue()
	case c == '[':
		p.pos++
		list := []any{}
		for !p.peek(']') {
			list = append(list, p.value())
		}
		p.pos++
		return list
	case c == '{':
		p.pos++
		obj := map[string]any{}
		for !p.peek('}') {
			key := p.name()
			p.expect(':')
			obj[key] = p.value()
		}
		p.pos++
		return obj
	case c == '-' || (c >= '0' && c <= '9'):
		start := p.pos
		for p.pos < len(p.src) && strings.ContainsRune("-+.eE0123456789", rune(p.src[p.pos])) {
			p.pos++
		}
		n, _ := strconv.ParseFloat(p.src[start:p.pos], 64)
		return n
	}
	switch word := p.name(); word {
	case "true":
		return true
	case "false":
		return false
	case "null":
		return nil
	default:
		return word
	}
}

func (p *gqlParser) stringValue() string {
	if strings.HasPrefix(p.src[p.pos:], `"""`) {
		end := strings.Index(p.src[p.pos+3:], `"""`)
		if end < 0 {
			panic("unterminated block string")
		}
		out := p.src[p.pos+3 : p.pos+3+end]
		p.pos += end + 6
		return out
	}
	start := p.pos
	for p.pos++; p.pos < len(p.src) && p.src[p.pos] != '"'; p.pos++ {
		if p.src[p.pos] == '\\' {
			p.pos++
		}
	}
	p.pos++
	out, err := strconv.Unquote(p.src[start:p.pos])
	if err != nil {
		panic("bad string at " + strconv.Itoa(start))
	}
	return out
}

// gqlResolver is a field whose value depends on its arguments.
type gqlResolver func(args map[string]any) any

// resolve projects value through the selection: maps by field name, resolvers called with their arguments.
func resolve(value any, sel []*gqlField) any {
	switch v := value.(type) {
	case nil:
		return nil
	case []map[string]any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = resolve(item, sel)
		}
		return out
	case map[string]any:
		if len(sel) == 0 {
			return v
		}
		out := map[string]any{}
		for _, f := range sel {
			field := v[f.name]
			if fn, ok := field.(gqlResolver); ok {
				field = fn(f.args)
			}
			got := resolve(field, f.sel)
			if prev, ok := out[f.key()].(map[string]any); ok {
				if next, ok := got.(map[string]any); ok {
					for k, val := range next {
						prev[k] = val
					}
					continue
				}
			}
			out[f.key()] = got
		}
		return out
	default:
		return v
	}
}

type gqlError struct {
	Type    string   `json:"type,omitempty"`
	Path    []string `json:"path,omitempty"`
	Message string   `json:"message"`
}

func (s *Server) handleGraphQL(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Query         string         `json:"query"`
		Variables     map[string]any `json:"variables"`
		OperationName string         `json:"operationName"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"message": "Problems parsing JSON"})
		return
	}
	op, err := parseGraphQL(body.Query, body.Variables, body.OperationName)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"errors": []gqlError{{Message: "githubsim could not read the query: " + err.Error()}}})
		return
	}
	s.mu.Lock()
	tok := s.tokenAuth(w, r, "", "", "")
	if tok == nil {
		s.mu.Unlock()
		return
	}
	g := &graphCall{s: s, tok: tok}
	root := g.queryRoot()
	if op.kind == "mutation" {
		root = g.mutationRoot()
	}
	data := resolve(root, op.sel)
	s.mu.Unlock()
	for _, d := range g.deliveries {
		s.deliverAsync(d)
	}
	out := map[string]any{"data": data}
	if len(g.errors) > 0 {
		out["errors"] = g.errors
	}
	writeJSON(w, http.StatusOK, out)
}
