// Package herrgen mirrors the Go services' handled-error codes into TypeScript.
//
// A code is Go syntax — `Name = herr.Code("name")`, in a const block or on its
// own, with a doc comment of any length — so it is read with go/ast rather than
// matched with a regex. HTTP statuses live somewhere else entirely (a
// RegisterStatuses func, usually next to the router), so they are resolved by
// finding every `herr.RegisterStatus(Name, http.StatusX)` call in the tree and
// mapping the const it names back to the code string it holds.
package herrgen

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// herrImportSuffix locates, relative to the module path, the package whose
// Code/RegisterStatus calls are read. Joining it to the module read from go.mod
// means a fork or a module rename needs no edit here.
const herrImportSuffix = "pkg/herr"

// Declaration is one `Name = herr.Code("code")` const in the tree.
type Declaration struct {
	// Name is the Go const identifier, e.g. ErrConversationBusy.
	Name string
	// Code is the code string it holds, e.g. "conversation_busy".
	Code string
	// Doc is the engineer-facing Go doc comment, already stripped of comment
	// markers. Empty when the const carries none.
	Doc string
	// Source is the repository-relative file the const is declared in.
	Source string
	// Service is the owning service, derived from Source.
	Service string
}

// Registration is one `herr.RegisterStatus(Name, status)` call.
type Registration struct {
	// Code is the code string the named const holds.
	Code string
	// Status is the HTTP status registered for it.
	Status int
	// Source is "path:line", so a conflict can name both sides.
	Source string
}

// Entry is one generated code: every declaration of a single code string, plus
// the status registered for it. Statuses are keyed by code string in herr's
// process-global registry, so two consts holding the same string share one
// status whether or not both register it.
type Entry struct {
	Code string
	// Declarations are sorted with the one the doc comes from first.
	Declarations []Declaration
	// Status is the registered HTTP status; only meaningful when HasStatus.
	Status int
	// HasStatus is false when nothing in the tree registers this code. No
	// status is invented for it — the entry simply carries none.
	HasStatus bool
}

// Primary is the declaration the doc comment and service name come from.
func (e Entry) Primary() Declaration { return e.Declarations[0] }

// Parse walks root and returns every herr code declared under it, one Entry per
// distinct code string, sorted by code.
//
// It fails when two consts holding the same code string register different HTTP
// statuses: herr's registry is keyed by the string, so one of the two would
// silently win at runtime depending on init order.
func Parse(root string) ([]Entry, error) {
	modulePath, err := readModulePath(root)
	if err != nil {
		return nil, err
	}

	var (
		declarations  []Declaration
		registrations []Registration
	)
	// byConst resolves a RegisterStatus argument (package dir + const name) back
	// to the code string that const holds.
	byConst := map[string]string{}

	files, err := goFiles(root)
	if err != nil {
		return nil, err
	}

	fset := token.NewFileSet()
	for _, rel := range files {
		source, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", rel, err)
		}
		// Parsed under its repository-relative name, so every position we report
		// later reads as a path someone can open.
		file, err := parser.ParseFile(fset, rel, source, parser.ParseComments)
		if err != nil {
			return nil, fmt.Errorf("parse %s: %w", rel, err)
		}

		imports := importsOf(file)
		herrName := localNameFor(imports, modulePath+"/"+herrImportSuffix)
		if herrName == "" {
			// Neither a declaration nor a registration can appear without the
			// import, so there is nothing here to read.
			continue
		}

		pkgDir := path.Dir(rel)
		for _, decl := range fileDeclarations(file, herrName) {
			decl.Source = rel
			decl.Service = serviceOf(rel)
			declarations = append(declarations, decl)
			byConst[pkgDir+"."+decl.Name] = decl.Code
		}
		registrations = append(registrations, fileRegistrations(fset, file, herrName, pkgDir, imports, modulePath)...)
	}

	statuses, err := resolveStatuses(registrations, byConst)
	if err != nil {
		return nil, err
	}
	return group(declarations, statuses), nil
}

// goFiles lists the repository-relative non-test Go files under root.
//
// testdata is skipped for the same reason the go tool skips it: the Go inside is
// a fixture, and its codes are not the product's.
func goFiles(root string) ([]string, error) {
	var files []string
	err := filepath.WalkDir(root, func(abs string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, relErr := filepath.Rel(root, abs)
		if relErr != nil {
			return relErr
		}
		if entry.IsDir() {
			name := entry.Name()
			if rel == "." {
				return nil
			}
			if strings.HasPrefix(name, ".") || name == "node_modules" || name == "vendor" || name == "testdata" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(rel, ".go") || strings.HasSuffix(rel, "_test.go") {
			return nil
		}
		files = append(files, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return nil, err
	}
	slices.Sort(files)
	return files, nil
}

// fileDeclarations returns the herr codes declared in one file.
func fileDeclarations(file *ast.File, herrName string) []Declaration {
	var found []Declaration
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
	literal, ok := call.Args[0].(*ast.BasicLit)
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

// serviceOf names the service a source path belongs to: the segment under
// services/, pkg/, cmd/, tools/ or internal/, and the leading segment otherwise.
func serviceOf(source string) string {
	segments := strings.Split(source, "/")
	if len(segments) < 2 {
		return strings.TrimSuffix(segments[0], ".go")
	}
	switch segments[0] {
	case "services", "pkg", "cmd", "tools", "internal":
		return segments[1]
	}
	return segments[0]
}

func isSelector(expr ast.Expr, qualifier, name string) bool {
	selector, ok := expr.(*ast.SelectorExpr)
	if !ok || selector.Sel.Name != name {
		return false
	}
	ident, ok := selector.X.(*ast.Ident)
	return ok && ident.Name == qualifier
}

// importsOf maps each import's local name to its path.
func importsOf(file *ast.File) map[string]string {
	imports := map[string]string{}
	for _, spec := range file.Imports {
		importPath, err := strconv.Unquote(spec.Path.Value)
		if err != nil {
			continue
		}
		name := path.Base(importPath)
		if spec.Name != nil {
			name = spec.Name.Name
		}
		imports[name] = importPath
	}
	return imports
}

func localNameFor(imports map[string]string, importPath string) string {
	for name, candidate := range imports {
		if candidate == importPath {
			return name
		}
	}
	return ""
}

var modulePattern = regexp.MustCompile(`(?m)^module\s+(\S+)\s*$`)

func readModulePath(root string) (string, error) {
	raw, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		return "", fmt.Errorf("read go.mod: %w", err)
	}
	match := modulePattern.FindSubmatch(raw)
	if match == nil {
		return "", fmt.Errorf("no module path in %s", filepath.Join(root, "go.mod"))
	}
	return string(match[1]), nil
}
