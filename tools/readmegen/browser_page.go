package readmegen

import (
	"encoding/json"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

// browserPage is a module's browser half: declaration, screens, drawers, calls.
func (g *generator) browserPage(entry catalogueEntry, pkg *workspacePackage) page {
	dir := pkg.Dir
	facts := g.facts[entry.ID].Browser
	seed := "The browser half of " + link(entry.ID, "../README.md") + "."
	if facts != nil && facts.Doc != "" {
		seed += " " + oneLine(facts.Doc)
	}
	p := page{Path: path.Join(dir, "README.md"), Title: pkg.Name, Seed: seed}
	if facts == nil {
		p.Body = "≈ No `defineBrowserModule(...)` read in `src/`.\n"
		return p
	}
	sections := []string{
		g.browserDeclaration(dir, pkg, facts),
		g.screenSection(facts),
		g.drawerSection(entry, dir, facts),
		browserCalls(pkg, facts),
	}
	p.Body = strings.Join(sections, "\n")
	return p
}

func (g *generator) browserDeclaration(dir string, pkg *workspacePackage, facts *BrowserFacts) string {
	out := "Declared in " + at(dir, facts.At) + " (" + code(`defineBrowserModule("`+facts.Name.String()+`")`) + ")"
	if facts.ExportName != "" {
		out += ", exported as " + code(facts.ExportName)
	}
	if subpath := exportOf(pkg, strings.TrimPrefix(facts.At.File, dir+"/")); subpath != "" {
		out += " at " + code(subpath)
	}
	out += ".\n"
	if len(g.ws.installed[pkg.Name]) > 0 {
		out += "\nInstalled by " + strings.Join(g.ws.installed[pkg.Name], ", ") +
			", from the app's generated module list (`pnpm generate:modules`).\n"
	} else {
		out += "\nNot installed by any app's generated module list.\n"
	}
	return out
}

// exportOf is the package.json export whose target is the declaring file.
func exportOf(pkg *workspacePackage, file string) string {
	var exports map[string]json.RawMessage
	if json.Unmarshal(pkg.Exports, &exports) != nil {
		return ""
	}
	keys := make([]string, 0, len(exports))
	for key := range exports {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if strings.Contains(string(exports[key]), `"./`+file+`"`) {
			return key
		}
	}
	return ""
}

func (g *generator) screenSection(facts *BrowserFacts) string {
	if len(facts.Screens) == 0 {
		return "## Screens\n\nNone.\n"
	}
	var rows [][]string
	for index := range facts.Screens {
		screen := &facts.Screens[index]
		flags := make([]string, 0, len(screen.Flags))
		for _, flag := range screen.Flags {
			flags = append(flags, scalarCode(&flag))
		}
		rows = append(rows, []string{
			code(screen.Key), cell(g.screenURL(screen)), cell(orDash(scalarText(screen.Within))),
			cell(orDash(scalarText(screen.Label))), cell(orDash(scalarCode(screen.Requires))),
			cell(orDash(strings.Join(flags, ", "))),
		})
	}
	return "## Screens\n\n" + table([]string{"Page key", "URL", "Within", "Label", "Permission", "Flags"}, rows) +
		"\nA URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.\n"
}

func (g *generator) screenURL(screen *Screen) string {
	if screen.Path != nil {
		return scalarCode(screen.Path)
	}
	if url := g.uiRoutes[screen.Key]; url != "" {
		return code(url) + " (route table)"
	}
	return "–"
}

func scalarText(value *Scalar) string {
	if value == nil {
		return ""
	}
	return value.String()
}

func scalarCode(value *Scalar) string {
	switch {
	case value == nil:
		return ""
	case value.Resolved:
		return code(value.Value)
	default:
		return "≈ " + code(value.Text)
	}
}

func (g *generator) drawerSection(entry catalogueEntry, dir string, facts *BrowserFacts) string {
	title := "## Drawers (the name is the wire: `?drawer.open=<name>`)\n\n"
	if len(facts.Drawers) == 0 {
		return title + "None.\n"
	}
	var rows [][]string
	for index := range facts.Drawers {
		drawer := &facts.Drawers[index]
		opens := "≈"
		if drawer.Opens != "" {
			opens = code(strings.TrimPrefix(drawer.Opens, dir+"/"))
		}
		rows = append(rows, []string{scalarCode(&drawer.Name), opens, cell(orDash(strings.Join(g.drawerOpeners(entry.ID, drawer), ", ")))})
	}
	return title + table([]string{"Drawer", "Opens", "Opened from"}, rows) +
		"\nOpened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a\n" +
		"`…Drawer(\"<name>\")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.\n"
}

// drawerOpeners are the other modules whose browser source opens a drawer by its literal name or token.
func (g *generator) drawerOpeners(owner string, drawer *Drawer) []string {
	if !drawer.Name.Resolved {
		return nil
	}
	name := regexp.QuoteMeta(drawer.Name.Value)
	// Each regexp is tried only where its literal occurs: one alternation over every
	// browser half ran Go's NFA at each byte and was 90% of a run.
	openers := []opener{
		{drawer.Name.Value, regexp.MustCompile(`Drawer\(\s*["'` + "`" + `]` + name + `["'` + "`" + `]`)},
		{drawer.Name.Value, regexp.MustCompile(`drawer\.open=` + name + `\b`)},
	}
	if drawer.Token != "" {
		openers = append(openers, opener{drawer.Token, regexp.MustCompile(`\b` + regexp.QuoteMeta(drawer.Token) + `\b`)})
	}
	sources := g.browserSources()
	opens := make([]bool, len(sources))
	var wg sync.WaitGroup
	for i, source := range sources {
		wg.Go(func() {
			for _, try := range openers {
				if strings.Contains(source.text, try.literal) && try.pattern.MatchString(source.text) {
					opens[i] = true
					return
				}
			}
		})
	}
	wg.Wait()
	var found []string
	for i, source := range sources {
		if opens[i] && source.module != owner && !contains(found, source.module) {
			found = append(found, source.module)
		}
	}
	sort.Strings(found)
	return found
}

// opener is one way a source opens a drawer, and a literal every match contains.
type opener struct {
	literal string
	pattern *regexp.Regexp
}

type browserSource struct{ module, text string }

// browserSources is the source of every module's browser half and of apps/ui, read once.
func (g *generator) browserSources() []browserSource {
	if g.sources != nil {
		return g.sources
	}
	g.sources = []browserSource{}
	roots := []browserSource{{module: "ui", text: "apps/ui/src"}}
	for _, entry := range g.ws.catalogue {
		roots = append(roots, browserSource{module: entry.ID, text: entry.Root + "/browser/src"})
	}
	for _, root := range roots {
		if text := readTree(g.ws.path(root.text)); text != "" {
			g.sources = append(g.sources, browserSource{module: root.module, text: text})
		}
	}
	return g.sources
}

// readTree is every TypeScript file under a directory, joined, skipping tests and builds.
func readTree(dir string) string {
	var text strings.Builder
	_ = filepath.WalkDir(dir, func(file string, item fs.DirEntry, err error) error {
		if err != nil || item.IsDir() && skippedDirectories[item.Name()] {
			return filepath.SkipDir
		}
		if ext := path.Ext(item.Name()); item.IsDir() || (ext != ".ts" && ext != ".tsx") {
			return nil
		}
		if data, readErr := readFile(file); readErr == nil {
			text.Write(data)
			text.WriteString("\n")
		}
		return nil
	})
	return text.String()
}

func browserCalls(pkg *workspacePackage, facts *BrowserFacts) string {
	var lines []string
	if facts.API != "" {
		lines = append(lines, "- "+code("withApi("+facts.API+")")+", tRPC contracts: "+orDash(contractList(facts.Contracts))+".")
	}
	var clients []string
	for name := range pkg.Dependencies {
		if strings.HasSuffix(name, "-client") {
			clients = append(clients, code(name))
		}
	}
	sort.Strings(clients)
	lines = appendList(lines, "Client packages (package.json)", clients)
	lends := make([]string, 0, len(facts.Lends))
	for _, lend := range facts.Lends {
		lends = append(lends, code(lend.Token))
	}
	lines = appendList(lines, "Lends", lends)
	lines = appendList(lines, "Host APIs it requires", scalarCodes(facts.Hosts))
	lines = appendList(lines, "Capabilities", codes(facts.Capabilities))
	lines = appendList(lines, "Config slices", codes(facts.Config))
	if len(lines) == 0 {
		return "## Calls\n\nNone: no `withApi`, client package, lend, host or capability.\n"
	}
	return "## Calls\n\n" + strings.Join(lines, "\n") + "\n"
}

// contractList is each contract namespace as `ns.*`, an unfolded one with ≈.
func contractList(contracts []Scalar) string {
	parts := make([]string, 0, len(contracts))
	for index := range contracts {
		contract := &contracts[index]
		if contract.Resolved {
			parts = append(parts, code(contract.Value+".*"))
		} else {
			parts = append(parts, "≈ "+code(contract.Text))
		}
	}
	return strings.Join(parts, ", ")
}

func scalarCodes(values []Scalar) []string {
	out := make([]string, 0, len(values))
	for index := range values {
		out = append(out, scalarCode(&values[index]))
	}
	return out
}

func appendList(lines []string, label string, items []string) []string {
	if len(items) == 0 {
		return lines
	}
	return append(lines, "- "+label+": "+strings.Join(items, ", ")+".")
}

func readFile(file string) ([]byte, error) {
	return os.ReadFile(file) // #nosec G304 -- a source file under a module the catalogue names
}
