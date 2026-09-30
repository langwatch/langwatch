package workspace

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"

	"github.com/langwatch/langwatch/tools/internal/jsonc"
	"github.com/langwatch/langwatch/tools/internal/parallel"
)

// sourceExtensions is module-graph.ts SOURCE_EXTENSIONS, in its order.
var sourceExtensions = []string{".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"}

// exportConditions is the order a Node runtime picks conditions in; types last.
var exportConditions = []string{"node", "import", "require", "default", "types"}

// manifestDepth matches the deepest pnpm-workspace glob.
const manifestDepth = 4

// ManifestRecord is a workspace package as the resolver sees it.
type ManifestRecord struct {
	Name, Directory, ManifestPath, Main string
	Exports                             any
	HasExports                          bool
	Imports                             []importEntry
}

type importEntry struct {
	pattern string
	value   any
}

// Resolver is module-graph.ts createWorkspaceModuleResolver: workspace source
// through `exports`, private `#imports` and relative paths, memoised.
type Resolver struct {
	Packages    map[string]*ManifestRecord
	Order       []string // package names in discovery order
	byDirectory []*ManifestRecord
	resolutions sync.Map
	files       sync.Map
}

func readManifestRecord(path string) *ManifestRecord {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(data, &raw) != nil {
		return nil
	}
	m := Manifest{Raw: raw}
	name, ok := m.String("name")
	if !ok {
		return nil
	}
	record := &ManifestRecord{Name: name, Directory: filepath.Dir(path), ManifestPath: path}
	record.Main, _ = m.String("main")
	if exports, ok := raw["exports"]; ok {
		record.HasExports = json.Unmarshal(exports, &record.Exports) == nil && record.Exports != nil
	}
	record.Imports = importEntries(raw["imports"])
	return record
}

// importEntries is a manifest's `imports` map in source order; nil when it is not an object.
func importEntries(raw json.RawMessage) []importEntry {
	if len(raw) == 0 || raw[0] != '{' {
		return nil
	}
	var values map[string]any
	_ = json.Unmarshal(raw, &values)
	entries := []importEntry{}
	for _, key := range OrderedKeys(raw) {
		entries = append(entries, importEntry{key, values[key]})
	}
	return entries
}

// manifestPaths lists every package.json down to depth, in collectManifests order.
func manifestPaths(dir string, depth int, found *[]string) {
	if path := filepath.Join(dir, "package.json"); IsFile(path) {
		*found = append(*found, path)
	}
	if depth == 0 {
		return
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.IsDir() && !IsIgnoredDirectory(e.Name(), nil) {
			manifestPaths(filepath.Join(dir, e.Name()), depth-1, found)
		}
	}
}

// NewResolver collects the workspace manifests under root, reading them on every core.
func NewResolver(root string) *Resolver {
	var paths []string
	for _, workspaceRoot := range WorkspaceRoots {
		if dir := filepath.Join(root, workspaceRoot); Exists(dir) {
			manifestPaths(dir, manifestDepth, &paths)
		}
	}
	var found []*ManifestRecord
	for _, record := range parallel.Map(paths, readManifestRecord) {
		if record != nil {
			found = append(found, record)
		}
	}
	r := &Resolver{Packages: map[string]*ManifestRecord{}}
	for _, record := range found {
		if _, ok := r.Packages[record.Name]; !ok {
			r.Packages[record.Name] = record
			r.Order = append(r.Order, record.Name)
		}
	}
	r.byDirectory = append([]*ManifestRecord(nil), found...)
	sort.SliceStable(r.byDirectory, func(i, j int) bool { return len(r.byDirectory[i].Directory) > len(r.byDirectory[j].Directory) })
	return r
}

// OwningPackage is the workspace package that owns file, by longest directory.
func (r *Resolver) OwningPackage(file string) *ManifestRecord {
	for _, record := range r.byDirectory {
		if file == record.Directory || strings.HasPrefix(file, record.Directory+string(filepath.Separator)) {
			return record
		}
	}
	return nil
}

func (r *Resolver) isFile(path string) bool {
	if known, ok := r.files.Load(path); ok {
		return known.(bool)
	}
	is := IsFile(path)
	r.files.Store(path, is)
	return is
}

func resolvePath(base, target string) string {
	if filepath.IsAbs(target) {
		return filepath.Clean(target)
	}
	return filepath.Join(base, target)
}

// SourceCandidate is resolveSourceCandidate: the stem itself, with an
// extension, or its directory index; a ".js" stem also names the ".ts" source.
func (r *Resolver) SourceCandidate(candidate string) string {
	if found := r.stemCandidate(candidate); found != "" || !strings.HasSuffix(candidate, ".js") {
		return found
	}
	return r.stemCandidate(strings.TrimSuffix(candidate, ".js"))
}

func (r *Resolver) stemCandidate(stem string) string {
	if r.isFile(stem) {
		return stem
	}
	for _, ext := range sourceExtensions {
		if r.isFile(stem + ext) {
			return stem + ext
		}
	}
	for _, ext := range sourceExtensions {
		if path := filepath.Join(stem, "index"+ext); r.isFile(path) {
			return path
		}
	}
	return ""
}

func conditionTarget(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case map[string]any:
		return firstCondition(v)
	}
	return ""
}

// firstCondition is the target of the first export condition that has one.
func firstCondition(conditions map[string]any) string {
	for _, condition := range exportConditions {
		if inner, ok := conditions[condition]; ok {
			if target := conditionTarget(inner); target != "" {
				return target
			}
		}
	}
	return ""
}

// rootOnly answers a subpath of an exports value that describes only the root.
func rootOnly(subpath string, value any) string {
	if subpath == "." {
		return conditionTarget(value)
	}
	return ""
}

func subpathTarget(m *ManifestRecord, subpath string) string {
	if !m.HasExports {
		return rootOnly(subpath, m.Main)
	}
	record, isObject := m.Exports.(map[string]any)
	if !isObject {
		return rootOnly(subpath, m.Exports)
	}
	if !hasSubpaths(record) {
		return rootOnly(subpath, record)
	}
	if value, ok := record[subpath]; ok {
		return conditionTarget(value)
	}
	return rootOnly(subpath, m.Main)
}

func hasSubpaths(record map[string]any) bool {
	for key := range record {
		if strings.HasPrefix(key, ".") {
			return true
		}
	}
	return false
}

// packageName splits a bare specifier into its package name and subpath segments.
func packageName(specifier string) (name string, rest []string) {
	segments := strings.Split(specifier, "/")
	if !strings.HasPrefix(specifier, "@") {
		return segments[0], segments[1:]
	}
	if len(segments) < 2 {
		return segments[0] + "/undefined", nil
	}
	return segments[0] + "/" + segments[1], segments[2:]
}

func (r *Resolver) workspacePackage(specifier string) string {
	name, rest := packageName(specifier)
	manifest, ok := r.Packages[name]
	if name == "" || !ok {
		return ""
	}
	subpath := "."
	if len(rest) > 0 {
		subpath = "./" + strings.Join(rest, "/")
	}
	target := subpathTarget(manifest, subpath)
	if target == "" {
		return ""
	}
	return r.SourceCandidate(resolvePath(manifest.Directory, target))
}

func (r *Resolver) subpathImport(specifier, file string) string {
	owner := r.OwningPackage(file)
	if owner == nil || owner.Imports == nil {
		return ""
	}
	if i := slices.IndexFunc(owner.Imports, func(e importEntry) bool { return e.pattern == specifier }); i >= 0 {
		if target := conditionTarget(owner.Imports[i].value); target != "" {
			return r.SourceCandidate(resolvePath(owner.Directory, target))
		}
	}
	for _, entry := range owner.Imports {
		if target := wildcardTarget(entry, specifier); target != "" {
			return r.SourceCandidate(resolvePath(owner.Directory, target))
		}
	}
	return ""
}

// wildcardTarget fills entry's one `*` from specifier, or "" when it does not match.
func wildcardTarget(entry importEntry, specifier string) string {
	prefix, suffix, wildcard := strings.Cut(entry.pattern, "*")
	if !wildcard || !strings.HasPrefix(specifier, prefix) || !strings.HasSuffix(specifier, suffix) {
		return ""
	}
	target := conditionTarget(entry.value)
	if target == "" {
		return ""
	}
	return strings.Replace(target, "*", specifier[len(prefix):len(specifier)-len(suffix)], 1)
}

// Resolve is the file a specifier loads from file, or "" off the source tree.
func (r *Resolver) Resolve(specifier, file string) string {
	key := specifier
	switch {
	case strings.HasPrefix(specifier, "."):
		key = filepath.Dir(file) + "\x00" + specifier
	case strings.HasPrefix(specifier, "#"):
		dir := ""
		if owner := r.OwningPackage(file); owner != nil {
			dir = owner.Directory
		}
		key = dir + "\x00" + specifier
	}
	if known, ok := r.resolutions.Load(key); ok {
		return known.(string)
	}
	var resolved string
	switch {
	case strings.HasPrefix(specifier, "."):
		resolved = r.SourceCandidate(resolvePath(filepath.Dir(file), specifier))
	case strings.HasPrefix(specifier, "#"):
		resolved = r.subpathImport(specifier, file)
	default:
		resolved = r.workspacePackage(specifier)
	}
	r.resolutions.Store(key, resolved)
	return resolved
}

// ErrConfig is a tsconfig TypeScript would refuse to parse.
var ErrConfig = errors.New("invalid JSONC")

// Config reads a tsconfig-style JSONC file once per run: the TS enforcer read
// packages/api/tsconfig.build.json 420 times in one run.
func (s *Snapshot) Config(path string) (any, error) {
	type result struct {
		value any
		err   error
	}
	if known, ok := s.configs.Load(path); ok {
		return known.(result).value, known.(result).err
	}
	var out result
	data, err := os.ReadFile(path)
	if err != nil {
		out.err = err
	} else if json.Unmarshal([]byte(jsonc.Strip(strings.TrimPrefix(string(data), "\xef\xbb\xbf"))), &out.value) != nil {
		out.err = ErrConfig
	}
	s.configs.Store(path, out)
	return out.value, out.err
}
