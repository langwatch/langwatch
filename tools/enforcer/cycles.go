package enforcer

import (
	"slices"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/internal/workspace"
)

// cycles (boundaries/cycles.ts), reported under the policy name package-cycle.

func manifestDependencies(m workspace.Manifest) []string {
	return workspace.MergedKeys(m.Raw["dependencies"], m.Raw["peerDependencies"], m.Raw["optionalDependencies"])
}

// cycleWalk is the TS depth-first walk: first-seen package order, one string per cycle.
type cycleWalk struct {
	graph           map[string][]string
	active, visited map[string]bool
	stack           []string
	cycles          map[string]bool
}

func (w *cycleWalk) visit(name string) {
	if w.active[name] {
		start := slices.Index(w.stack, name)
		w.cycles[strings.Join(append(slices.Clone(w.stack[start:]), name), " -> ")] = true
		return
	}
	if w.visited[name] {
		return
	}
	w.visited[name], w.active[name] = true, true
	w.stack = append(w.stack, name)
	for _, target := range w.graph[name] {
		w.visit(target)
	}
	w.stack = w.stack[:len(w.stack)-1]
	w.active[name] = false
}

// packageGraph is each package's workspace dependencies, and the order names first appear in.
func packageGraph(s *workspace.Snapshot, byName map[string]*workspace.Package) (map[string][]string, []string) {
	graph, order := map[string][]string{}, []string{}
	for _, pkg := range s.Packages {
		if _, ok := graph[pkg.Name]; !ok {
			order = append(order, pkg.Name)
		}
		var edges []string
		for _, name := range manifestDependencies(pkg.Manifest) {
			if byName[name] != nil {
				edges = append(edges, name)
			}
		}
		graph[pkg.Name] = edges
	}
	return graph, order
}

// Cycles is lintCycles.
func Cycles(s *workspace.Snapshot) ([]Violation, error) {
	byName := map[string]*workspace.Package{}
	for _, pkg := range s.Packages {
		byName[pkg.Name] = pkg
	}
	graph, order := packageGraph(s, byName)
	w := &cycleWalk{graph: graph, active: map[string]bool{}, visited: map[string]bool{}, cycles: map[string]bool{}}
	for _, name := range order {
		w.visit(name)
	}
	sorted := make([]string, 0, len(w.cycles))
	for cycle := range w.cycles {
		sorted = append(sorted, cycle)
	}
	sort.Strings(sorted)
	out := make([]Violation, len(sorted))
	for i, cycle := range sorted {
		file := "package.json"
		if pkg := byName[strings.Split(cycle, " -> ")[0]]; pkg != nil {
			file = pkg.ManifestPath
		}
		out[i] = Violation{Policy: "package-cycle", File: file, Message: "Feature package dependency cycle: " + cycle}
	}
	return out, nil
}
