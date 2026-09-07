package herrgen

import (
	"fmt"
	"go/ast"
	"go/token"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

// herrConstructors are the herr functions whose code argument is read, mapped to
// the position of that argument.
//
// herr.Code is a defined string type, so `herr.New(ctx, "internal_error", nil)`
// compiles with no conversion in sight. The code is on the wire exactly as if a
// const had held it, so it is generated exactly as if a const had held it.
var herrConstructors = map[string]int{"New": 1, "NewLight": 1}

// herrErrorType is the herr struct whose `Code:` field is read, for the
// `herr.E{Code: "..."}` form.
const herrErrorType = "E"

// herrgenExternalMarker opts one `herr.Code(...)` conversion out of the
// must-be-a-literal rule, for a discriminant that belongs to someone else and
// therefore has no enumerable set of values (see fileDeclarations). Written on
// the conversion's own line or the line above it.
const herrgenExternalMarker = "herrgen:external"

// markedExternal reports whether the site at node carries the opt-out marker.
//
// The marker may sit anywhere in the comment block directly above the site, or
// trailing on the site's own line. The whole block counts, not just the line
// above it: the marker earns its place with an explanation of WHY the code is
// someone else's, and that explanation runs to several lines, which would put
// the marker itself well above the code it applies to.
func markedExternal(fset *token.FileSet, file *ast.File, node ast.Node) bool {
	line := fset.Position(node.Pos()).Line
	for _, group := range file.Comments {
		adjacent := fset.Position(group.End()).Line == line-1 ||
			fset.Position(group.Pos()).Line == line
		if !adjacent {
			continue
		}
		for _, comment := range group.List {
			if strings.Contains(comment.Text, herrgenExternalMarker) {
				return true
			}
		}
	}
	return false
}

// fileDeclarations returns the herr codes declared in one file.
//
// Every `herr.Code(...)` in the file is read, wherever it sits — a const block, a
// package-level `var` (herr.Code satisfies `error`, so `var ErrX =
// herr.Code("x")` is the sentinel form Go engineers reach for by muscle
// memory), a map or struct literal, a function body. A code declared any of
// those ways reaches the client identically, so it is generated identically.
//
// A `herr.Code(...)` whose argument cannot be folded to a string is an error,
// never a skip: it is the one shape that would leave a live code with no
// customer copy while the drift check stayed green.
//
// The one exception is a code that is not ours to enumerate: a discriminant
// relayed from a third party (a model provider's `error.type`, say) is an
// unbounded set of strings arriving at runtime, so no literal exists to write
// and no registry entry could ever be exhaustive over it. Such a site marks
// itself with `herrgenExternalMarker` and is skipped. It has to be explicit —
// the default stays strict, because "built from a variable" is otherwise
// exactly the mistake this check exists to catch. Codes that arrive this way
// are handled at the client: an unregistered code degrades to its humanized
// self rather than to a blank error.
func fileDeclarations(fset *token.FileSet, file *ast.File, herrName string) ([]Declaration, error) {
	var (
		found []Declaration
		errs  []string
	)
	unreadable := func(node ast.Node, what string) {
		position := fset.Position(node.Pos())
		errs = append(errs, fmt.Sprintf("%s:%d: %s", filepath.ToSlash(position.Filename), position.Line, what))
	}

	// read records the `herr.Code(...)` calls already accounted for by a named
	// declaration, so the sweep below does not count `X = herr.Code("x")` twice.
	read := map[*ast.CallExpr]bool{}

	// Named declarations first, so their name and doc comment reach the
	// generated file. ast.Inspect rather than file.Decls: a const or var block
	// inside a function body is a declaration too.
	ast.Inspect(file, func(node ast.Node) bool {
		gen, ok := node.(*ast.GenDecl)
		if !ok || (gen.Tok != token.CONST && gen.Tok != token.VAR) {
			return true
		}
		for _, spec := range gen.Specs {
			value, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for i, name := range value.Names {
				if i >= len(value.Values) {
					continue
				}
				expr := value.Values[i]
				call, isCall := codeCall(expr, herrName)
				if isCall {
					read[call] = true
				}
				// `const X herr.Code = "x"` puts the conversion in the declared
				// type rather than around the literal.
				target := expr
				if isCall {
					target = call.Args[0]
				} else if !isSelector(value.Type, herrName, "Code") {
					// Only the qualified form: a file that does not import
					// pkg/herr is skipped before we get here, and pkg/herr
					// declares no codes of its own outside its tests (which the
					// walk skips), so an unqualified `Code` cannot reach this.
					continue
				}
				code, ok := foldString(target)
				if !ok {
					// The opt-out is consulted here, not only in the sweep
					// below: `read[call]` above has already claimed this call,
					// so a marked named declaration would never reach the
					// second sweep — the only other place that looks at the
					// marker — and the escape hatch would be unreachable from
					// the `var X = herr.Code(upstream.Type)` form entirely.
					// `expr` is the conversion itself when there is one and the
					// declared value otherwise, so the typed
					// `const X herr.Code = ...` form can be marked too.
					if markedExternal(fset, file, expr) {
						// Someone else's discriminant, relayed. Nothing to
						// generate and nothing to write copy for.
						continue
					}
					unreadable(target, fmt.Sprintf(
						"%s is declared as a herr code herrgen cannot read; write the code as a plain string literal, or mark the line `%s` if it relays a code that is not ours to enumerate",
						name.Name, herrgenExternalMarker,
					))
					continue
				}
				found = append(found, Declaration{
					Name: name.Name,
					Code: code,
					Doc:  docOf(gen, value),
				})
			}
		}
		return true
	})

	// Then every remaining `herr.Code(...)` and every inline string literal in a
	// herr constructor: no const name to carry, but the same code on the wire.
	ast.Inspect(file, func(node ast.Node) bool {
		switch expr := node.(type) {
		case *ast.CallExpr:
			if call, ok := codeCall(expr, herrName); ok {
				if read[call] {
					return true
				}
				code, ok := foldString(call.Args[0])
				if !ok {
					if markedExternal(fset, file, call) {
						// Someone else's discriminant, relayed. Nothing to
						// generate and nothing to write copy for.
						return true
					}
					unreadable(call.Args[0], fmt.Sprintf(
						"herr.Code(...) is built from something herrgen cannot read; write the code as a plain string literal, or mark the line `%s` if it relays a code that is not ours to enumerate",
						herrgenExternalMarker,
					))
					return true
				}
				found = append(found, Declaration{Code: code})
				return true
			}
			if code, ok := constructorCode(expr, herrName); ok {
				found = append(found, Declaration{Code: code})
			}
		case *ast.CompositeLit:
			if code, ok := errorLiteralCode(expr, herrName); ok {
				found = append(found, Declaration{Code: code})
			}
		}
		return true
	})

	if len(errs) > 0 {
		slices.Sort(errs)
		return nil, fmt.Errorf("unreadable herr code:\n  %s", strings.Join(errs, "\n  "))
	}
	return found, nil
}

// codeCall reports the `herr.Code(...)` conversion an expression is, if it is
// one. The argument is deliberately left unread: the caller decides whether an
// unreadable one is an error here or a skip.
func codeCall(expr ast.Expr, herrName string) (*ast.CallExpr, bool) {
	call, ok := expr.(*ast.CallExpr)
	if !ok || len(call.Args) != 1 || !isSelector(call.Fun, herrName, "Code") {
		return nil, false
	}
	return call, true
}

// constructorCode reads the code a `herr.New(ctx, "code", ...)` or
// `herr.NewLight(...)` call passes as a bare string literal.
//
// Anything that is not a string literal is a const reference, which the
// declaration sweep already reads where it is declared, so it is skipped here
// rather than reported.
func constructorCode(call *ast.CallExpr, herrName string) (string, bool) {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return "", false
	}
	qualifier, ok := selector.X.(*ast.Ident)
	if !ok || qualifier.Name != herrName {
		return "", false
	}
	at, ok := herrConstructors[selector.Sel.Name]
	if !ok || len(call.Args) <= at {
		return "", false
	}
	return stringLiteral(call.Args[at])
}

// errorLiteralCode reads the code a `herr.E{Code: "code"}` composite literal
// carries as a bare string literal, on the same terms as constructorCode.
func errorLiteralCode(lit *ast.CompositeLit, herrName string) (string, bool) {
	if !isSelector(lit.Type, herrName, herrErrorType) {
		return "", false
	}
	for _, element := range lit.Elts {
		kv, ok := element.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		if key, ok := kv.Key.(*ast.Ident); !ok || key.Name != "Code" {
			continue
		}
		return stringLiteral(kv.Value)
	}
	return "", false
}

// stringLiteral unquotes an untyped string literal.
func stringLiteral(expr ast.Expr) (string, bool) {
	literal, ok := expr.(*ast.BasicLit)
	if !ok || literal.Kind != token.STRING {
		return "", false
	}
	code, err := strconv.Unquote(literal.Value)
	if err != nil {
		return "", false
	}
	return code, true
}

// foldString folds a constant string expression the way the compiler would,
// which for a code means a literal or literals joined with `+`. A code built
// from a const prefix does not fold here — deliberately, so it is reported
// rather than guessed at.
func foldString(expr ast.Expr) (string, bool) {
	switch value := expr.(type) {
	case *ast.BasicLit:
		return stringLiteral(value)
	case *ast.ParenExpr:
		return foldString(value.X)
	case *ast.BinaryExpr:
		if value.Op != token.ADD {
			return "", false
		}
		left, ok := foldString(value.X)
		if !ok {
			return "", false
		}
		right, ok := foldString(value.Y)
		if !ok {
			return "", false
		}
		return left + right, true
	}
	return "", false
}

// docOf returns the doc comment belonging to one const.
//
// A const in a parenthesised block never inherits the block's doc: that comment
// describes the whole group ("Gateway-specific error codes."), not the member.
// Nor does it inherit its own trailing line comment: `ErrX = herr.Code("x")
// // 400` is a note to the next Go reader, and rendering it as the entry's
// JSDoc turns it into "ErrX — 400".
func docOf(gen *ast.GenDecl, value *ast.ValueSpec) string {
	switch {
	case value.Doc != nil:
		return value.Doc.Text()
	case gen.Lparen == token.NoPos && gen.Doc != nil:
		return gen.Doc.Text()
	}
	return ""
}

// group folds the declarations into one entry per code string.
//
// The doc and the service name come from the first declaration: the one that
// carries a doc comment, then the first by path. A code declared in several
// services is usually documented in exactly one of them, and that is the text
// worth carrying across.
func group(declarations []Declaration, statuses map[string]Registration) []Entry {
	byCode := map[string][]Declaration{}
	for _, declaration := range declarations {
		byCode[declaration.Code] = append(byCode[declaration.Code], declaration)
	}

	entries := make([]Entry, 0, len(byCode))
	for code, shared := range byCode {
		slices.SortFunc(shared, func(a, b Declaration) int {
			if documented(a) != documented(b) {
				if documented(a) {
					return -1
				}
				return 1
			}
			return strings.Compare(a.Source+"."+a.Name, b.Source+"."+b.Name)
		})
		// Two bare literals of the same code in one file are the same fact
		// twice; the sort above has already put them side by side.
		shared = slices.Compact(shared)
		entry := Entry{Code: code, Declarations: shared}
		if registration, ok := statuses[code]; ok {
			entry.Status, entry.HasStatus = registration.Status, true
		}
		entries = append(entries, entry)
	}
	slices.SortFunc(entries, func(a, b Entry) int { return strings.Compare(a.Code, b.Code) })
	return entries
}

func documented(declaration Declaration) bool {
	return strings.TrimSpace(declaration.Doc) != ""
}
