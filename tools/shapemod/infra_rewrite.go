package shapemod

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// importStmtRe matches one whole `import ... from "spec";` statement,
// including a multi-line named-import list.
var importStmtRe = regexp.MustCompile(`(?s)^import\s+[^;]*?from\s+["'][^"']+["'];?`)

// namedImportRe parses `import (type )?{ A, B } from "spec";`.
var namedImportRe = regexp.MustCompile(`(?s)^import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["'];?`)

type carriedImport struct {
	Specifier string
	TypeOnly  bool
	Names     []string
}

// applyInfraFile builds the new content of the infrastructure file: the
// existing content (or a fresh `export interface <F>Infrastructure {}` when
// none exists yet), with membersToAdd inserted into the interface body,
// every FOLD block appended, and the imports those blocks still need
// (deduplicated, self-references among the folded files themselves dropped)
// merged into the top of the file.
func applyInfraFile(root, infraPath, ifaceName, existing string, found bool, plans []fileFoldPlan, membersToAdd []string) (string, error) {
	content := existing
	if !found {
		content = "export interface " + ifaceName + " {}\n"
	}

	if len(membersToAdd) > 0 {
		var err error
		content, err = addMembersToInterface(content, ifaceName, membersToAdd)
		if err != nil {
			return "", err
		}
	}

	foldedPaths := map[string]bool{}
	for _, p := range plans {
		if p.Status == "FOLD" {
			foldedPaths[filepath.Join(root, p.Path)] = true
		}
	}

	groups := map[string]*carriedImport{}
	var order []string
	for _, plan := range plans {
		if plan.Status != "FOLD" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(root, plan.Path))
		if err != nil {
			return "", err
		}
		for _, ci := range extractCarriedImports(string(data), filepath.Dir(filepath.Join(root, plan.Path)), foldedPaths) {
			g, ok := groups[ci.Specifier]
			if !ok {
				g = &carriedImport{Specifier: ci.Specifier, TypeOnly: ci.TypeOnly}
				groups[ci.Specifier] = g
				order = append(order, ci.Specifier)
			}
			g.TypeOnly = g.TypeOnly && ci.TypeOnly
			for _, n := range ci.Names {
				if !containsStr(g.Names, n) {
					g.Names = append(g.Names, n)
				}
			}
		}
	}
	sort.Strings(order)
	var carried []carriedImport
	for _, spec := range order {
		g := groups[spec]
		sort.Strings(g.Names)
		carried = append(carried, *g)
	}
	content = mergeImportsIntoFile(content, carried)

	var appended strings.Builder
	for _, plan := range plans {
		if plan.Status != "FOLD" {
			continue
		}
		for _, b := range plan.Blocks {
			appended.WriteString("\n")
			appended.WriteString(b.Text)
		}
	}
	return strings.TrimRight(content, "\n") + "\n" + appended.String(), nil
}

// extractCarriedImports returns, for one port file's content, the imports
// its (already-parsed) blocks still need once moved: relative imports that
// resolve to another file being folded in this same run are dropped (the
// name now lives in the same infrastructure file); every other import -
// package or relative to somewhere else - is kept, its relative specifier
// recomputed from fromDir when necessary.
func extractCarriedImports(content, fromDir string, foldedPaths map[string]bool) []carriedImport {
	var out []carriedImport
	for _, stmt := range importStmtRe.FindAllString(content, -1) {
		m := namedImportRe.FindStringSubmatch(stmt)
		if m == nil {
			continue // default/namespace import: none occur in this repo's port files
		}
		typeOnly := m[1] != ""
		spec := m[3]
		var names []string
		for _, n := range strings.Split(m[2], ",") {
			n = strings.TrimSpace(n)
			if n != "" {
				names = append(names, n)
			}
		}
		if strings.HasPrefix(spec, ".") {
			resolved := resolveRelative(fromDir, spec)
			if foldedPaths[resolved] {
				continue // the name now lives in the same infrastructure file
			}
		}
		out = append(out, carriedImport{Specifier: spec, TypeOnly: typeOnly, Names: names})
	}
	return out
}

// resolveRelative resolves a relative import specifier (with or without a
// .ts extension) against fromDir into an absolute path ending in .ts.
func resolveRelative(fromDir, spec string) string {
	p := filepath.Join(fromDir, spec)
	if !strings.HasSuffix(p, ".ts") {
		p += ".ts"
	}
	return p
}

func containsStr(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

var topImportRe = regexp.MustCompile(`(?m)^import\s[^\n]*from\s+["'][^"']+["'];?\s*$`)
var importFromSpecRe = regexp.MustCompile(`from\s+["']([^"']+)["']`)

// mergeImportsIntoFile inserts every carried import into content: a
// specifier already imported has its named list unioned in place, and a new
// specifier is appended after the last existing top-level import (or at the
// very top when content has none yet).
func mergeImportsIntoFile(content string, carried []carriedImport) string {
	for _, ci := range carried {
		if len(ci.Names) == 0 {
			continue
		}
		existingLoc := findImportLine(content, ci.Specifier)
		if existingLoc != nil {
			content = mergeNamesIntoImportLine(content, existingLoc, ci.Names)
			continue
		}
		line := "import "
		if ci.TypeOnly {
			line += "type "
		}
		line += "{ " + strings.Join(ci.Names, ", ") + " } from \"" + ci.Specifier + "\";\n"
		insertAt := lastImportEnd(content)
		content = content[:insertAt] + line + content[insertAt:]
	}
	return content
}

type importLineLoc struct{ start, end, braceStart, braceEnd int }

func findImportLine(content, specifier string) *importLineLoc {
	for _, loc := range topImportRe.FindAllStringIndex(content, -1) {
		line := content[loc[0]:loc[1]]
		m := importFromSpecRe.FindStringSubmatch(line)
		if m == nil || m[1] != specifier {
			continue
		}
		braceStart := strings.IndexByte(line, '{')
		braceEnd := strings.IndexByte(line, '}')
		if braceStart == -1 || braceEnd == -1 {
			continue
		}
		return &importLineLoc{loc[0], loc[1], loc[0] + braceStart, loc[0] + braceEnd}
	}
	return nil
}

func mergeNamesIntoImportLine(content string, loc *importLineLoc, names []string) string {
	existing := strings.Split(content[loc.braceStart+1:loc.braceEnd], ",")
	set := map[string]bool{}
	var ordered []string
	for _, n := range existing {
		n = strings.TrimSpace(n)
		if n != "" && !set[n] {
			set[n] = true
			ordered = append(ordered, n)
		}
	}
	for _, n := range names {
		if !set[n] {
			set[n] = true
			ordered = append(ordered, n)
		}
	}
	sort.Strings(ordered)
	newBraces := " " + strings.Join(ordered, ", ") + " "
	return content[:loc.braceStart+1] + newBraces + content[loc.braceEnd:]
}

func lastImportEnd(content string) int {
	locs := topImportRe.FindAllStringIndex(content, -1)
	if len(locs) == 0 {
		return 0
	}
	last := locs[len(locs)-1][1]
	for last < len(content) && content[last] == '\n' {
		last++
		break
	}
	return last
}

// addMembersToInterface inserts membersToAdd (already formatted as
// `name: Type;`) just before the closing brace of the named interface.
func addMembersToInterface(content, name string, membersToAdd []string) (string, error) {
	re := interfaceDeclRe(name)
	loc := re.FindStringIndex(content)
	if loc == nil {
		return "", fmt.Errorf("interface %s not found while adding members", name)
	}
	end, _ := findBraceBody(content, loc[1])
	closeIdx := end - 1 // index of the '}'
	insertion := "  " + strings.Join(membersToAdd, "\n  ") + "\n"
	return content[:closeIdx] + insertion + content[closeIdx:], nil
}

// heritageRe matches `class Name extends Symbol` (a class heritage clause,
// not an interface one - interfaces never extend a class).
func heritageRe(symbol string) *regexp.Regexp {
	return regexp.MustCompile(`(class\s+\w+(?:<[^>]*>)?\s+)extends(\s+` + regexp.QuoteMeta(symbol) + `\b)`)
}

var bareSuperCallRe = regexp.MustCompile(`(?m)^[ \t]*super\(\);\n`)

// rewriteHeritageAndImports repoints every import of symbol from oldPath to
// infraPath across moduleDir/server/src, and turns `extends symbol` into
// `implements symbol` (removing the now-invalid bare `super();` call from
// the constructor of a converted class, since a folded abstract class has
// none of its own).
func rewriteHeritageAndImports(root, moduleDir, oldPath, infraPath, symbol string) error {
	srcDir := filepath.Join(root, moduleDir, "server", "src")
	oldAbs := filepath.Join(root, oldPath)
	infraAbs := filepath.Join(root, infraPath)

	return filepath.WalkDir(srcDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".ts") || p == oldAbs {
			return nil
		}
		data, rerr := os.ReadFile(p)
		if rerr != nil {
			return rerr
		}
		content := string(data)
		changed := false

		loc := findImportOfSymbolFrom(content, p, oldAbs, symbol)
		if loc != nil {
			rel, relErr := filepath.Rel(filepath.Dir(p), infraAbs)
			if relErr != nil {
				return relErr
			}
			rel = toSpecifier(rel)
			content = content[:loc.braceStart] + content[loc.braceStart:loc.braceEnd] + content[loc.braceEnd:]
			content = replaceImportSpecifier(content, *loc, rel)
			changed = true
		}

		if he := heritageRe(symbol); he.MatchString(content) {
			content = he.ReplaceAllString(content, "${1}implements${2}")
			content = removeBareSuperNearHeritage(content, symbol)
			changed = true
		}

		if changed {
			return os.WriteFile(p, []byte(content), 0o644)
		}
		return nil
	})
}

// findImportOfSymbolFrom returns the import-line location in content when it
// imports symbol from a relative specifier that resolves (from p's
// directory) to oldAbs.
func findImportOfSymbolFrom(content, p, oldAbs, symbol string) *importLineLoc {
	for _, loc := range topImportRe.FindAllStringIndex(content, -1) {
		line := content[loc[0]:loc[1]]
		m := importFromSpecRe.FindStringSubmatch(line)
		if m == nil || !strings.HasPrefix(m[1], ".") {
			continue
		}
		if resolveRelative(filepath.Dir(p), m[1]) != oldAbs {
			continue
		}
		braceStart := strings.IndexByte(line, '{')
		braceEnd := strings.IndexByte(line, '}')
		if braceStart == -1 || braceEnd == -1 {
			continue
		}
		names := line[braceStart+1 : braceEnd]
		if !regexp.MustCompile(`\b`+regexp.QuoteMeta(symbol)+`\b`).MatchString(names) {
			continue
		}
		return &importLineLoc{loc[0], loc[1], loc[0] + braceStart, loc[0] + braceEnd}
	}
	return nil
}

func replaceImportSpecifier(content string, loc importLineLoc, newSpecifier string) string {
	line := content[loc.start:loc.end]
	line = importFromSpecRe.ReplaceAllString(line, `from "`+newSpecifier+`"`)
	return content[:loc.start] + line + content[loc.end:]
}

// toSpecifier turns a filesystem-relative path into an import specifier: a
// leading "./" when filepath.Rel dropped it, forward slashes always.
func toSpecifier(rel string) string {
	rel = filepath.ToSlash(rel)
	if !strings.HasPrefix(rel, ".") {
		rel = "./" + rel
	}
	return rel
}

// removeBareSuperNearHeritage strips a bare `super();` call from the class
// whose heritage clause now reads `implements symbol` - a folded abstract
// class never had a constructor, so any explicit super() call in a
// converted subclass is now a compile error, not a behaviour change.
func removeBareSuperNearHeritage(content, symbol string) string {
	marker := "implements " + symbol
	idx := strings.Index(content, marker)
	for idx != -1 {
		classEnd, _ := findBraceBody(content, idx)
		body := content[idx:classEnd]
		stripped := bareSuperCallRe.ReplaceAllString(body, "")
		if stripped != body {
			content = content[:idx] + stripped + content[classEnd:]
			classEnd = idx + len(stripped)
		}
		next := strings.Index(content[classEnd:], marker)
		if next == -1 {
			break
		}
		idx = classEnd + next
	}
	return content
}

// rewriteExternalSubpathImports repoints an @langwatch/<pkg>-server subpath
// import of oldPath (found anywhere else in the repository) to the bare
// package import, and updates the package's own index.ts export line for
// symbol to point at the infrastructure file, when it previously exported it
// from the port file being deleted.
func rewriteExternalSubpathImports(root, moduleDir, oldPath, symbol string) error {
	pkgName, subpath, ok := packageSubpathOf(root, moduleDir, oldPath)
	if !ok {
		return nil
	}
	fullSpec := pkgName + "/" + subpath
	return filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			base := d.Name()
			if base == "node_modules" || base == ".git" || strings.HasPrefix(p, filepath.Join(root, moduleDir)) {
				return fs.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".ts") {
			return nil
		}
		data, rerr := os.ReadFile(p)
		if rerr != nil {
			return rerr
		}
		content := string(data)
		if !strings.Contains(content, fullSpec) {
			return nil
		}
		re := regexp.MustCompile(`from\s+["']` + regexp.QuoteMeta(fullSpec) + `["']`)
		content = re.ReplaceAllString(content, `from "`+pkgName+`"`)
		return os.WriteFile(p, []byte(content), 0o644)
	})
}

// packageSubpathOf returns the package name and subpath specifier an
// external file would have used to reach oldPath directly (e.g.
// "@langwatch/scenario-server" and "src/ports/scenario-clock.port.ts"),
// and whether oldPath's symbol is exported (hence reachable) from index.ts.
func packageSubpathOf(root, moduleDir, oldPath string) (pkgName, subpath string, ok bool) {
	pkgJSON := filepath.Join(root, moduleDir, "server", "package.json")
	data, err := os.ReadFile(pkgJSON)
	if err != nil {
		return "", "", false
	}
	m := regexp.MustCompile(`"name"\s*:\s*"([^"]+)"`).FindStringSubmatch(string(data))
	if m == nil {
		return "", "", false
	}
	rel, relErr := filepath.Rel(filepath.Join(root, moduleDir, "server"), filepath.Join(root, oldPath))
	if relErr != nil {
		return "", "", false
	}
	return m[1], filepath.ToSlash(rel), true
}
