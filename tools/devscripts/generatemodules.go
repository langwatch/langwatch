package devscripts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/internal/collate"
)

const (
	processList   = "src/process-modules.generated.ts"
	browserList   = "src/browser-modules.generated.ts"
	generatedHead = "/** Generated from modules/catalogue.json. Do not edit by hand. */\n" +
		"/** Run `pnpm generate:modules` to rewrite it. */\n"
)

// Apps that boot the process half each carry their own copy of the list.
var processApps = []string{"apps/api", "apps/worker", "apps/tasks"}

const browserApp = "apps/ui"

// Output is one generated file: a repository-relative path and its text.
type Output struct{ Path, Source string }

type catalogue struct {
	Features []catalogueEntry `json:"features"`
}

type catalogueEntry struct{ ID, Root string }

type declaration struct{ id, symbol, pkg, specifier string }

// declarationKind is one half the generated lists cover: its file infix
// ("module" or "web") and the suffix of the symbol it exports.
type declarationKind struct{ half, suffix string }

type packageJSON struct {
	Name    string `json:"name"`
	Exports any    `json:"exports"`
}

// containsWord is regexp `\bneedle\b` (or `needle\b` when leading is false) without
// compiling a pattern per module.
func containsWord(text []byte, needle string, leading bool) bool {
	for from := 0; from < len(text); {
		at := bytes.Index(text[from:], []byte(needle))
		if at < 0 {
			return false
		}
		start, end := from+at, from+at+len(needle)
		if (!leading || start == 0 || !isWordByte(text[start-1])) && (end == len(text) || !isWordByte(text[end])) {
			return true
		}
		from = start + 1
	}
	return false
}

func isWordByte(b byte) bool {
	return b == '_' || b >= '0' && b <= '9' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z'
}

func camelCase(id string) string {
	var sb strings.Builder
	for i := 0; i < len(id); i++ {
		if id[i] == '-' && i+1 < len(id) && id[i+1] >= 'a' && id[i+1] <= 'z' {
			i++
			sb.WriteByte(id[i] - 'a' + 'A')
			continue
		}
		sb.WriteByte(id[i])
	}
	return sb.String()
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func readManifest(path string) (packageJSON, error) {
	var manifest packageJSON
	data, err := os.ReadFile(path)
	if err != nil {
		return manifest, err
	}
	return manifest, json.Unmarshal(data, &manifest)
}

// declarationSite is where one catalogue entry's half would live on disk.
type declarationSite struct {
	id, packagePath, declarationPath, indexPath string
}

func siteFor(root string, entry catalogueEntry, kind declarationKind) declarationSite {
	dir := "browser"
	if kind.half == "module" {
		dir = "process"
	}
	base := filepath.Join(root, entry.Root, dir)
	return declarationSite{
		id:              entry.ID,
		packagePath:     filepath.Join(base, "package.json"),
		declarationPath: filepath.Join(base, "src", entry.ID+"."+kind.half+".ts"),
		indexPath:       filepath.Join(base, "src", "index.ts"),
	}
}

func hasDeclarationExport(half string, manifest packageJSON, site declarationSite) bool {
	if half != "web" {
		return exists(site.indexPath)
	}
	exports, ok := manifest.Exports.(map[string]any)
	if !ok {
		return false
	}
	target := exports["./declaration"]
	if object, ok := target.(map[string]any); ok {
		target = object["langwatch-declaration-source"]
		if target == nil {
			target = object["default"]
		}
	}
	return target == "./src/"+site.id+".web.ts"
}

func declarationsFor(root string, cat catalogue, kind declarationKind) ([]declaration, error) {
	var out []declaration
	for _, entry := range cat.Features {
		found, ok, err := declarationOf(siteFor(root, entry, kind), kind)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, found)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return collate.Compare(out[i].symbol, out[j].symbol) < 0 })
	return out, nil
}

// declarationOf reads the declaration a site exports, if it has one.
func declarationOf(site declarationSite, kind declarationKind) (declaration, bool, error) {
	if !exists(site.packagePath) || !exists(site.declarationPath) {
		return declaration{}, false, nil
	}
	manifest, err := readManifest(site.packagePath)
	if err != nil {
		return declaration{}, false, err
	}
	if !hasDeclarationExport(kind.half, manifest, site) {
		return declaration{}, false, nil
	}
	symbol := camelCase(site.id) + kind.suffix
	source, specifier := site.indexPath, manifest.Name
	if kind.half == "web" {
		source, specifier = site.declarationPath, specifier+"/declaration"
	}
	text, err := os.ReadFile(source)
	if err != nil {
		return declaration{}, false, err
	}
	if !containsWord(text, symbol, true) {
		return declaration{}, false, nil
	}
	return declaration{site.id, symbol, manifest.Name, specifier}, true, nil
}

func listSource(declarations []declaration, constant, half string) string {
	body := fmt.Sprintf("/** No module declares a %s half yet. */\nexport const %s = [] as const;\n", half, constant)
	if len(declarations) > 0 {
		lines := []string{}
		for _, d := range declarations {
			lines = append(lines, fmt.Sprintf("import { %s } from \"%s\";", d.symbol, d.specifier))
		}
		lines = append(lines, "", fmt.Sprintf("/** Every installed module's %s declaration, in name order. */", half),
			fmt.Sprintf("export const %s = [", constant))
		for _, d := range declarations {
			if half == "web" {
				lines = append(lines, fmt.Sprintf("  %s satisfies { readonly name: \"%s\" },", d.symbol, d.id))
			} else {
				lines = append(lines, fmt.Sprintf("  %s,", d.symbol))
			}
		}
		lines = append(lines, "] as const;", "")
		body = strings.Join(lines, "\n")
	}
	return generatedHead + "\n" + body
}

func pairingSource(root string, cat catalogue, serverNames []string) string {
	declares := func(entryRoot, dir, id, half string) bool {
		return exists(filepath.Join(root, entryRoot, dir, "src", id+"."+half+".ts"))
	}
	var paired []string
	for _, entry := range cat.Features {
		if declares(entry.Root, "browser", entry.ID, "web") && declares(entry.Root, "process", entry.ID, "module") {
			paired = append(paired, entry.ID)
		}
	}
	union := func(names []string) string {
		quoted := make([]string, len(names))
		for i, name := range names {
			quoted[i] = jsQuote(name)
		}
		if len(quoted) == 0 {
			return "never"
		}
		return strings.Join(quoted, " | ")
	}
	return strings.Join([]string{
		"type PairedOnDisk = " + union(paired) + ";",
		"type ServerHalfOnDisk = " + union(serverNames) + ";",
		"type MissingWeb = Exclude<PairedOnDisk, (typeof browserModules)[number][\"name\"]>;",
		"type MissingServer = Exclude<PairedOnDisk, ServerHalfOnDisk>;",
		"export const webModulePairing = {} satisfies {",
		"  [Id in `missing web half \"${MissingWeb}\"` | `missing server half \"${MissingServer}\"`]: never;",
		"};",
		"",
	}, "\n")
}

// packageSource declares each package the app's generated list imports. It adds
// what is missing and never reorders or removes: an app owns the rest of its manifest.
func packageSource(root, manifestPath string, packages []string) (string, error) {
	data, err := os.ReadFile(filepath.Join(root, manifestPath))
	if err != nil {
		return "", err
	}
	parsed, err := parseOrdered(data)
	if err != nil {
		return "", err
	}
	manifest, ok := parsed.(Object)
	if !ok {
		return "", fmt.Errorf("%s: not a JSON object", manifestPath)
	}
	dependencies := existingDependencies(manifest)
	for _, name := range slices.Compact(slices.Sorted(slices.Values(packages))) {
		dependencies = withWorkspaceDependency(dependencies, name)
	}
	return stringifyJS(manifest.Set("dependencies", dependencies)) + "\n", nil
}

// existingDependencies returns the manifest's last "dependencies" object, or an empty one.
func existingDependencies(manifest Object) Object {
	dependencies := Object{}
	for _, member := range manifest {
		if member.Key != "dependencies" {
			continue
		}
		if existing, ok := member.Value.(Object); ok {
			dependencies = existing
		}
	}
	return dependencies
}

// withWorkspaceDependency inserts name as "workspace:*" in key order unless it is already declared.
func withWorkspaceDependency(dependencies Object, name string) Object {
	if slices.ContainsFunc(dependencies, func(m Member) bool { return m.Key == name }) {
		return dependencies
	}
	at := slices.IndexFunc(dependencies, func(m Member) bool { return m.Key > name })
	if at < 0 {
		at = len(dependencies)
	}
	return slices.Insert(dependencies, at, Member{name, "workspace:*"})
}

// GenerateModules returns every generated file, in the order the script writes them.
func GenerateModules(root string) ([]Output, error) {
	data, err := os.ReadFile(filepath.Join(root, "modules/catalogue.json"))
	if err != nil {
		return nil, err
	}
	var cat catalogue
	if err := json.Unmarshal(data, &cat); err != nil {
		return nil, err
	}
	servers, err := declarationsFor(root, cat, declarationKind{half: "module", suffix: "ProcessModule"})
	if err != nil {
		return nil, err
	}
	webs, err := declarationsFor(root, cat, declarationKind{half: "web", suffix: "Web"})
	if err != nil {
		return nil, err
	}
	serverPackages := []string{}
	serverNames := []string{}
	for _, d := range servers {
		serverPackages = append(serverPackages, d.pkg)
		serverNames = append(serverNames, d.id)
	}
	webPackages := []string{}
	for _, d := range webs {
		webPackages = append(webPackages, d.pkg)
	}
	outputs := []Output{}
	for _, app := range processApps {
		manifest, err := packageSource(root, app+"/package.json", serverPackages)
		if err != nil {
			return nil, err
		}
		outputs = append(outputs,
			Output{app + "/" + processList, listSource(servers, "processModules", "server")},
			Output{app + "/package.json", manifest})
	}
	manifest, err := packageSource(root, browserApp+"/package.json", webPackages)
	if err != nil {
		return nil, err
	}
	return append(outputs,
		Output{browserApp + "/" + browserList, listSource(webs, "browserModules", "web") + pairingSource(root, cat, serverNames)},
		Output{browserApp + "/package.json", manifest}), nil
}

func runGenerateModules(command subcommand) int {
	outputs, err := GenerateModules(command.root)
	if err != nil {
		fmt.Fprintln(command.stderr, "generate-modules:", err)
		return 1
	}
	if slices.Contains(command.args, "--check") {
		return checkGenerated(command, outputs)
	}
	dry := slices.Contains(command.args, "--dry-run")
	for _, out := range outputs {
		if err := writeGenerated(command, out, dry); err != nil {
			fmt.Fprintln(command.stderr, "generate-modules:", err)
			return 1
		}
	}
	return 0
}

// checkGenerated reports each output that differs from the file on disk, and exits 1 if any does.
func checkGenerated(command subcommand, outputs []Output) int {
	stale := 0
	for _, out := range outputs {
		if onDisk, err := os.ReadFile(filepath.Join(command.root, out.Path)); err != nil || string(onDisk) != out.Source {
			fmt.Fprintf(command.stderr, "generate-modules: %s is stale; run pnpm generate:modules\n", out.Path)
			stale++
		}
	}
	return min(stale, 1)
}

func writeGenerated(command subcommand, out Output, dry bool) error {
	if dry {
		fmt.Fprintf(command.stdout, "Would generate %s (%d lines)\n", out.Path, strings.Count(out.Source, "\n"))
		return nil
	}
	if err := os.WriteFile(filepath.Join(command.root, out.Path), []byte(out.Source), 0o644); err != nil {
		return err
	}
	fmt.Fprintf(command.stdout, "Wrote %s\n", out.Path)
	return nil
}
