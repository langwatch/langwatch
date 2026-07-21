package herrgen

import (
	"go/ast"
	"go/token"
	"slices"
	"strconv"
	"strings"
)

// nodeErrorType is the composite-literal type whose `Type` field is mirrored.
// The nlpgo engine returns a failed node's error as a `NodeError{Type: "..."}`
// literal, so the codes are read from those literals rather than from any const.
const nodeErrorType = "NodeError"

// NodeCode is one workflow NodeError.Type produced by the nlpgo engine, folded
// across every literal that uses it.
type NodeCode struct {
	// Code is the Type string, e.g. "http_error".
	Code string
	// Sources are the repository-relative files a NodeError literal with this
	// Type appears in, sorted and deduplicated.
	Sources []string
}

// nodeErrorSite is one NodeError literal found in the tree: the Type it holds
// and the file it appears in. Many sites share a code; group folds them.
type nodeErrorSite struct {
	Code   string
	Source string
}

// fileNodeErrorSites returns one site per NodeError composite literal in file
// whose `Type` is a plain string constant, tagged with source.
//
// Both `NodeError{...}` and `&NodeError{...}` are read: the address-of wraps the
// same composite literal, which ast.Inspect visits either way. A literal whose
// Type is a non-literal (e.g. `Type: res.Error.Type`, forwarding an upstream
// code) carries nothing we can name, so it is skipped silently — the same
// posture the herr scanner takes for a non-literal Code argument.
func fileNodeErrorSites(file *ast.File, source string) []nodeErrorSite {
	var sites []nodeErrorSite
	ast.Inspect(file, func(node ast.Node) bool {
		lit, ok := node.(*ast.CompositeLit)
		if !ok {
			return true
		}
		if ident, ok := lit.Type.(*ast.Ident); !ok || ident.Name != nodeErrorType {
			return true
		}
		if code, ok := nodeErrorTypeField(lit); ok {
			sites = append(sites, nodeErrorSite{Code: code, Source: source})
		}
		return true
	})
	return sites
}

// nodeErrorTypeField reads the string a NodeError's `Type: "..."` field holds.
// It reports false when the field is absent or set to a non-string-literal.
func nodeErrorTypeField(lit *ast.CompositeLit) (string, bool) {
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
			return "", false
		}
		code, err := strconv.Unquote(literal.Value)
		if err != nil {
			return "", false
		}
		return code, true
	}
	return "", false
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
