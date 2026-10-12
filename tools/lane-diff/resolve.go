package lanediff

import (
	"regexp"
	"strings"
)

// resolved is a name read from source: a literal value, or the expression
// that could not be read (prefixed with "?").
type resolved struct {
	value     string
	ok        bool
	heuristic bool
}

func unresolved(expr string) resolved {
	expr = strings.Join(strings.Fields(expr), " ")
	if len(expr) > 60 {
		expr = expr[:60] + "..."
	}
	return resolved{value: "?" + expr}
}

type indexes struct {
	decls map[string][]decl
	files Tree
}

// index records every const, class and function declaration in the tree.
func index(tree Tree) *indexes {
	idx := &indexes{decls: map[string][]decl{}, files: tree}
	for path, src := range tree {
		idx.indexConsts(path, src)
		idx.indexClasses(path, src)
		idx.indexFunctions(path, src)
	}
	return idx
}

func (idx *indexes) indexConsts(path, src string) {
	for _, m := range declPattern.FindAllStringSubmatchIndex(src, -1) {
		name := src[m[2]:m[3]]
		idx.decls[name] = append(idx.decls[name], decl{file: path, kind: "const", text: initializer(src, m[1])})
	}
}

func (idx *indexes) indexClasses(path, src string) {
	for _, m := range classPattern.FindAllStringSubmatchIndex(src, -1) {
		if end := matchClose(src, m[1]-1); end > 0 {
			idx.add(src[m[2]:m[3]], decl{file: path, kind: "class", text: src[m[1]-1 : end+1]})
		}
	}
}

func (idx *indexes) indexFunctions(path, src string) {
	for _, m := range funcPattern.FindAllStringSubmatchIndex(src, -1) {
		if body := functionBody(src, m[1]-1); body != "" {
			idx.add(src[m[2]:m[3]], decl{file: path, kind: "function", text: body})
		}
	}
}

func (idx *indexes) add(name string, d decl) {
	idx.decls[name] = append(idx.decls[name], d)
}

// initializer reads a declaration's right-hand side from i to its end.
func initializer(s string, i int) string {
	limit := min(len(s), i+20000)
	depth := 0
	end := walkCode(s[:limit], i, func(j int) bool {
		depth += bracketDelta(s[j])
		return depth != 0 || !endsStatement(s, j)
	})
	if end >= limit {
		return ""
	}
	return s[i:end]
}

// endsStatement reports whether the byte at j, outside every bracket, ends
// a statement: a semicolon, or a line break not followed by a continuation.
func endsStatement(s string, j int) bool {
	switch s[j] {
	case ';':
		return true
	case '\n':
		next := skipSpace(s, j)
		return next >= len(s) || !strings.ContainsRune(".?:|&+", rune(s[next]))
	}
	return false
}

// functionBody reads the `{...}` body of the function whose parameter list
// (or type parameters) start at i.
func functionBody(s string, i int) string {
	i = skipGenerics(s, i)
	if i >= len(s) || s[i] != '(' {
		return ""
	}
	end := matchClose(s, i)
	if end < 0 {
		return ""
	}
	open := strings.IndexByte(s[end:], '{')
	if open < 0 {
		return ""
	}
	bodyEnd := matchClose(s, end+open)
	if bodyEnd < 0 {
		return ""
	}
	return s[end+open : bodyEnd+1]
}

func cleanExpr(expr string) string {
	expr = strings.TrimSpace(expr)
	for _, cut := range []string{" as const", " satisfies "} {
		if at := strings.LastIndex(expr, cut); at > 0 {
			expr = strings.TrimSpace(expr[:at])
		}
	}
	return strings.TrimSuffix(expr, "!")
}

// lookup returns the declarations of name, the one in path first.
func (idx *indexes) lookup(path, name string) []decl {
	all := idx.decls[name]
	for _, d := range all {
		if d.file == path {
			return []decl{d}
		}
	}
	return all
}

// resolve reads expr as a string: a literal, a template over resolvable
// parts, or a constant, an object member or a class's static member.
func (idx *indexes) resolve(path, expr string, depth int) resolved {
	expr = cleanExpr(expr)
	if expr == "" || depth > 4 {
		return unresolved(expr)
	}
	if r, literal := idx.resolveLiteral(path, expr, depth); literal {
		return r
	}
	if isIdent(expr) {
		return idx.resolveIdent(path, expr, depth)
	}
	if dot := strings.LastIndexByte(expr, '.'); dot > 0 && isIdent(expr[dot+1:]) && isIdent(strings.ReplaceAll(expr[:dot], ".", "_")) {
		return idx.resolveMember(path, expr, depth)
	}
	return unresolved(expr)
}

// resolveLiteral reads a quoted string, a template or a parenthesised
// expression; the bool is false when expr is none of those.
func (idx *indexes) resolveLiteral(path, expr string, depth int) (resolved, bool) {
	switch expr[0] {
	case '"', '\'':
		if skipString(expr, 0) == len(expr) {
			return resolved{value: expr[1 : len(expr)-1], ok: true}, true
		}
		return unresolved(expr), true
	case '`':
		if skipString(expr, 0) == len(expr) {
			return idx.template(path, expr[1:len(expr)-1], depth), true
		}
		return unresolved(expr), true
	case '(':
		if end := matchClose(expr, 0); end == len(expr)-1 {
			return idx.resolve(path, expr[1:end], depth+1), true
		}
	}
	return resolved{}, false
}

func (idx *indexes) template(path, body string, depth int) resolved {
	var out strings.Builder
	for i := 0; i < len(body); {
		if body[i] != '$' || i+1 >= len(body) || body[i+1] != '{' {
			out.WriteByte(body[i])
			i++
			continue
		}
		end := matchClose(body, i+1)
		if end < 0 {
			return unresolved("`" + body + "`")
		}
		part := idx.resolve(path, body[i+2:end], depth+1)
		if !part.ok {
			return unresolved("`" + body + "`")
		}
		out.WriteString(part.value)
		i = end + 1
	}
	return resolved{value: out.String(), ok: true}
}

func (idx *indexes) resolveIdent(path, name string, depth int) resolved {
	var values []resolved
	seen := map[string]bool{}
	for _, d := range idx.lookup(path, name) {
		if d.kind != "const" {
			continue
		}
		r := idx.resolve(d.file, d.text, depth+1)
		if r.ok && !seen[r.value] {
			seen[r.value] = true
			values = append(values, r)
		}
	}
	if len(values) == 1 {
		return values[0]
	}
	return unresolved(name)
}

// resolveMember reads `owner.member`.
func (idx *indexes) resolveMember(path, expr string, depth int) resolved {
	dot := strings.LastIndexByte(expr, '.')
	owner, member := expr[:dot], expr[dot+1:]
	base := owner
	if dot := strings.LastIndexByte(owner, '.'); dot >= 0 {
		base = owner[dot+1:]
	}
	for _, d := range idx.lookup(path, base) {
		if r, ok := idx.memberOf(d, member, depth); ok {
			return r
		}
	}
	return unresolved(owner + "." + member)
}

// memberOf reads member of one declaration: an object's property, or a
// class's `name` field.
func (idx *indexes) memberOf(d decl, member string, depth int) (resolved, bool) {
	switch d.kind {
	case "const":
		props := objectProps(cleanExpr(d.text))
		if v, ok := props[member]; ok {
			return idx.resolve(d.file, v, depth+1), true
		}
	case "class":
		if m := staticName.FindStringSubmatch(d.text); m != nil && member == "name" {
			return idx.resolve(d.file, m[1], depth+1), true
		}
	}
	return resolved{}, false
}

// resolveDefinition reads the name of a definition passed where a name or a
// definition is accepted: a string, an object literal's key, a constructor
// or factory call, or an identifier bound to one of those.
func (idx *indexes) resolveDefinition(path, expr string) resolved {
	return idx.definition(path, cleanExpr(expr), 0)
}

func (idx *indexes) definition(path, expr string, depth int) resolved {
	if expr == "" || depth > 4 {
		return unresolved(expr)
	}
	if r := idx.resolve(path, expr, 0); r.ok {
		return r
	}
	if props := objectProps(expr); props != nil {
		if v, ok := props["name"]; ok {
			return idx.resolve(path, v, 0)
		}
		return unresolved(expr)
	}
	if r, ok := idx.fromCallArgs(path, expr); ok {
		return r
	}
	if r, ok := idx.fromSegments(path, expr, depth); ok {
		return r
	}
	return unresolved(expr)
}

// fromCallArgs reads the name from a call's object argument holding `name`,
// or from its first argument when that is a string.
func (idx *indexes) fromCallArgs(path, expr string) (resolved, bool) {
	_, args, isCall := splitCall(expr)
	if !isCall {
		return resolved{}, false
	}
	for _, arg := range args {
		if v, ok := objectProps(arg)["name"]; ok {
			return idx.resolve(path, v, 0), true
		}
	}
	if len(args) > 0 && strings.HasPrefix(strings.TrimSpace(args[0]), `"`) {
		if r := idx.resolve(path, args[0], 0); r.ok {
			return r, true
		}
	}
	return resolved{}, false
}

// fromSegments handles a chain such as `Owner.create(deps).build()` or
// `this.field`: each segment of its leading path is tried as a declaration,
// then as a field whose declared type is one.
func (idx *indexes) fromSegments(path, expr string, depth int) (resolved, bool) {
	for _, segment := range leadSegments(expr) {
		if !idx.trustedSegment(path, segment) {
			continue
		}
		candidates := []string{segment}
		if typed := fieldType(idx, path, segment); typed != "" {
			candidates = append(candidates, typed)
		}
		for _, name := range candidates {
			if r := idx.fromDeclaration(path, name, depth); r.ok {
				return r, true
			}
		}
	}
	return resolved{}, false
}

var ignoredSegments = map[string]bool{"this": true, "options": true, "deps": true, "create": true, "build": true, "new": true, "name": true}

// trustedSegment admits a segment as a declaration name: a type-like name, a
// declaration in the same file, or a field whose declared type is one. A
// lower-case loop variable must not match an unrelated global of that name.
func (idx *indexes) trustedSegment(path, segment string) bool {
	if segment[0] >= 'A' && segment[0] <= 'Z' {
		return true
	}
	for _, d := range idx.decls[segment] {
		if d.file == path {
			return true
		}
	}
	return fieldType(idx, path, segment) != "" || imports(idx.files[path], segment)
}

// imports reports whether src imports name; an imported binding is a
// declaration elsewhere, never a loop variable.
func imports(src, name string) bool {
	re := regexp.MustCompile(`(?s)\bimport\s+(?:type\s+)?\{[^}]*\b` + regexp.QuoteMeta(name) + `\b[^}]*\}\s*from`)
	return re.MatchString(src)
}

func isPathByte(c byte) bool {
	return c == '.' || c == '_' || c == '$' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
}

// leadSegments returns the identifiers of the leading `a.b.c` path of expr.
func leadSegments(expr string) []string {
	expr = strings.TrimPrefix(strings.TrimSpace(expr), "new ")
	end := 0
	for end < len(expr) && isPathByte(expr[end]) {
		end++
	}
	var out []string
	for _, seg := range strings.Split(expr[:end], ".") {
		if isIdent(seg) && !ignoredSegments[seg] {
			out = append(out, seg)
		}
	}
	return out
}

// fieldType reads `field?: Type` or `field: Type` in a file, for a class or
// options field holding a definition.
func fieldType(idx *indexes, path, field string) string {
	src, ok := idx.files[path]
	if !ok {
		return ""
	}
	re := regexp.MustCompile(`(?m)^\s*(?:private\s+|public\s+|protected\s+)?(?:readonly\s+)?` + regexp.QuoteMeta(field) + `\s*[?!]?\s*:\s*([A-Z][\w$]*)`)
	if m := re.FindStringSubmatch(src); m != nil {
		return m[1]
	}
	return ""
}

// propOf reads the expression a definition object holds under prop, through
// a factory's body when the definition is built by a call.
func (idx *indexes) propOf(path, expr, prop string) (string, string, bool) {
	expr = cleanExpr(expr)
	if props := objectProps(expr); props != nil {
		v, ok := props[prop]
		return v, path, ok
	}
	re := regexp.MustCompile(`(?:^|[\s{,(])` + regexp.QuoteMeta(prop) + `\s*:\s*`)
	for _, segment := range leadSegments(expr) {
		for _, d := range idx.lookup(path, segment) {
			if value, ok := firstValue(d.text, re); ok {
				return value, d.file, true
			}
		}
	}
	return "", path, false
}

// firstValue reads the value written after the first match of key in text.
func firstValue(text string, key *regexp.Regexp) (string, bool) {
	loc := key.FindStringIndex(text)
	if loc == nil {
		return "", false
	}
	parts := splitTopLevel(text[loc[1]:])
	if len(parts) == 0 {
		return "", false
	}
	value := parts[0]
	if nl := strings.IndexAny(value, "\n}"); nl >= 0 {
		value = value[:nl]
	}
	return value, true
}

func (idx *indexes) fromDeclaration(path, name string, depth int) resolved {
	if dot := strings.LastIndexByte(name, '.'); dot >= 0 {
		name = name[dot+1:]
	}
	for _, d := range idx.lookup(path, name) {
		if r := idx.nameOfDecl(d, depth); r.ok {
			return r
		}
	}
	return unresolved(name)
}

// nameOfDecl reads the name of one declaration: a const's definition, a
// class's `name` field, or (as a heuristic) the first `name:` in a factory.
func (idx *indexes) nameOfDecl(d decl, depth int) resolved {
	switch d.kind {
	case "const":
		return idx.definition(d.file, cleanExpr(d.text), depth+1)
	case "class":
		if m := staticName.FindStringSubmatch(d.text); m != nil {
			return idx.resolve(d.file, m[1], 0)
		}
	case "function":
		if value, ok := firstValue(d.text, firstNameKey); ok {
			r := idx.resolve(d.file, value, 0)
			r.heuristic = r.ok
			return r
		}
	}
	return resolved{}
}

// splitCall reads `callee(args)` when expr is exactly one call.
func splitCall(expr string) (string, []string, bool) {
	open := strings.IndexByte(expr, '(')
	if open <= 0 {
		return "", nil, false
	}
	callee := strings.TrimSpace(expr[:open])
	if g := strings.IndexByte(callee, '<'); g > 0 {
		callee = strings.TrimSpace(callee[:g])
	}
	if !isIdent(strings.ReplaceAll(strings.TrimPrefix(callee, "new "), ".", "_")) {
		return "", nil, false
	}
	args, end := callArgs(expr, open)
	if end != len(expr)-1 {
		return "", nil, false
	}
	return callee, args, true
}

// mentionsFoldOrMap reports whether a subscriber spec names a fold or map,
// which makes it a projection subscriber (a reactor lane).
func (idx *indexes) mentionsFoldOrMap(path, expr string) bool {
	expr = cleanExpr(expr)
	props := objectProps(expr)
	if props == nil && isIdent(expr) {
		for _, d := range idx.lookup(path, expr) {
			if d.kind == "const" {
				props = objectProps(cleanExpr(d.text))
				break
			}
		}
	}
	_, fold := props["fold"]
	_, mapped := props["map"]
	return fold || mapped
}
