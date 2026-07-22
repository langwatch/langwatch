package herrgen

import (
	"go/ast"
	"go/token"
	"slices"
	"strconv"
	"strings"
)

// fileDeclarations returns the herr codes declared in one file.
func fileDeclarations(file *ast.File, herrName string) []Declaration {
	var found []Declaration
	pkgName := ""
	if file.Name != nil {
		pkgName = file.Name.Name
	}
	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.CONST {
			continue
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
				code, ok := codeLiteral(value.Values[i], herrName)
				if !ok && isCodeType(value.Type, herrName, pkgName) {
					// `const X herr.Code = "x"` — the conversion is in the
					// declared type rather than around the literal.
					code, ok = stringLiteral(value.Values[i])
				}
				if !ok {
					continue
				}
				found = append(found, Declaration{
					Name: name.Name,
					Code: code,
					Doc:  docOf(gen, value),
				})
			}
		}
	}
	return found
}

// codeLiteral reports the string a `herr.Code("...")` call holds.
func codeLiteral(expr ast.Expr, herrName string) (string, bool) {
	call, ok := expr.(*ast.CallExpr)
	if !ok || len(call.Args) != 1 {
		return "", false
	}
	if !isSelector(call.Fun, herrName, "Code") {
		return "", false
	}
	return stringLiteral(call.Args[0])
}

// isCodeType reports whether a const's declared type is herr.Code, covering the
// `const X herr.Code = "x"` form as well as a bare `Code` inside package herr
// itself, where the type needs no qualifier.
func isCodeType(expr ast.Expr, herrName, pkgName string) bool {
	switch typ := expr.(type) {
	case *ast.SelectorExpr:
		return herrName != "" && isSelector(typ, herrName, "Code")
	case *ast.Ident:
		return pkgName == "herr" && typ.Name == "Code"
	}
	return false
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

// docOf returns the doc comment belonging to one const.
//
// A const in a parenthesised block never inherits the block's doc: that comment
// describes the whole group ("Gateway-specific error codes."), not the member.
func docOf(gen *ast.GenDecl, value *ast.ValueSpec) string {
	switch {
	case value.Doc != nil:
		return value.Doc.Text()
	case value.Comment != nil:
		return value.Comment.Text()
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
