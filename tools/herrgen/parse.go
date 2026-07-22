// Package herrgen mirrors the Go services' handled-error codes into TypeScript.
//
// A code is Go syntax, so it is read with go/ast rather than matched with a
// regex — and read wherever it is written, not only where it is usually
// written: a const block, a standalone const, a `var` sentinel, a conversion
// inside a map or a function body, or a bare string literal handed to a herr
// constructor (herr.Code is a defined string type, so that compiles too). Each
// of those puts the same string on the wire, and one the generator cannot see is
// a code with no customer copy and a green drift check. A code it can see but
// cannot read stops the run rather than being passed over.
//
// HTTP statuses live somewhere else entirely (a RegisterStatuses func, usually
// next to the router), so they are resolved by finding every
// `herr.RegisterStatus(Name, http.StatusX)` call in the tree and mapping the
// const it names back to the code string it holds.
package herrgen

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
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
//
// The zero Declaration for an entry with none: Entry is exported, so a caller
// can hand Render one that Parse never built, and a panic three frames into the
// renderer is a worse answer than an entry with no name and no service.
func (e Entry) Primary() Declaration {
	if len(e.Declarations) == 0 {
		return Declaration{}
	}
	return e.Declarations[0]
}

// Parse walks root and returns every herr code declared under it as one Entry
// per distinct code string, plus every workflow NodeError.Type as one NodeCode
// per distinct code string, both sorted by code.
//
// It fails when two consts holding the same code string register different HTTP
// statuses: herr's registry is keyed by the string, so one of the two would
// silently win at runtime depending on init order.
//
// A file that does not parse fails the run, except under the hand-written
// onboarding snippets: those are documentation rendered into the product UI and
// are never compiled, so one of them changing shape must not take the drift
// check down. Anywhere else an unparseable file is a service file mid-refactor,
// and silently dropping its codes would commit a truncated artifact at exit 0.
func Parse(root string, warn io.Writer) ([]Entry, []NodeCode, error) {
	modulePath, err := readModulePath(root)
	if err != nil {
		return nil, nil, err
	}

	var (
		declarations  []Declaration
		registrations []Registration
		nodeSites     []nodeErrorSite
	)
	// byConst resolves a RegisterStatus argument (package dir + const name) back
	// to the code string that const holds.
	byConst := map[string]string{}

	files, err := goFiles(root)
	if err != nil {
		return nil, nil, err
	}

	fset := token.NewFileSet()
	for _, rel := range files {
		source, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			return nil, nil, fmt.Errorf("read %s: %w", rel, err)
		}
		// Parsed under its repository-relative name, so every position we report
		// later reads as a path someone can open.
		file, err := parser.ParseFile(fset, rel, source, parser.ParseComments)
		if err != nil {
			if !toleratesParseFailure(rel) {
				return nil, nil, fmt.Errorf("%s does not parse as Go: %w", rel, err)
			}
			fmt.Fprintf(warn, "herrgen: skipping %s, it does not parse as Go: %v\n", rel, err)
			continue
		}

		pkgDir := path.Dir(rel)
		imports := importsOf(file)

		// NodeError literals need no herr import — they are plain composite
		// literals in the engine package — so they are read from every file,
		// before the herr import gate below can skip one.
		nodeSites = append(nodeSites, fileNodeErrorSites(fset, file, rel, pkgDir, imports, modulePath)...)

		herrName, err := localNameFor(imports, modulePath+"/"+herrImportSuffix)
		if err != nil {
			return nil, nil, fmt.Errorf("%s: %w", rel, err)
		}
		if herrName == "" {
			// Neither a declaration nor a registration can appear without the
			// import, so there is nothing else here to read.
			continue
		}

		fileDecls, err := fileDeclarations(fset, file, herrName)
		if err != nil {
			return nil, nil, err
		}
		for _, decl := range fileDecls {
			decl.Source = rel
			decl.Service = serviceOf(rel)
			declarations = append(declarations, decl)
			if decl.Name != "" {
				byConst[pkgDir+"."+decl.Name] = decl.Code
			}
		}
		fileRegs, err := fileRegistrations(fset, file, herrName, pkgDir, imports, modulePath)
		if err != nil {
			return nil, nil, err
		}
		registrations = append(registrations, fileRegs...)
	}

	statuses, err := resolveStatuses(registrations, byConst)
	if err != nil {
		return nil, nil, err
	}
	resolvedNodeSites, err := resolveNodeErrorSites(nodeSites)
	if err != nil {
		return nil, nil, err
	}
	return group(declarations, statuses), groupNodeCodes(resolvedNodeSites), nil
}

// snippetSegment marks the hand-written Go under langwatch/ that is rendered
// into the onboarding UI rather than compiled.
const snippetSegment = "/codegen/snippets/"

// toleratesParseFailure reports whether a file failing to parse is expected.
// Only the onboarding snippets are: everywhere else the file is real, compiled
// Go, and dropping it would drop its codes.
func toleratesParseFailure(rel string) bool {
	return strings.HasPrefix(rel, "langwatch/") && strings.Contains(rel, snippetSegment)
}

// goFiles lists the repository-relative non-test Go files under root.
//
// testdata is skipped for the same reason the go tool skips it: the Go inside is
// a fixture, and its codes are not the product's. Everything else is walked,
// including langwatch/'s onboarding snippets — see toleratesParseFailure for the
// one place that costs us something.
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
		rel = filepath.ToSlash(rel)
		if entry.IsDir() {
			name := entry.Name()
			if rel != "." && (strings.HasPrefix(name, ".") || name == "node_modules" || name == "vendor" || name == "testdata") {
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

// localNameFor returns the local name a file imports importPath under, or "" if
// it does not import it at all.
//
// A dot import is rejected rather than reported as ".": every read below matches
// a `herr.X` selector, which a dot import erases, so the file's codes would
// vanish from the generated output without a word.
func localNameFor(imports map[string]string, importPath string) (string, error) {
	for name, candidate := range imports {
		if candidate != importPath {
			continue
		}
		if name == "." {
			return "", fmt.Errorf(
				"dot-imports %s; herrgen reads codes as `herr.Code(...)` selectors and cannot see them without the qualifier",
				importPath,
			)
		}
		return name, nil
	}
	return "", nil
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
