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

// nodeErrorType is the composite-literal type whose `Type` field is mirrored.
// The nlpgo engine returns a failed node's error as a `NodeError{Type: "..."}`
// literal, so the codes are read from those literals rather than from any const.
const nodeErrorType = "NodeError"

// nodeErrorPackageDir is the repository-relative package that declares it.
//
// Pinned for the same reason herrImportSuffix is. Matching a bare `NodeError`
// identifier anywhere would let any type that happens to share the name
// contribute codes to a union documented as the engine's, and would still miss a
// qualified `engine.NodeError{...}` written from another package — which is the
// form the adapters use.
const nodeErrorPackageDir = "services/nlpgo/app/engine"

// NodeCode is one workflow NodeError.Type produced by the nlpgo engine, folded
// across every literal that uses it.
type NodeCode struct {
	// Code is the Type string, e.g. "http_error".
	Code string
	// Sources are the repository-relative files a NodeError literal with this
	// Type appears in, sorted and deduplicated.
	Sources []string
}

// nodeErrorSite is one NodeError literal found in the tree. Many sites share a
// code; groupNodeCodes folds them.
type nodeErrorSite struct {
	// Code is the Type string the literal holds, empty when Readable is false.
	Code string
	// Source is the repository-relative file the literal appears in.
	Source string
	// Package is the repository-relative directory the literal's type resolves
	// to: the file's own directory for a bare `NodeError`, the imported
	// package's directory for a qualified `engine.NodeError`. Only sites whose
	// package actually declares the type are kept.
	Package string
	// Position is "path:line", so an unreadable site can be named.
	Position string
	// Readable is false when the literal sets a `Type` that is not a string
	// literal — a code that reaches the client and that herrgen cannot mirror.
	Readable bool
}

// fileNodeErrorSites returns one site per NodeError composite literal in file.
//
// Both `NodeError{...}` and `&NodeError{...}` are read: the address-of wraps the
// same composite literal, which ast.Inspect visits either way. So is a qualified
// `engine.NodeError{...}` from another package, resolved through the file's
// imports — matching on the bare identifier alone would both miss those and
// count any unrelated type that happens to be called NodeError.
func fileNodeErrorSites(
	fset *token.FileSet,
	file *ast.File,
	source, pkgDir string,
	imports map[string]string,
	modulePath string,
) []nodeErrorSite {
	var sites []nodeErrorSite
	ast.Inspect(file, func(node ast.Node) bool {
		lit, ok := node.(*ast.CompositeLit)
		if !ok {
			return true
		}
		pkg, ok := nodeErrorPackage(lit.Type, pkgDir, imports, modulePath)
		if !ok {
			return true
		}
		code, found, readable := nodeErrorTypeField(lit)
		if !found {
			// The literal sets no Type at all — a partially built value whose
			// Type is assigned elsewhere. It carries no code to read here.
			return true
		}
		position := fset.Position(lit.Pos())
		sites = append(sites, nodeErrorSite{
			Code:     code,
			Source:   source,
			Package:  pkg,
			Position: fmt.Sprintf("%s:%d", filepath.ToSlash(position.Filename), position.Line),
			Readable: readable,
		})
		return true
	})
	return sites
}

// nodeErrorPackage reports the package directory a composite literal's type
// resolves to, when that type is named NodeError.
func nodeErrorPackage(expr ast.Expr, pkgDir string, imports map[string]string, modulePath string) (string, bool) {
	switch named := expr.(type) {
	case *ast.Ident:
		if named.Name != nodeErrorType {
			return "", false
		}
		return pkgDir, true
	case *ast.SelectorExpr:
		if named.Sel.Name != nodeErrorType {
			return "", false
		}
		qualifier, ok := named.X.(*ast.Ident)
		if !ok {
			return "", false
		}
		importPath, ok := imports[qualifier.Name]
		if !ok || !strings.HasPrefix(importPath, modulePath+"/") {
			return "", false
		}
		return strings.TrimPrefix(importPath, modulePath+"/"), true
	}
	return "", false
}

// nodeErrorTypeField reads the string a NodeError's `Type: "..."` field holds.
//
// found is false when the literal sets no Type at all. readable is false when it
// sets one that is not a string literal: a code forwarded from somewhere else
// still reaches the client, so herrgen reports it rather than dropping it — the
// pass-through belongs at the Go boundary, normalised onto a code that exists.
func nodeErrorTypeField(lit *ast.CompositeLit) (code string, found, readable bool) {
	for _, element := range lit.Elts {
		kv, ok := element.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		if key, ok := kv.Key.(*ast.Ident); !ok || key.Name != "Type" {
			continue
		}
		literal, ok := kv.Value.(*ast.BasicLit)
		if !ok || literal.Kind != token.STRING {
			return "", true, false
		}
		unquoted, err := strconv.Unquote(literal.Value)
		if err != nil {
			return "", true, false
		}
		return unquoted, true, true
	}
	return "", false, false
}

// resolveNodeErrorSites keeps the sites whose type resolves to the engine's
// NodeError, and fails on any of those whose Type it could not read.
func resolveNodeErrorSites(sites []nodeErrorSite) ([]nodeErrorSite, error) {
	var (
		kept       []nodeErrorSite
		unreadable []string
	)
	for _, site := range sites {
		if site.Package != nodeErrorPackageDir {
			continue
		}
		if !site.Readable {
			unreadable = append(unreadable, site.Position)
			continue
		}
		kept = append(kept, site)
	}
	if len(unreadable) > 0 {
		slices.Sort(unreadable)
		return nil, fmt.Errorf(
			"NodeError literals whose Type is not a string literal (the code still reaches the client, "+
				"so it cannot be generated and would ship with no customer copy):\n  %s\n"+
				"Normalise the upstream error onto a NodeError code written as a literal.",
			strings.Join(unreadable, "\n  "),
		)
	}
	return kept, nil
}

// groupNodeCodes folds the sites into one NodeCode per code string, its Sources
// sorted and deduplicated, and the codes sorted by string — so the same tree
// always renders the same bytes, whatever order the walk visited files in.
func groupNodeCodes(sites []nodeErrorSite) []NodeCode {
	bySources := map[string][]string{}
	for _, site := range sites {
		bySources[site.Code] = append(bySources[site.Code], site.Source)
	}

	codes := make([]NodeCode, 0, len(bySources))
	for code, sources := range bySources {
		slices.Sort(sources)
		codes = append(codes, NodeCode{Code: code, Sources: slices.Compact(sources)})
	}
	slices.SortFunc(codes, func(a, b NodeCode) int { return strings.Compare(a.Code, b.Code) })
	return codes
}
