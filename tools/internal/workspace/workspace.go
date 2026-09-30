// Package workspace is one reading of the repository for the Go tools: the
// feature catalogue, the classified workspace packages, the module resolver,
// file listings and per-file import facts, each read once per run. It ports
// packages/architecture-enforcer/src/workspace (snapshot.ts, layout.ts,
// module-graph.ts), so a Go policy and a TS policy see the same tree.
package workspace

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unsafe"

	"github.com/langwatch/langwatch/tools/internal/parallel"
	"github.com/langwatch/langwatch/tools/internal/tsscan"
)

// Violation is one finding, in the TS enforcer's ArchitectureViolation shape.
// File is absolute until the report makes it repository-relative.
type Violation struct {
	Policy    string `json:"policy"`
	File      string `json:"file"`
	Line      int    `json:"line,omitempty"`
	Specifier string `json:"specifier,omitempty"`
	Message   string `json:"message"`
	Allowed   string `json:"allowed,omitempty"`
}

// MissingAnchorError is a policy refusing to read a tree without its anchor file.
type MissingAnchorError struct{ Policy, Anchor string }

func (e *MissingAnchorError) Error() string {
	return fmt.Sprintf("%s: its anchor %s does not exist, so the policy cannot run.", e.Policy, e.Anchor)
}

// Anchor is the absolute path of a workspace-relative anchor file, or a MissingAnchorError.
func (s *Snapshot) Anchor(anchor, policy string) (string, error) {
	path := filepath.Join(s.Root, anchor)
	if !Exists(path) {
		return "", &MissingAnchorError{Policy: policy, Anchor: anchor}
	}
	return path, nil
}

// SourceRoots hold the TypeScript the workspace owns (layout.ts SOURCE_ROOTS).
var SourceRoots = []string{"apps", "enterprise", "mcp/typescript", "modules", "packages", "tools"}

// WorkspaceRoots are where a workspace package may be declared (layout.ts WORKSPACE_ROOTS).
var WorkspaceRoots = []string{"apps", "modules", "enterprise", "packages", "sdks", "mcp", "plugins", "services", "skills"}

var ignoredDirectories = map[string]bool{"coverage": true, "dist": true, "node_modules": true}

// IsIgnoredDirectory is layout.ts isIgnoredDirectory: dot directories and build output.
func IsIgnoredDirectory(name string, extra map[string]bool) bool {
	return strings.HasPrefix(name, ".") || ignoredDirectories[name] || extra[name]
}

// Snapshot is one reading of the workspace, built once and shared by every policy.
type Snapshot struct {
	Root                string
	Packages            []*Package
	Catalogue           []CatalogueEntry
	DiscoveryViolations []Violation
	Resolver            *Resolver

	listings  sync.Map // directory -> []string
	factsOnce sync.Once
	facts     map[string]*tsscan.File // filled once, in parallel; read-only after
	configs   sync.Map                // path -> config result
}

// Build reads the workspace at root.
func Build(root string) (*Snapshot, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	d, err := discover(abs)
	if err != nil {
		return nil, err
	}
	return &Snapshot{Root: abs, Packages: d.packages, Catalogue: d.catalogue, DiscoveryViolations: d.violations, Resolver: NewResolver(abs)}, nil
}

// Files lists every regular file under directory, sorted, skipping dot
// directories, coverage, dist and node_modules; one walk per directory per run.
func (s *Snapshot) Files(directory string) []string {
	if known, ok := s.listings.Load(directory); ok {
		return known.([]string)
	}
	found := WalkFiles(directory, nil)
	s.listings.Store(directory, found)
	return found
}

// WalkFiles is layout.ts walkFiles: symlinks are neither followed nor listed.
func WalkFiles(root string, extra map[string]bool) []string {
	var found []string
	if IsDir(root) {
		walkDir(root, extra, &found)
	}
	sort.Strings(found)
	return found
}

func walkDir(dir string, extra map[string]bool, found *[]string) {
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		path := filepath.Join(dir, e.Name())
		switch {
		case e.IsDir() && !IsIgnoredDirectory(e.Name(), extra):
			walkDir(path, extra, found)
		case e.Type().IsRegular():
			*found = append(*found, path)
		}
	}
}

// prefilled is whether scanSources scans a path up front: the .ts and .tsx the
// policies read. JavaScript (an 8 MB generated validator) is scanned on ask.
func prefilled(path string) bool {
	ext := filepath.Ext(path)
	return ext == ".ts" || ext == ".tsx"
}

// scanSources reads and scans every source file under the source roots on
// every core, once, so Facts is a read-only lookup afterwards.
func (s *Snapshot) scanSources() {
	listings := parallel.Map(SourceRoots, func(source string) []string { return s.Files(filepath.Join(s.Root, source)) })
	var paths []string
	for _, listing := range listings {
		for _, path := range listing {
			if prefilled(path) {
				paths = append(paths, path)
			}
		}
	}
	scanned := parallel.Map(paths, scanFile)
	s.facts = make(map[string]*tsscan.File, len(paths))
	for i, path := range paths {
		s.facts[path] = scanned[i]
	}
}

func scanFile(path string) *tsscan.File {
	src, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	// No copy: the scan clones every string it keeps, and src is never written.
	return tsscan.Scan(unsafe.String(unsafe.SliceData(src), len(src)), tsscan.JSXFor(path))
}

// Facts is the scan of one file, or nil when it cannot be read (a file a
// codemod deleted between the listing and the read is not in the tree). The
// first call scans every prefilled file; any other (a resolved .json, .mjs or
// sdks/ source) is scanned on each ask.
func (s *Snapshot) Facts(path string) *tsscan.File {
	s.factsOnce.Do(s.scanSources)
	if facts, ok := s.facts[path]; ok {
		return facts
	}
	return scanFile(path)
}

// Exists is existsSync.
func Exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// IsFile is existsSync(path) && statSync(path).isFile().
func IsFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// IsDir is existsSync(path) && statSync(path).isDirectory().
func IsDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// OrderedKeys lists a JSON object's keys in source order, as Object.keys does
// (integer-like keys aside); anything but an object has none.
func OrderedKeys(raw json.RawMessage) []string {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil
	}
	var keys []string
	seen := map[string]bool{}
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return keys
		}
		key, _ := tok.(string)
		var skip json.RawMessage
		if dec.Decode(&skip) != nil {
			return keys
		}
		if !seen[key] {
			seen[key] = true
			keys = append(keys, key)
		}
	}
	return keys
}

// MergedKeys is Object.keys({...a, ...b, ...c}): each key once, at its first position.
func MergedKeys(objects ...json.RawMessage) []string {
	var keys []string
	seen := map[string]bool{}
	for _, object := range objects {
		for _, key := range OrderedKeys(object) {
			if !seen[key] {
				seen[key] = true
				keys = append(keys, key)
			}
		}
	}
	return keys
}

// Relative is path.relative(root, file) || file, as the TS report prints paths.
func Relative(root, file string) string {
	rel, err := filepath.Rel(root, file)
	if err != nil || rel == "." {
		return file
	}
	return rel
}
