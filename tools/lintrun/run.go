package lintrun

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sync"
)

const (
	upstreamFallback = "origin/feat/strict-feature-layout-v0"
	unionConfig      = ".oxlintrc.jsonc"
	typesConfig      = ".oxlintrc.types.jsonc"
)

var (
	plainConfigs = []string{".oxlintrc.native.jsonc", ".oxlintrc.plugin.jsonc"}
	typedConfigs = append(slices.Clone(plainConfigs), typesConfig)
)

// request is one invocation's flags. base is nil when --base was not given.
type request struct {
	changed, types bool
	base           *string
	files          []string // the changed files, under --changed
}

func (q request) scoped() bool { return q.changed || q.base != nil }

func (q request) configs() []string {
	if q.types {
		return typedConfigs
	}
	return plainConfigs
}

// lockedWriter keeps the parallel oxlint processes' writes to one stderr whole.
type lockedWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}

// exitError carries an exit status out of the run without printing anything more.
type exitError struct{ status int }

func (e exitError) Error() string { return fmt.Sprintf("exit %d", e.status) }

type runner struct {
	ctx    context.Context
	root   string
	oxlint string
	stderr io.Writer
}

// Run is `lintrun [--changed] [--types] [--base <sha>]`; it returns the exit status.
func Run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("lintrun", flag.ContinueOnError)
	flags.SetOutput(stderr)
	changed := flags.Bool("changed", false, "lint what changed since the merge base")
	types := flags.Bool("types", false, "add the type-aware rules, over the typed projects")
	base := flags.String("base", "", "lint what changed since this commit")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	q := request{changed: *changed, types: *types}
	flags.Visit(func(f *flag.Flag) {
		if f.Name == "base" {
			q.base = base
		}
	})
	stderr = &lockedWriter{w: stderr}
	status, err := run(q, stdout, stderr)
	var exit exitError
	if errors.As(err, &exit) {
		return exit.status
	}
	if err != nil {
		fmt.Fprintf(stderr, "lintrun: %v\n", err)
		return 1
	}
	return status
}

func run(q request, stdout, stderr io.Writer) (int, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return 0, err
	}
	root, err := workspaceRoot(cwd)
	if err != nil {
		return 0, err
	}
	r := runner{ctx: context.Background(), root: root, oxlint: filepath.Join(root, "node_modules", ".bin", "oxlint"), stderr: stderr}
	if q.changed {
		if q.files = r.changedFiles(r.mergeBase()); len(q.files) == 0 {
			return 0, nil
		}
	}
	diagnostics, failed, err := r.lintScope(q)
	if err != nil {
		return 0, err
	}
	SortByPosition(diagnostics)
	if _, err := io.WriteString(stdout, Summary(diagnostics)); err != nil {
		return 0, err
	}
	if len(diagnostics) == 0 && !failed {
		return 0, nil
	}
	return 1, nil
}

// lintScope runs every config over the scope; failed is true when a process did not report.
func (r runner) lintScope(q request) (diagnostics []Diagnostic, failed bool, err error) {
	ignored, err := r.ignoreArgs()
	if err != nil {
		return nil, false, err
	}
	paths, err := r.scope(q)
	if err != nil {
		return nil, false, err
	}
	if len(paths) > 0 {
		reports, ok := r.lintAll(q.configs(), append(ignored, paths...))
		if ok {
			diagnostics = MergeDiagnostics(reports)
		}
		failed = !ok
	}
	if !q.types {
		diagnostics, err = r.judged(diagnostics)
	}
	return diagnostics, failed, err
}

// scope is what each process lints: the typed projects a change reached, or the plain scope.
func (r runner) scope(q request) ([]string, error) {
	if q.types {
		return r.typedRoots(q)
	}
	if !q.scoped() {
		return []string{"."}, nil
	}
	files := q.files
	if !q.changed {
		files = r.changedFiles(*q.base)
	}
	nxJSON, err := os.ReadFile(filepath.Join(r.root, "nx.json"))
	if err != nil {
		return nil, err
	}
	globals, err := LintGlobals(nxJSON)
	if err != nil {
		return nil, err
	}
	return PlainScope(files, globals, r.exists), nil
}

func (r runner) exists(file string) bool {
	_, err := os.Stat(filepath.Join(r.root, file))
	return err == nil
}

// judged drops the unused-directive reports a run without the type-aware rules cannot judge.
func (r runner) judged(diagnostics []Diagnostic) ([]Diagnostic, error) {
	typeOnly, err := r.typeOnlyRules()
	if err != nil {
		return nil, err
	}
	kept := []Diagnostic{}
	for _, d := range diagnostics {
		var source []byte
		if d.Code == nil && unused.MatchString(d.Message) {
			if source, err = os.ReadFile(filepath.Join(r.root, d.Filename)); err != nil {
				return nil, err
			}
		}
		if JudgedWithoutTypes(d, source, typeOnly) {
			kept = append(kept, d)
		}
	}
	return kept, nil
}

// typedRoots is the typed workspace members a change reached, dependents included;
// every typed member when unscoped.
func (r runner) typedRoots(q request) ([]string, error) {
	workspace, err := os.ReadFile(filepath.Join(r.root, "pnpm-workspace.yaml"))
	if err != nil {
		return nil, err
	}
	members, err := MemberRoots(r.root, MemberPatterns(workspace))
	if err != nil {
		return nil, err
	}
	typed := slices.DeleteFunc(members, func(m string) bool { return !r.exists(filepath.Join(m, "tsconfig.json")) })
	if !q.scoped() {
		return typed, nil
	}
	names, err := r.affectedProjects(q)
	if err != nil {
		return nil, err
	}
	return AffectedRoots(typed, names, r.packageName)
}

// AffectedRoots keeps the members whose package name nx listed as affected.
func AffectedRoots(members, affected []string, nameOf func(string) (string, error)) ([]string, error) {
	kept := []string{}
	for _, member := range members {
		name, err := nameOf(member)
		if err != nil {
			return nil, err
		}
		if slices.Contains(affected, name) {
			kept = append(kept, member)
		}
	}
	return kept, nil
}

// workspaceRoot is the nearest ancestor of dir holding pnpm-workspace.yaml.
func workspaceRoot(dir string) (string, error) {
	for {
		if _, err := os.Stat(filepath.Join(dir, "pnpm-workspace.yaml")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("no pnpm-workspace.yaml above the working directory")
		}
		dir = parent
	}
}
