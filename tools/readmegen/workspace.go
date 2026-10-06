package readmegen

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Halves in the order a page lists them.
var halfNames = []string{"contract", "process", "browser", "client"}

// skippedDirectories are never walked: build output, installs, other lanes'
// worktrees and tests.
var skippedDirectories = map[string]bool{
	"dist": true, "node_modules": true, ".worktrees": true, "__tests__": true, "__fixtures__": true,
}

// walkedRoots are the top-level directories whose packages the pages describe.
var walkedRoots = []string{"apps", "packages", "modules", "enterprise"}

// generatedLists are the files `pnpm generate:modules` writes, per installing app.
var generatedLists = []struct{ app, half, file string }{
	{"api", "process", "apps/api/src/process-modules.generated.ts"},
	{"worker", "process", "apps/worker/src/process-modules.generated.ts"},
	{"tasks", "process", "apps/tasks/src/process-modules.generated.ts"},
	{"ui", "browser", "apps/ui/src/browser-modules.generated.ts"},
}

type catalogueEntry struct {
	ID             string   `json:"id"`
	Root           string   `json:"root"`
	Classification string   `json:"classification"`
	Subjects       []string `json:"subjects"`
}

// packageJSON is the part of a package.json the pages read.
type packageJSON struct {
	Name             string            `json:"name"`
	Description      string            `json:"description"`
	Dependencies     map[string]string `json:"dependencies"`
	DevDependencies  map[string]string `json:"devDependencies"`
	PeerDependencies map[string]string `json:"peerDependencies"`
}

// workspacePackage is one package.json found by the walk, with its directory.
type workspacePackage struct {
	packageJSON
	Dir       string // relative to the root, slash-separated
	HasReadme bool
}

// workspace is everything Go reads itself: the catalogue, every package, the
// Prisma models and what each app's generated list installs.
type workspace struct {
	root      string
	catalogue []catalogueEntry
	packages  []workspacePackage
	byDir     map[string]*workspacePackage
	models    map[string]string // Prisma model -> table (its @@map, else the model)
	installed map[string][]string
}

func loadWorkspace(root string) (*workspace, error) {
	ws := &workspace{root: root, byDir: map[string]*workspacePackage{}, installed: map[string][]string{}}
	if err := ws.readCatalogue(); err != nil {
		return nil, err
	}
	if err := ws.walkPackages(); err != nil {
		return nil, err
	}
	if err := ws.readPrismaModels(); err != nil {
		return nil, err
	}
	ws.readGeneratedLists()
	return ws, nil
}

func (ws *workspace) path(relative string) string {
	return filepath.Join(ws.root, filepath.FromSlash(relative))
}

func (ws *workspace) readCatalogue() error {
	data, err := os.ReadFile(ws.path("modules/catalogue.json"))
	if err != nil {
		return fmt.Errorf("read the module catalogue: %w", err)
	}
	var parsed struct {
		Features []catalogueEntry `json:"features"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return fmt.Errorf("parse modules/catalogue.json: %w", err)
	}
	ws.catalogue = parsed.Features
	return nil
}

// skipped is the walk's filter: skipped directories, hidden directories and test files.
func skipped(name string, isDir bool) bool {
	if isDir {
		return skippedDirectories[name] || (strings.HasPrefix(name, ".") && name != ".")
	}
	return strings.HasSuffix(name, ".test.ts") || strings.HasSuffix(name, ".test.tsx")
}

func (ws *workspace) walkPackages() error {
	for _, top := range walkedRoots {
		if err := ws.walkRoot(top); err != nil {
			return fmt.Errorf("walk %s: %w", top, err)
		}
	}
	sort.Slice(ws.packages, func(i, j int) bool { return ws.packages[i].Dir < ws.packages[j].Dir })
	for index := range ws.packages {
		ws.byDir[ws.packages[index].Dir] = &ws.packages[index]
	}
	return nil
}

// walkRoot adds every package.json under one top-level directory.
func (ws *workspace) walkRoot(top string) error {
	start := ws.path(top)
	if _, statErr := os.Stat(start); os.IsNotExist(statErr) {
		return nil
	}
	return filepath.WalkDir(start, func(path string, entry fs.DirEntry, err error) error {
		switch {
		case err != nil:
			return err
		case skipped(entry.Name(), entry.IsDir()) && entry.IsDir():
			return filepath.SkipDir
		case entry.IsDir() || entry.Name() != "package.json":
			return nil
		}
		return ws.addPackage(filepath.Dir(path))
	})
}

func (ws *workspace) addPackage(dir string) error {
	data, err := os.ReadFile(filepath.Join(dir, "package.json")) // #nosec G304 -- a package.json the walk found
	if err != nil {
		return err
	}
	var manifest packageJSON
	if err := json.Unmarshal(data, &manifest); err != nil {
		return fmt.Errorf("parse %s: %w", filepath.Join(dir, "package.json"), err)
	}
	relative, err := filepath.Rel(ws.root, dir)
	if err != nil {
		return err
	}
	_, readmeErr := os.Stat(filepath.Join(dir, "README.md"))
	ws.packages = append(ws.packages, workspacePackage{
		packageJSON: manifest,
		Dir:         filepath.ToSlash(relative),
		HasReadme:   readmeErr == nil,
	})
	return nil
}

var (
	prismaModel = regexp.MustCompile(`(?s)(?:\A|\n)model\s+(\w+)\s*\{(.*?)\n\}`)
	prismaMap   = regexp.MustCompile(`@@map\(\s*"([^"]+)"\s*\)`)
)

// readPrismaModels mirrors packages/prisma-client/scripts/generate-table-catalogue.mjs.
func (ws *workspace) readPrismaModels() error {
	ws.models = map[string]string{}
	data, err := os.ReadFile(ws.path("packages/prisma-client/prisma/schema.prisma"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read the Prisma schema: %w", err)
	}
	for _, match := range prismaModel.FindAllStringSubmatch(string(data), -1) {
		table := match[1]
		if mapped := prismaMap.FindStringSubmatch(match[2]); mapped != nil {
			table = mapped[1]
		}
		ws.models[match[1]] = table
	}
	return nil
}

var generatedImport = regexp.MustCompile(`from\s+"([^"]+)"`)

func (ws *workspace) readGeneratedLists() {
	for _, list := range generatedLists {
		data, err := os.ReadFile(ws.path(list.file))
		if err != nil {
			continue
		}
		for _, match := range generatedImport.FindAllStringSubmatch(string(data), -1) {
			name := strings.TrimSuffix(match[1], "/declaration")
			ws.installed[name] = append(ws.installed[name], list.app)
		}
	}
}

// half is the package a module half's directory holds, or nil.
func (ws *workspace) half(entry catalogueEntry, name string) *workspacePackage {
	return ws.byDir[entry.Root+"/"+name]
}

// installedCount is how many packages an app's generated list installs.
func (ws *workspace) installedCount(app string) int {
	count := 0
	for _, apps := range ws.installed {
		for _, name := range apps {
			if name == app {
				count++
			}
		}
	}
	return count
}

// dependents is how many workspace packages name a package as a dependency.
func (ws *workspace) dependents(name string) int {
	count := 0
	for _, pkg := range ws.packages {
		_, dep := pkg.Dependencies[name]
		_, dev := pkg.DevDependencies[name]
		_, peer := pkg.PeerDependencies[name]
		if dep || dev || peer {
			count++
		}
	}
	return count
}

// modelOfDelegate maps a Prisma client delegate (`slackIntegration`) to its model.
func (ws *workspace) modelOfDelegate(delegate string) string {
	if delegate == "" {
		return ""
	}
	for model := range ws.models {
		if strings.EqualFold(model[:1], delegate[:1]) && model[1:] == delegate[1:] {
			return model
		}
	}
	return ""
}
