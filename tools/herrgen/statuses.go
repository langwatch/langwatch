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

// fileRegistrations returns the RegisterStatus calls in one file, with the const
// each one names resolved to the package it was declared in.
func fileRegistrations(
	fset *token.FileSet,
	file *ast.File,
	herrName, pkgDir string,
	imports map[string]string,
	modulePath string,
) []Registration {
	var found []Registration
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || len(call.Args) != 2 || !isSelector(call.Fun, herrName, "RegisterStatus") {
			return true
		}
		key, ok := constKey(call.Args[0], pkgDir, imports, modulePath)
		if !ok {
			return true
		}
		status, ok := statusValue(call.Args[1], imports)
		if !ok {
			return true
		}
		position := fset.Position(call.Pos())
		found = append(found, Registration{
			Code:   key,
			Status: status,
			Source: fmt.Sprintf("%s:%d", filepath.ToSlash(position.Filename), position.Line),
		})
		return true
	})
	return found
}

// constKey renders the const a RegisterStatus call names as "pkgDir.ConstName",
// resolving a qualified `domain.ErrX` through the file's imports.
func constKey(expr ast.Expr, pkgDir string, imports map[string]string, modulePath string) (string, bool) {
	switch arg := expr.(type) {
	case *ast.Ident:
		return pkgDir + "." + arg.Name, true
	case *ast.SelectorExpr:
		qualifier, ok := arg.X.(*ast.Ident)
		if !ok {
			return "", false
		}
		importPath, ok := imports[qualifier.Name]
		if !ok || !strings.HasPrefix(importPath, modulePath+"/") {
			return "", false
		}
		return strings.TrimPrefix(importPath, modulePath+"/") + "." + arg.Sel.Name, true
	}
	return "", false
}

// statusValue resolves the status argument, either a net/http constant or a
// plain integer literal.
func statusValue(expr ast.Expr, imports map[string]string) (int, bool) {
	switch arg := expr.(type) {
	case *ast.BasicLit:
		if arg.Kind != token.INT {
			return 0, false
		}
		status, err := strconv.Atoi(arg.Value)
		if err != nil {
			return 0, false
		}
		return status, true
	case *ast.SelectorExpr:
		qualifier, ok := arg.X.(*ast.Ident)
		if !ok || imports[qualifier.Name] != "net/http" {
			return 0, false
		}
		status, ok := httpStatuses[arg.Sel.Name]
		return status, ok
	}
	return 0, false
}

// resolveStatuses maps each code string to its registered status, failing when
// two registrations disagree.
func resolveStatuses(registrations []Registration, byConst map[string]string) (map[string]Registration, error) {
	statuses := map[string]Registration{}
	var conflicts []string
	for _, registration := range registrations {
		code, ok := byConst[registration.Code]
		if !ok {
			// The const is not a herr.Code we know — a local alias, or a code
			// declared somewhere the walk does not reach. Nothing to attach.
			continue
		}
		registration.Code = code
		existing, seen := statuses[code]
		switch {
		case !seen:
			statuses[code] = registration
		case existing.Status != registration.Status:
			conflicts = append(conflicts, fmt.Sprintf(
				"code %q is registered as %d at %s and as %d at %s",
				code, existing.Status, existing.Source, registration.Status, registration.Source,
			))
		}
	}
	if len(conflicts) > 0 {
		slices.Sort(conflicts)
		return nil, fmt.Errorf(
			"conflicting HTTP statuses (herr's registry is keyed by the code string, so one would silently win):\n  %s",
			strings.Join(conflicts, "\n  "),
		)
	}
	return statuses, nil
}
