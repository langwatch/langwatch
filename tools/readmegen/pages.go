package readmegen

import (
	"fmt"
	"path"
	"sort"
	"strings"
)

// generator joins what Go reads with what the extractor printed.
type generator struct {
	ws       *workspace
	facts    map[string]ModuleFacts
	kinds    map[string]string // package root -> enforcer kind
	reverse  map[string][]string
	pageRoot map[string]string // module id -> catalogue root
	schemas  schemaIndex
	uiRoutes map[string]string // page key -> URL, from uiRouteTable
	sources  []browserSource   // every browser half's source, read on first use
	groups   []string          // the closed package-group list; empty keeps the Kind column
}

func newGenerator(ws *workspace, manifest Manifest) *generator {
	g := &generator{
		ws:       ws,
		facts:    map[string]ModuleFacts{},
		kinds:    map[string]string{},
		reverse:  map[string][]string{},
		pageRoot: map[string]string{},
		schemas:  newSchemaIndex(manifest.Schemas),
		uiRoutes: map[string]string{},
		groups:   packageGroups,
	}
	for _, route := range manifest.UIRoutes {
		g.uiRoutes[route.Page] = route.Path
	}
	for index := range manifest.Modules {
		g.facts[manifest.Modules[index].ID] = manifest.Modules[index]
	}
	for _, pkg := range manifest.Packages {
		g.kinds[pkg.Root] = pkg.Kind
	}
	for _, entry := range ws.catalogue {
		g.pageRoot[entry.ID] = entry.Root
		for _, peer := range g.facts[entry.ID].Peers {
			if peer.Resolved && !contains(g.reverse[peer.Module], entry.ID) {
				g.reverse[peer.Module] = append(g.reverse[peer.Module], entry.ID)
			}
		}
	}
	for id := range g.reverse {
		sort.Strings(g.reverse[id])
	}
	return g
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// pages is every page this generator owns, in path order.
func (g *generator) pages() []page {
	pages := []page{
		g.moduleIndex("modules/README.md", "Modules", "core"),
		g.moduleIndex("enterprise/modules/README.md", "Enterprise modules", "enterprise"),
		g.enterpriseIndex(),
		g.packageIndex("enterprise/packages/README.md", "Enterprise packages", "enterprise/packages/"),
		g.packageIndex("packages/README.md", "Packages", "packages/"),
		g.appIndex(),
	}
	for _, entry := range g.ws.catalogue {
		pages = append(pages, g.modulePage(entry))
		if half := g.ws.half(entry, "process"); half != nil {
			pages = append(pages, g.processPage(entry, half))
		}
		if half := g.ws.half(entry, "browser"); half != nil {
			pages = append(pages, g.browserPage(entry, half))
		}
	}
	sort.Slice(pages, func(i, j int) bool { return pages[i].Path < pages[j].Path })
	return pages
}

// relativeLink is the path from one page's directory to another root's README.
func relativeLink(fromDir, toRoot string) string {
	from := strings.Split(fromDir, "/")
	to := strings.Split(toRoot, "/")
	shared := 0
	for shared < len(from) && shared < len(to) && from[shared] == to[shared] {
		shared++
	}
	parts := []string{}
	for range from[shared:] {
		parts = append(parts, "..")
	}
	parts = append(parts, to[shared:]...)
	parts = append(parts, "README.md")
	return path.Join(parts...)
}

func (g *generator) halves(entry catalogueEntry, linked bool) string {
	var present []string
	for _, name := range halfNames {
		if g.ws.half(entry, name) == nil {
			continue
		}
		if linked {
			target := name
			if name == "process" {
				target = "process/README.md"
			}
			name = link(name, target)
		}
		present = append(present, name)
	}
	return strings.Join(present, " · ")
}

// ownedTables is every Postgres model a module claims and every ClickHouse table it writes.
func (g *generator) ownedTables(id string) string {
	facts := g.facts[id]
	var names []string
	for _, claim := range facts.PrismaClaims {
		if !contains(names, claim.Model) {
			names = append(names, claim.Model)
		}
	}
	for _, write := range facts.ClickhouseWrites {
		if !contains(names, write.Table) {
			names = append(names, write.Table)
		}
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}

func (g *generator) peerModules(id string) string {
	var names []string
	for _, peer := range g.facts[id].Peers {
		name := peer.Module
		if !peer.Resolved {
			name = "≈ " + code(peer.Name)
		}
		if !contains(names, name) {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}

func (g *generator) moduleIndex(pagePath, title, classification string) page {
	dir := path.Dir(pagePath)
	var rows [][]string
	for _, entry := range g.ws.catalogue {
		if entry.Classification != classification {
			continue
		}
		row := []string{
			link(entry.ID, relativeLink(dir, entry.Root)),
			strings.Join(entry.Subjects, ", "),
			g.halves(entry, false),
			cell(orDash(g.ownedTables(entry.ID))),
			cell(orDash(g.peerModules(entry.ID))),
		}
		if classification == "enterprise" {
			row = append(row, cell(orDash(g.entitlements(entry.ID))))
		}
		rows = append(rows, row)
	}
	header := []string{"Module", "Subjects", "Halves", "Owns tables", "Peers"}
	if classification == "enterprise" {
		header = append(header, "Entitlement gates")
	}
	body := table(header, rows) +
		"\n**Who owns a subject?** Search this table, or `modules/catalogue.json`. A subject with no\n" +
		"row is unowned: add it to the catalogue before writing code for it.\n"
	return page{Path: pagePath, Title: title, Body: body}
}

func (g *generator) enterpriseIndex() page {
	var modules [][]string
	for _, entry := range g.ws.catalogue {
		if entry.Classification == "enterprise" {
			modules = append(modules, []string{
				link(entry.ID, relativeLink("enterprise", entry.Root)),
				strings.Join(entry.Subjects, ", "),
				g.halves(entry, false),
				cell(orDash(g.entitlements(entry.ID))),
			})
		}
	}
	var packages [][]string
	for _, pkg := range g.ws.packages {
		if strings.HasPrefix(pkg.Dir, "enterprise/packages/") {
			packages = append(packages, []string{g.packageName(pkg, "enterprise"), cell(orDash(pkg.Description))})
		}
	}
	body := "## Modules\n\n" + table([]string{"Module", "Subjects", "Halves", "Entitlement gates"}, modules) +
		"\nEvery module is listed in `modules/catalogue.json` with `classification: enterprise`; " +
		"the generated module lists install it beside the core modules. Gating is per route, never per mount.\n\n" +
		"## Packages\n\n" + table([]string{"Package", "Description"}, packages)
	return page{Path: "enterprise/README.md", Title: "LangWatch Enterprise", Body: body}
}

// packageName is the package's name, linked to its README when it has one.
func (g *generator) packageName(pkg workspacePackage, fromDir string) string {
	if !pkg.HasReadme {
		return code(pkg.Name)
	}
	return link(pkg.Name, relativeLink(fromDir, pkg.Dir))
}

func (g *generator) packageIndex(pagePath, title, prefix string) page {
	dir := path.Dir(pagePath)
	var listed []workspacePackage
	for _, pkg := range g.ws.packages {
		rest := strings.TrimPrefix(pkg.Dir, prefix)
		if strings.HasPrefix(pkg.Dir, prefix) && !strings.Contains(rest, "/") {
			listed = append(listed, pkg)
		}
	}
	grouped := len(g.groups) > 0 && prefix == groupedPrefix
	first := func(pkg workspacePackage) string { return g.kinds[pkg.Dir] }
	if grouped {
		first = func(pkg workspacePackage) string { return pkg.LangWatch.Group }
	}
	sort.SliceStable(listed, func(i, j int) bool {
		left, right := first(listed[i]), first(listed[j])
		if grouped {
			return groupOrder(g.groups, left) < groupOrder(g.groups, right) ||
				(left == right && listed[i].Name < listed[j].Name)
		}
		return left < right || (left == right && listed[i].Name < listed[j].Name)
	})
	var rows [][]string
	for _, pkg := range listed {
		rows = append(rows, []string{
			orDash(first(pkg)),
			g.packageName(pkg, dir),
			cell(orDash(pkg.Description)),
			fmt.Sprint(g.ws.dependents(pkg.Name)),
		})
	}
	header, note := "Kind", "Kind is the architecture enforcer's classification"
	if grouped {
		header, note = "Group", "Group is the package's `\"langwatch\": { \"group\" }`, from a closed list"
	}
	body := table([]string{header, "Package", "What it is (package.json `description`)", "Depended on by"}, rows) +
		"\n" + note + "; \"Depended on by\" counts workspace\n" +
		"packages that list the package in their `package.json`.\n"
	return page{Path: pagePath, Title: title, Body: body}
}

func (g *generator) appIndex() page {
	var rows [][]string
	for _, pkg := range g.ws.packages {
		if !strings.HasPrefix(pkg.Dir, "apps/") || strings.Count(pkg.Dir, "/") != 1 {
			continue
		}
		app := strings.TrimPrefix(pkg.Dir, "apps/")
		installs := "–"
		for _, list := range generatedLists {
			if list.app == app {
				installs = plural(g.ws.installedCount(app), list.half+" module")
			}
		}
		rows = append(rows, []string{code(app), code(pkg.Name), installs, cell(orDash(pkg.Description))})
	}
	body := table([]string{"App", "Package", "Installs", "What it is (package.json `description`)"}, rows) +
		"\nInstalls counts the entries of the app's generated module list (`pnpm generate:modules`).\n"
	return page{Path: "apps/README.md", Title: "Apps", Body: body}
}

// entitlements lists every entitlement a module's routes and procedures declare, with counts.
func (g *generator) entitlements(id string) string {
	counts := map[string]int{}
	var order []string
	for _, entitlement := range declaredEntitlements(g.facts[id].Process) {
		key := code(entitlement.Entitlement)
		if entitlement.Feature != "" {
			key += " (" + code(entitlement.Feature) + ")"
		}
		if counts[key] == 0 {
			order = append(order, key)
		}
		counts[key]++
	}
	sort.Strings(order)
	parts := make([]string, 0, len(order))
	for _, key := range order {
		parts = append(parts, fmt.Sprintf("%s ×%d", key, counts[key]))
	}
	return strings.Join(parts, ", ")
}

func declaredEntitlements(process ProcessFacts) []*Entitlement {
	var found []*Entitlement
	for index := range process.Rest {
		routes := process.Rest[index].Routes
		for inner := range routes {
			found = appendEntitlement(found, routes[inner].Entitlement)
		}
	}
	for index := range process.Trpc {
		procedures := process.Trpc[index].Procedures
		for inner := range procedures {
			found = appendEntitlement(found, procedures[inner].Entitlement)
		}
	}
	return found
}

func appendEntitlement(found []*Entitlement, entitlement *Entitlement) []*Entitlement {
	if entitlement == nil {
		return found
	}
	return append(found, entitlement)
}
