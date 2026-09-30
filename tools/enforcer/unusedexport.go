package enforcer

import (
	"fmt"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/internal/parallel"
	"github.com/langwatch/langwatch/tools/internal/workspace"
)

// unused-module-export (quality/unused-module-export.ts).

const everyName = "*"

var (
	tsSource       = regexp.MustCompile(`\.tsx?$`)
	generatedTS    = regexp.MustCompile(`\.generated\.tsx?$`)
	testName       = regexp.MustCompile(`\.(?:test|spec)\.tsx?$`)
	configModule   = regexp.MustCompile(`\.config\.tsx?$`)
	skippedFolders = map[string]bool{"__tests__": true, "__mocks__": true, "generated": true, "testing": true}
)

func isUnusedSource(path string) bool {
	name := filepath.Base(path)
	return tsSource.MatchString(name) && !strings.HasSuffix(name, ".d.ts") && !generatedTS.MatchString(name)
}

func isTestModule(path string) bool {
	name := filepath.Base(path)
	if testName.MatchString(name) || name == "testing.ts" || strings.HasSuffix(name, ".testing.ts") {
		return true
	}
	return slices.ContainsFunc(strings.Split(path, string(filepath.Separator)), func(s string) bool { return skippedFolders[s] })
}

func isModuleServerSource(root, path string) bool {
	parts := strings.Split(workspace.Relative(root, path), string(filepath.Separator))
	server := slices.Index(parts, "process")
	return server >= 1 && server+1 < len(parts) && parts[server+1] == "src"
}

type use struct{ target, name string }

// reader resolves one source's specifiers to the workspace files it reads.
type reader struct {
	s    *workspace.Snapshot
	file string
}

func (r reader) target(specifier string) string {
	if strings.HasPrefix(specifier, "node:") {
		return ""
	}
	if to := r.s.Resolver.Resolve(specifier, r.file); to != r.file {
		return to
	}
	return ""
}

// uses is every (file, name) the source reads: named, namespace and star
// references, and every dynamic import as a read of the whole module.
func (r reader) uses() []use {
	facts := r.s.Facts(r.file)
	if facts == nil {
		return nil
	}
	var uses []use
	for _, ref := range facts.References {
		uses = append(uses, referenceUses(r.target(ref.Specifier), ref.Names, ref.Every)...)
	}
	for _, imp := range facts.Imports {
		if imp.Dynamic {
			uses = append(uses, referenceUses(r.target(imp.Specifier), nil, true)...)
		}
	}
	return uses
}

func referenceUses(target string, names []string, every bool) []use {
	if target == "" {
		return nil
	}
	uses := make([]use, 0, len(names)+1)
	if every {
		uses = append(uses, use{target, everyName})
	}
	for _, name := range names {
		uses = append(uses, use{target, name})
	}
	return uses
}

// sourcesUnder lists the files under roots the filter keeps.
func sourcesUnder(s *workspace.Snapshot, roots []string, keep func(string) bool) []string {
	var out []string
	for _, root := range roots {
		for _, path := range s.Files(filepath.Join(s.Root, root)) {
			if keep(path) {
				out = append(out, path)
			}
		}
	}
	return out
}

// usageGraph is which names each file is read for, across the repository.
func usageGraph(s *workspace.Snapshot) map[string]map[string]bool {
	sources := sourcesUnder(s, workspace.SourceRoots, isUnusedSource)
	usage := map[string]map[string]bool{}
	for _, uses := range parallel.Map(sources, func(file string) []use { return reader{s, file}.uses() }) {
		for _, u := range uses {
			if usage[u.target] == nil {
				usage[u.target] = map[string]bool{}
			}
			usage[u.target][u.name] = true
		}
	}
	return usage
}

type unusedRow struct{ path, name string }

// unusedIn is the names file publishes that nothing reads.
func unusedIn(s *workspace.Snapshot, file string, read map[string]bool) []unusedRow {
	if strings.HasPrefix(filepath.Base(file), "index.") || isTestModule(file) || read[everyName] {
		return nil
	}
	facts := s.Facts(file)
	if facts == nil {
		return nil
	}
	config := configModule.MatchString(filepath.Base(file))
	var rows []unusedRow
	for _, name := range facts.Exports {
		if !read[name] && (!config || name != "default") {
			rows = append(rows, unusedRow{workspace.Relative(s.Root, file), name})
		}
	}
	return rows
}

// UnusedModuleExports is lintUnusedModuleExports.
func UnusedModuleExports(s *workspace.Snapshot) ([]Violation, error) {
	declared := sourcesUnder(s, []string{"modules", filepath.Join("enterprise", "modules")}, func(path string) bool {
		return isUnusedSource(path) && isModuleServerSource(s.Root, path)
	})
	if len(declared) == 0 {
		return nil, nil
	}
	usage := usageGraph(s)
	var rows []unusedRow
	for _, file := range declared {
		rows = append(rows, unusedIn(s, file, usage[file])...)
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].path+"|"+rows[i].name < rows[j].path+"|"+rows[j].name })
	out := make([]Violation, len(rows))
	for i, r := range rows {
		out[i] = Violation{Policy: "unused-module-export", File: filepath.Join(s.Root, r.path),
			Message: fmt.Sprintf("`%s` exports `%s` and no file in the repository imports it, not even the package's own index. "+
				"An export nothing reads is a name the next author has to rule out before touching this file.", filepath.Base(r.path), r.name),
			Allowed: "Delete the export, or drop the `export` keyword if the file uses the declaration itself. " +
				"If it is meant to be part of the package's surface, export it from `index.ts`, where " +
				"`composed-exports` can see whether anything composes it."}
	}
	return out, nil
}
