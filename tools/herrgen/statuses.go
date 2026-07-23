package herrgen

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
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
) ([]Registration, error) {
	var (
		found  []Registration
		errs   []string
		hasErr bool
	)
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || len(call.Args) != 2 || !isSelector(call.Fun, herrName, "RegisterStatus") {
			return true
		}
		key, ok := constKey(call.Args[0], pkgDir, imports, modulePath)
		if !ok {
			return true
		}
		position := fset.Position(call.Pos())
		status, err := statusValue(call.Args[1], imports)
		if err != nil {
			hasErr = true
			errs = append(errs, fmt.Sprintf("%s:%d: %v", filepath.ToSlash(position.Filename), position.Line, err))
			return true
		}
		found = append(found, Registration{
			Code:   key,
			Status: status,
			Source: fmt.Sprintf("%s:%d", filepath.ToSlash(position.Filename), position.Line),
		})
		return true
	})
	if hasErr {
		slices.Sort(errs)
		return nil, fmt.Errorf("unresolvable HTTP status:\n  %s", strings.Join(errs, "\n  "))
	}
	return found, nil
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
//
// Every other shape is an error. Reaching this function at all means the call
// is unmistakably a status registration, so a status we cannot read would emit a
// status-less entry that looks exactly like a code nobody registered — a silent
// lie in the generated file, whether the cause is a gap in httpStatuses or a
// local const, a variable, or a helper call standing in for the number. Both
// stop the run rather than quietly change the artifact.
func statusValue(expr ast.Expr, imports map[string]string) (int, error) {
	switch arg := expr.(type) {
	case *ast.BasicLit:
		if arg.Kind != token.INT {
			break
		}
		status, err := strconv.Atoi(arg.Value)
		if err != nil {
			break
		}
		return status, nil
	case *ast.SelectorExpr:
		qualifier, ok := arg.X.(*ast.Ident)
		if !ok || imports[qualifier.Name] != "net/http" {
			break
		}
		status, ok := httpStatuses[arg.Sel.Name]
		if !ok {
			return 0, fmt.Errorf(
				"http.%s is not in herrgen's status map; add it to httpStatuses in tools/herrgen/status.go",
				arg.Sel.Name,
			)
		}
		return status, nil
	}
	return 0, fmt.Errorf(
		"the HTTP status %s cannot be read by herrgen; register it as a net/http constant (http.StatusConflict) or a plain integer",
		types.ExprString(expr),
	)
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
