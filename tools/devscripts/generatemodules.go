package devscripts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
)

const (
	serverRoot    = "packages/installed-server-modules"
	webRoot       = "packages/installed-web-modules"
	serverList    = serverRoot + "/src/server-modules.generated.ts"
	webList       = webRoot + "/src/web-modules.generated.ts"
	serverMembers = serverRoot + "/src/server-module-members.generated.ts"
	serverPackage = serverRoot + "/package.json"
	webPackage    = webRoot + "/package.json"
	generatedHead = "/** Generated from modules/catalogue.json. Do not edit by hand. */\n" +
		"/** Run `pnpm generate:modules` to rewrite it. */\n"
)

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

var (
	readsPattern = regexp.MustCompile(`static\s+readonly\s+reads\s*=\s*(?:reads\()?\[?([^);\]]*)`)
	quotedName   = regexp.MustCompile("[\"'`]([A-Za-z]\\w*)[\"'`]")
	plainKey     = regexp.MustCompile(`^[a-z][a-zA-Z0-9]*$`)
)

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
	if half == "server" {
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
	sort.SliceStable(out, func(i, j int) bool { return localeCompare(out[i].symbol, out[j].symbol) < 0 })
	return out, nil
}

func membersFor(root, entryRoot string) ([]string, error) {
	appDir := filepath.Join(root, entryRoot, "process", "src", "app")
	if !exists(appDir) {
		return nil, nil
	}
	names, err := os.ReadDir(appDir)
	if err != nil {
		return nil, err
	}
	declared := map[string]bool{}
	for _, name := range names {
		if !strings.HasSuffix(name.Name(), ".app.ts") {
			continue
		}
		text, err := os.ReadFile(filepath.Join(appDir, name.Name()))
		if err != nil {
			return nil, err
		}
		match := readsPattern.FindSubmatch(text)
		if match == nil || len(match[1]) == 0 {
			continue
		}
		for _, quoted := range quotedName.FindAllSubmatch(match[1], -1) {
			declared[string(quoted[1])] = true
		}
	}
	members := make([]string, 0, len(declared))
	for name := range declared {
		members = append(members, name)
	}
	sort.Strings(members)
	return members, nil
}

// memberSource keeps catalogue order: the JS sort there is never assigned.
func memberSource(root string, cat catalogue) (string, error) {
	var rows []string
	for _, entry := range cat.Features {
		if !exists(filepath.Join(root, entry.Root, "process", "package.json")) {
			continue
		}
		members, err := membersFor(root, entry.Root)
		if err != nil {
			return "", err
		}
		key := entry.ID
		if !plainKey.MatchString(key) {
			key = jsQuote(key)
		}
		quoted := make([]string, len(members))
		for i, member := range members {
			quoted[i] = jsQuote(member)
		}
		rows = append(rows, fmt.Sprintf("  %s: [%s],", key, strings.Join(quoted, ", ")))
	}
	lines := []string{
		"/** Generated from modules/catalogue.json. Do not edit by hand. */",
		"/** Run `pnpm generate:modules` to rewrite it. */",
		"",
		"/**",
		" * What each installed module's App declared it reads, in name order.",
		" *",
		" * Boot builds exactly this union, plus whatever each module's chosen",
		" * repository tier requires, and refuses by module and member when this",
		" * process cannot supply one.",
		" */",
		"export const serverModuleMembers = {",
	}
	lines = append(lines, rows...)
	lines = append(lines, "} as const;", "")
	return strings.Join(lines, "\n"), nil
}

func moduleConfigsFor(root string, cat catalogue) ([]declaration, error) {
	var out []declaration
	for _, entry := range cat.Features {
		base := filepath.Join(root, entry.Root, "contract")
		packagePath := filepath.Join(base, "package.json")
		configPath := filepath.Join(base, "src", entry.ID+".config.ts")
		indexPath := filepath.Join(base, "src", "index.ts")
		if !exists(packagePath) || !exists(configPath) || !exists(indexPath) {
			continue
		}
		symbol := camelCase(entry.ID) + "ServerConfigSchema"
		config, err := os.ReadFile(configPath)
		if err != nil {
			return nil, err
		}
		if !containsWord(config, "export const "+symbol, false) {
			continue
		}
		index, err := os.ReadFile(indexPath)
		if err != nil {
			return nil, err
		}
		if !strings.Contains(string(index), "./"+entry.ID+".config") {
			continue
		}
		manifest, err := readManifest(packagePath)
		if err != nil {
			return nil, err
		}
		out = append(out, declaration{id: entry.ID, symbol: symbol, specifier: manifest.Name})
	}
	sort.SliceStable(out, func(i, j int) bool { return localeCompare(out[i].id, out[j].id) < 0 })
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
		if declares(entry.Root, "browser", entry.ID, "web") && declares(entry.Root, "process", entry.ID, "server") {
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
		"type MissingWeb = Exclude<PairedOnDisk, (typeof webModules)[number][\"name\"]>;",
		"type MissingServer = Exclude<PairedOnDisk, ServerHalfOnDisk>;",
		"export const webModulePairing = {} satisfies {",
		"  [Id in `missing web half \"${MissingWeb}\"` | `missing server half \"${MissingServer}\"`]: never;",
		"};",
		"",
	}, "\n")
}

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
	names := slices.Compact(slices.Sorted(slices.Values(packages)))
	dependencies := Object{}
	for _, name := range names {
		dependencies = append(dependencies, Member{name, "workspace:*"})
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
	configs, err := moduleConfigsFor(root, cat)
	if err != nil {
		return nil, err
	}
	servers, err := declarationsFor(root, cat, "server", "Server")
	if err != nil {
		return nil, err
	}
	webs, err := declarationsFor(root, cat, "web", "Web")
	if err != nil {
		return nil, err
	}
	members, err := memberSource(root, cat)
	if err != nil {
		return nil, err
	}
	serverPackages := []string{"@langwatch/kernel"}
	serverNames := []string{}
	for _, d := range servers {
		serverPackages = append(serverPackages, d.pkg)
		serverNames = append(serverNames, d.id)
	}
	for _, c := range configs {
		serverPackages = append(serverPackages, c.specifier)
	}
	webPackages := []string{}
	for _, d := range webs {
		webPackages = append(webPackages, d.pkg)
	}
	serverPackageText, err := packageSource(root, serverPackage, serverPackages)
	if err != nil {
		return nil, err
	}
	webPackageText, err := packageSource(root, webPackage, webPackages)
	if err != nil {
		return nil, err
	}
	outputs := []Output{
		{serverList, listSource(servers, "serverModules", "server")},
		{webList, listSource(webs, "webModules", "web") + pairingSource(root, cat, serverNames)},
		{serverMembers, members},
		{serverPackage, serverPackageText},
		{webPackage, webPackageText},
	}
	return outputs, nil
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
