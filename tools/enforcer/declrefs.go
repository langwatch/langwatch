package enforcer

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/tools/devscripts"
	"github.com/langwatch/langwatch/tools/internal/workspace"
)

// declaration-project-references (quality/declaration-project-references.ts).

const declarationPolicy = "declaration-project-references"

type project struct {
	file       string
	config     map[string]any
	references []string
}

// arrayOf reports whether value is an array of objects each holding key as a string.
func arrayOf(value any, key string) bool {
	items, ok := value.([]any)
	return ok && !slices.ContainsFunc(items, func(item any) bool {
		object, _ := item.(map[string]any)
		_, isString := object[key].(string)
		return !isString
	})
}

// optionalBooleans reports whether each key present in object is a boolean.
func optionalBooleans(object map[string]any, keys ...string) bool {
	return !slices.ContainsFunc(keys, func(key string) bool {
		value, present := object[key]
		_, isBool := value.(bool)
		return present && !isBool
	})
}

// validProjectConfig is the policy's zod configSchema.
func validProjectConfig(raw any) (map[string]any, bool) {
	config, ok := raw.(map[string]any)
	if !ok {
		return nil, false
	}
	if refs, present := config["references"]; present && !arrayOf(refs, "path") {
		return nil, false
	}
	if !optionalObject(config, "compilerOptions", func(o map[string]any) bool { return optionalBooleans(o, "emitDeclarationOnly", "noEmit") }) ||
		!optionalObject(config, "langwatchDeclarationGroup", func(o map[string]any) bool { return arrayOf(o["members"], "directory") }) {
		return nil, false
	}
	return config, true
}

// optionalObject reports whether config[key] is absent, or an object valid holds for.
func optionalObject(config map[string]any, key string, valid func(map[string]any) bool) bool {
	value, present := config[key]
	if !present {
		return true
	}
	object, ok := value.(map[string]any)
	return ok && valid(object)
}

func configPath(path string) string {
	if workspace.IsDir(path) {
		return filepath.Join(path, "tsconfig.json")
	}
	return path
}

func resolveFrom(dir, path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Join(dir, path)
}

// entries is each object's key, from an array validProjectConfig accepted.
func entries(value any, key string) []string {
	items, _ := value.([]any)
	out := make([]string, 0, len(items))
	for _, item := range items {
		object, _ := item.(map[string]any)
		text, _ := object[key].(string)
		out = append(out, text)
	}
	return out
}

// projectWalk is the policy's projectGraph: a depth-first read of the reference graph.
type projectWalk struct {
	s               *workspace.Snapshot
	projects        map[string]*project
	order           []string
	visited, active map[string]bool
	violations      []Violation
}

func (w *projectWalk) refuse(file, message string) {
	w.violations = append(w.violations, Violation{Policy: declarationPolicy, File: file, Message: message})
}

func (w *projectWalk) visit(file, referrer string) {
	switch {
	case w.active[file]:
		w.refuse(referrer, fmt.Sprintf("Declaration project references form a cycle through %s.", workspace.Relative(w.s.Root, file)))
		return
	case w.visited[file]:
		return
	}
	w.visited[file] = true
	if !workspace.Exists(file) {
		w.refuse(referrer, fmt.Sprintf("Declaration project reference does not exist: %s.", workspace.Relative(w.s.Root, file)))
		return
	}
	raw, err := w.s.Config(file)
	config, ok := validProjectConfig(raw)
	if err != nil || !ok {
		w.refuse(file, "Declaration project config must contain valid JSONC and project references.")
		return
	}
	p := &project{file: file, config: config}
	for _, path := range entries(config["references"], "path") {
		p.references = append(p.references, configPath(resolveFrom(filepath.Dir(file), path)))
	}
	w.projects[file] = p
	w.order = append(w.order, file)
	w.active[file] = true
	for _, target := range p.references {
		w.visit(target, file)
	}
	w.active[file] = false
}

func reachableProjects(start string, projects map[string]*project) map[string]bool {
	result := map[string]bool{}
	pending := []string{start}
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if current == "" || result[current] {
			continue
		}
		result[current] = true
		if p := projects[current]; p != nil {
			pending = append(pending, p.references...)
		}
	}
	return result
}

// syncReasons is what differs between the derived and the current references.
func syncReasons(p devscripts.Project) string {
	var reasons []string
	for _, entry := range p.References {
		if !slices.Contains(p.Current, entry) {
			reasons = append(reasons, "missing "+entry)
		}
	}
	for _, entry := range p.Current {
		if !slices.Contains(p.References, entry) {
			reasons = append(reasons, "extra "+entry)
		}
	}
	return strings.Join(reasons, ", ")
}

// referenceSync is lintReferenceSync, over devscripts' derivation.
func referenceSync(root string) ([]Violation, error) {
	members, err := devscripts.ReadWorkspaceMembers(root)
	if err != nil {
		return nil, err
	}
	var out []Violation
	for _, p := range devscripts.DeriveProjects(root, members) {
		detail := syncReasons(p)
		if detail == "" && strings.Join(p.References, " ") == strings.Join(p.Current, " ") {
			continue
		}
		if detail == "" {
			detail = "the derived order differs"
		}
		out = append(out, Violation{Policy: declarationPolicy, File: p.File,
			Message: fmt.Sprintf("Project references are out of sync with package.json: %s.", detail),
			Allowed: "Run pnpm sync:references, or record an entry no rule derives under langwatchExtraReferences."})
	}
	return out, nil
}

// producers maps each directory to the declaration-only project that emits it; later projects win.
func producers(w *projectWalk) map[string]string {
	byDirectory := map[string]string{}
	for _, file := range w.order {
		config := w.projects[file].config
		options, _ := config["compilerOptions"].(map[string]any)
		if options["emitDeclarationOnly"] != true || options["noEmit"] == true {
			continue
		}
		byDirectory[filepath.Dir(file)] = file
		group, _ := config["langwatchDeclarationGroup"].(map[string]any)
		for _, member := range entries(group["members"], "directory") {
			byDirectory[resolveFrom(filepath.Dir(file), member)] = file
		}
	}
	return byDirectory
}

// preparation checks that each package's producer reaches its dependencies' producers.
type preparation struct {
	s         *workspace.Snapshot
	projects  map[string]*project
	byName    map[string]string
	reachable map[string]map[string]bool
}

func (p *preparation) reach(producer string) map[string]bool {
	if p.reachable[producer] == nil {
		p.reachable[producer] = reachableProjects(producer, p.projects)
	}
	return p.reachable[producer]
}

func (p *preparation) unprepared(pkg *workspace.Package) []Violation {
	producer := p.byName[pkg.Name]
	if producer == "" {
		return nil
	}
	var out []Violation
	m := pkg.Manifest.Raw
	for _, name := range workspace.MergedKeys(m["dependencies"], m["optionalDependencies"], m["peerDependencies"]) {
		dependency := p.byName[name]
		// A dependency depending back would need a reference cycle; one direction goes unprepared.
		if dependency == "" || p.reach(producer)[dependency] || reachableProjects(dependency, p.projects)[producer] {
			continue
		}
		out = append(out, Violation{Policy: declarationPolicy, File: producer, Specifier: name,
			Message: pkg.Name + "'s declaration producer does not prepare this production dependency; missing outputs can pull implementation source into TypeScript consumers.",
			Allowed: fmt.Sprintf("Reference %s directly or through another project.", workspace.Relative(p.s.Root, dependency))})
	}
	return out
}

// DeclarationProjectReferences is lintDeclarationProjectReferences.
func DeclarationProjectReferences(s *workspace.Snapshot) ([]Violation, error) {
	solution, err := s.Anchor("dev/tsconfig.declarations.json", declarationPolicy)
	if err != nil {
		return nil, err
	}
	w := &projectWalk{s: s, projects: map[string]*project{}, visited: map[string]bool{}, active: map[string]bool{}}
	w.visit(solution, solution)
	byDirectory := producers(w)
	p := &preparation{s: s, projects: w.projects, byName: map[string]string{}, reachable: map[string]map[string]bool{}}
	for _, pkg := range s.Packages {
		p.byName[pkg.Name] = byDirectory[pkg.Root]
	}
	out := w.violations
	for _, pkg := range s.Packages {
		out = append(out, p.unprepared(pkg)...)
	}
	sync, err := referenceSync(s.Root)
	if err != nil {
		return nil, err
	}
	return append(out, sync...), nil
}
