package devscripts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
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
	Features []struct{ ID, Root string } `json:"features"`
}

type declaration struct{ id, symbol, pkg, specifier string }

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

func hasDeclarationExport(half string, manifest packageJSON, id, indexPath string) bool {
	if half != "web" {
		return exists(indexPath)
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
	return target == "./src/"+id+".web.ts"
}

func declarationsFor(root string, cat catalogue, half, suffix string) ([]declaration, error) {
	dir := "browser"
	if half == "module" {
		dir = "process"
	}
	var out []declaration
	for _, entry := range cat.Features {
		base := filepath.Join(root, entry.Root, dir)
		packagePath := filepath.Join(base, "package.json")
		declarationPath := filepath.Join(base, "src", entry.ID+"."+half+".ts")
		indexPath := filepath.Join(base, "src", "index.ts")
		if !exists(packagePath) || !exists(declarationPath) {
			continue
		}
		manifest, err := readManifest(packagePath)
		if err != nil {
			return nil, err
		}
		if !hasDeclarationExport(half, manifest, entry.ID, indexPath) {
			continue
		}
		symbol := camelCase(entry.ID) + suffix
		source := indexPath
		if half == "web" {
			source = declarationPath
		}
		text, err := os.ReadFile(source)
		if err != nil {
			return nil, err
		}
		if !containsWord(text, symbol, true) {
			continue
		}
		specifier := manifest.Name
		if half == "web" {
			specifier += "/declaration"
		}
		out = append(out, declaration{entry.ID, symbol, manifest.Name, specifier})
	}
	sort.SliceStable(out, func(i, j int) bool { return collate.Compare(out[i].symbol, out[j].symbol) < 0 })
	return out, nil
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
	dependencies := Object{}
	for _, member := range manifest {
		if member.Key == "dependencies" {
			if existing, ok := member.Value.(Object); ok {
				dependencies = existing
			}
		}
	}
	for _, name := range slices.Compact(slices.Sorted(slices.Values(packages))) {
		if slices.ContainsFunc(dependencies, func(m Member) bool { return m.Key == name }) {
			continue
		}
		at := slices.IndexFunc(dependencies, func(m Member) bool { return m.Key > name })
		if at < 0 {
			at = len(dependencies)
		}
		dependencies = slices.Insert(dependencies, at, Member{name, "workspace:*"})
	}
	return stringifyJS(manifest.Set("dependencies", dependencies)) + "\n", nil
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
	servers, err := declarationsFor(root, cat, "module", "ProcessModule")
	if err != nil {
		return nil, err
	}
	webs, err := declarationsFor(root, cat, "web", "Web")
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

func runGenerateModules(root string, args []string, stdout, stderr io.Writer) int {
	outputs, err := GenerateModules(root)
	if err != nil {
		fmt.Fprintln(stderr, "generate-modules:", err)
		return 1
	}
	dry := slices.Contains(args, "--dry-run")
	if slices.Contains(args, "--check") {
		stale := 0
		for _, out := range outputs {
			if onDisk, err := os.ReadFile(filepath.Join(root, out.Path)); err != nil || string(onDisk) != out.Source {
				fmt.Fprintf(stderr, "generate-modules: %s is stale; run pnpm generate:modules\n", out.Path)
				stale++
			}
		}
		return min(stale, 1)
	}
	for _, out := range outputs {
		if dry {
			fmt.Fprintf(stdout, "Would generate %s (%d lines)\n", out.Path, strings.Count(out.Source, "\n"))
			continue
		}
		if err := os.WriteFile(filepath.Join(root, out.Path), []byte(out.Source), 0o644); err != nil {
			fmt.Fprintln(stderr, "generate-modules:", err)
			return 1
		}
		fmt.Fprintf(stdout, "Wrote %s\n", out.Path)
	}
	return 0
}
