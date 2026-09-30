package workspace

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/internal/collate"
)

// Manifest is the part of a package.json the policies read; Raw keeps the rest.
type Manifest struct {
	Raw map[string]json.RawMessage
}

// String is a top-level string field, and whether it is one.
func (m Manifest) String(key string) (string, bool) {
	var value string
	if raw, ok := m.Raw[key]; ok && json.Unmarshal(raw, &value) == nil && raw[0] == '"' {
		return value, true
	}
	return "", false
}

// Printed is JSON.stringify of a field, "undefined" when absent, as a TS template prints it.
func (m Manifest) Printed(key string) string {
	raw, ok := m.Raw[key]
	if !ok {
		return "undefined"
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return string(raw)
	}
	out, _ := json.Marshal(value)
	return string(out)
}

// Script is scripts[name] when it is a string.
func (m Manifest) Script(name string) (string, bool) {
	var scripts map[string]json.RawMessage
	if json.Unmarshal(m.Raw["scripts"], &scripts) != nil {
		return "", false
	}
	return Manifest{Raw: scripts}.String(name)
}

// Package is a ClassifiedPackage.
type Package struct {
	Name, Root, ManifestPath string
	Manifest                 Manifest
	Kind                     string
	ApplicationRole          string
	CompositionRole          string
	Feature, FeatureRoot     string
	Subjects                 []string
	Enterprise               bool
}

var featureRoles = map[string]bool{"contract": true, "process": true, "browser": true, "browser-kit": true}

var applicationPackages = []struct{ role, path, name string }{
	{"ui", "ui", "@langwatch/ui"},
	{"api", "api", "@langwatch/platform-api"},
	{"worker", "worker", "@langwatch/worker"},
	{"server", "server", "@langwatch/server"},
	{"tasks", "tasks", "@langwatch/tasks"},
}

var standaloneApplications = []string{"scenario-child", "haven-web", "idpsim-web", "mailsim-web"}

var compositionPackages = []struct{ role, name string }{
	{"api", "@langwatch/enterprise-api"},
	{"worker", "@langwatch/enterprise-worker"},
}

const enterpriseLayoutAllowed = "Use the portable root, packages/composition/{api,worker,web}, or modules/<module>/{contract,server,web}."

type discovery struct {
	root       string
	catalogue  []CatalogueEntry
	byRoot     map[string]CatalogueEntry
	packages   []*Package
	violations []Violation
}

func (d *discovery) add(v Violation) { d.violations = append(d.violations, v) }

func readManifest(path string) (Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Manifest{}, err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return Manifest{}, fmt.Errorf("%s: %w", path, err)
	}
	return Manifest{Raw: raw}, nil
}

func directories(path string) []string {
	entries, _ := os.ReadDir(path)
	var out []string
	for _, e := range entries {
		if e.IsDir() && !ignoredDirectories[e.Name()] {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out
}

func quote(s string) string {
	out, _ := json.Marshal(s)
	return strings.NewReplacer(`<`, "<", `>`, ">", `&`, "&").Replace(string(out))
}

// FeaturePackageName is snapshot.ts featurePackageName.
func FeaturePackageName(feature, role string, enterprise bool) string {
	if enterprise {
		return "@langwatch/enterprise-" + strings.TrimPrefix(feature, "enterprise-") + "-" + role
	}
	return "@langwatch/" + feature + "-" + role
}

func (d *discovery) contractOnlyCore(id string) bool {
	index := slices.IndexFunc(d.catalogue, func(entry CatalogueEntry) bool { return entry.ID == id })
	if index < 0 || d.catalogue[index].Classification != "core" {
		return false
	}
	root := filepath.Join(d.root, d.catalogue[index].Root)
	return Exists(filepath.Join(root, "contract", "package.json")) && !Exists(filepath.Join(root, "process", "package.json"))
}

// featureTree reads every feature root under featuresRoot and its role packages.
func (d *discovery) featureTree(featuresRoot string, enterprise bool) error {
	for _, feature := range directories(featuresRoot) {
		featureRoot := filepath.Join(featuresRoot, feature)
		d.checkFeatureRoot(feature, featureRoot, enterprise)
		for _, role := range directories(featureRoot) {
			if err := d.featureRole(featureDir{feature, featureRoot, enterprise}, role); err != nil {
				return err
			}
		}
	}
	return nil
}

func (d *discovery) checkFeatureRoot(feature, featureRoot string, enterprise bool) {
	entry, registered := d.byRoot[featureRoot]
	providesCorePort := enterprise && !registered && d.contractOnlyCore(feature)
	switch {
	case !registered && !providesCorePort:
		d.add(Violation{Policy: "feature-catalogue", File: featureRoot,
			Message: fmt.Sprintf("Feature root %s is not registered in modules/catalogue.json.", quote(feature)),
			Allowed: "Use the singular catalogue identifier and record new ownership in its ADR and specification."})
	case registered && (entry.Classification == "enterprise") != enterprise:
		d.add(Violation{Policy: "feature-catalogue", File: featureRoot,
			Message: fmt.Sprintf("Feature %s is in the wrong core/Enterprise tree for its catalogue classification.", quote(feature))})
	}
	if manifest := filepath.Join(featureRoot, "package.json"); Exists(manifest) {
		d.add(Violation{Policy: "feature-layout", File: manifest, Message: "A feature ownership directory cannot itself be a package.",
			Allowed: "Put package.json inside contract, process, browser, or browser-kit."})
	}
}

// featureDir is one feature root: its id, its path and which tree it is in.
type featureDir struct {
	feature, root string
	enterprise    bool
}

// featureRole reads one role directory of a feature root, when it holds a package.
func (d *discovery) featureRole(dir featureDir, role string) error {
	feature, featureRoot, enterprise := dir.feature, dir.root, dir.enterprise
	manifestPath := filepath.Join(featureRoot, role, "package.json")
	if !Exists(manifestPath) {
		return nil
	}
	if !featureRoles[role] {
		d.add(Violation{Policy: "feature-layout", File: manifestPath, Message: fmt.Sprintf("Unknown feature package role %q.", role),
			Allowed: "Use contract, process, browser, or browser-kit; documentation belongs at the feature root."})
		return nil
	}
	manifest, err := readManifest(manifestPath)
	if err != nil {
		return err
	}
	expected := FeaturePackageName(feature, role, enterprise)
	name, ok := manifest.String("name")
	if !ok || name != expected {
		d.add(Violation{Policy: "feature-layout", File: manifestPath, Message: fmt.Sprintf("Package name must be %q, found %s.", expected, manifest.Printed("name"))})
	}
	if !ok {
		name = expected
	}
	entry := d.byRoot[featureRoot]
	d.packages = append(d.packages, &Package{Name: name, Root: filepath.Join(featureRoot, role), ManifestPath: manifestPath, Manifest: manifest,
		Kind: role, Feature: feature, FeatureRoot: featureRoot, Subjects: entry.Subjects, Enterprise: enterprise})
	return nil
}

// fixedPackage is a package at a fixed path: its root, the name it falls back to and its kind.
type fixedPackage struct {
	root, fallback, kind string
	enterprise           bool
}

// fixed reads a package at a fixed path, adding it; nil when it is absent.
func (d *discovery) fixed(f fixedPackage) (*Package, error) {
	manifestPath := filepath.Join(f.root, "package.json")
	if !Exists(manifestPath) {
		return nil, nil
	}
	manifest, err := readManifest(manifestPath)
	if err != nil {
		return nil, err
	}
	name, ok := manifest.String("name")
	if !ok {
		name = f.fallback
	}
	pkg := &Package{Name: name, Root: f.root, ManifestPath: manifestPath, Manifest: manifest, Kind: f.kind, Enterprise: f.enterprise}
	d.packages = append(d.packages, pkg)
	return pkg, nil
}

// misnamed reports whether a package's manifest name is not the fixed one.
func misnamed(pkg *Package, want string) bool {
	name, ok := pkg.Manifest.String("name")
	return !ok || name != want
}

func knownApplication(dir string) bool {
	return slices.Contains(standaloneApplications, dir) ||
		slices.ContainsFunc(applicationPackages, func(app struct{ role, path, name string }) bool { return app.path == dir })
}

func (d *discovery) applications() error {
	if shared := filepath.Join(d.root, "apps", "shared"); Exists(shared) {
		d.add(Violation{Policy: "application-layout", File: shared, Message: "apps/shared is not an application or a reusable package boundary.",
			Allowed: "Put product behaviour in its feature package and shared infrastructure in a deliberately named package."}) //nolint:misspell // the TS enforcer's message, byte for byte; the repository writes British English
	}
	apps := filepath.Join(d.root, "apps")
	d.unknownApplications(apps)
	for _, app := range applicationPackages {
		if err := d.application(apps, app); err != nil {
			return err
		}
	}
	return nil
}

func (d *discovery) unknownApplications(apps string) {
	for _, dir := range directories(apps) {
		manifest := filepath.Join(apps, dir, "package.json")
		if knownApplication(dir) || !Exists(manifest) || dir == "shared" {
			continue
		}
		d.add(Violation{Policy: "application-layout", File: manifest, Message: fmt.Sprintf("Unknown application workspace apps/%s.", dir),
			Allowed: "The fixed application roots are ui, api, worker, server, and tasks, beside the standalone scenario-child program and the internal consoles haven-web, idpsim-web and mailsim-web (ADR-160)."})
	}
}

func (d *discovery) application(apps string, app struct{ role, path, name string }) error {
	pkg, err := d.fixed(fixedPackage{root: filepath.Join(apps, app.path), fallback: app.name, kind: "application"})
	if err != nil || pkg == nil {
		return err
	}
	pkg.ApplicationRole = app.role
	if misnamed(pkg, app.name) {
		d.add(Violation{Policy: "application-layout", File: pkg.ManifestPath,
			Message: fmt.Sprintf("Application package at apps/%s must be named %q, found %s.", app.path, app.name, pkg.Manifest.Printed("name"))})
	}
	return nil
}

func (d *discovery) devRuntime() error {
	pkg, err := d.fixed(fixedPackage{root: filepath.Join(d.root, "tools", "dev-runtime"), fallback: "@langwatch/dev-runtime", kind: "dev-runtime"})
	if pkg != nil && pkg.Manifest.Printed("private") != "true" {
		d.add(Violation{Policy: "application-layout", File: pkg.ManifestPath, Message: "tools/dev-runtime must be a private contributor package.",
			Allowed: `Set "private": true; the combined runtime is never shipped.`})
	}
	return err
}

var (
	licenseHeading = regexp.MustCompile(`(?m)^#\s+LangWatch Enterprise License\s*$`)
	licenseFile    = regexp.MustCompile(`(?i)LICENSE\.md`)
	apache         = regexp.MustCompile(`(?i)Apache-2\.0`)
)

func (d *discovery) enterpriseDir() string { return filepath.Join(d.root, "enterprise") }

// hasEnterprisePackages is whether anything makes the Enterprise tree need its governance files.
func (d *discovery) hasEnterprisePackages() bool {
	enterprise := d.enterpriseDir()
	if Exists(filepath.Join(enterprise, "package.json")) {
		return true
	}
	for _, c := range compositionPackages {
		if Exists(filepath.Join(enterprise, "packages", "composition", c.role, "package.json")) {
			return true
		}
	}
	return slices.ContainsFunc(d.packages, func(pkg *Package) bool { return pkg.Enterprise })
}

// governance is checkEnterpriseGovernance: the license and README the tree needs.
func (d *discovery) governance() {
	license, readme := filepath.Join(d.enterpriseDir(), "LICENSE.md"), filepath.Join(d.enterpriseDir(), "README.md")
	has := d.hasEnterprisePackages()
	if has && !Exists(license) {
		d.add(Violation{Policy: "enterprise-layout", File: license, Message: "enterprise/LICENSE.md must govern every Enterprise package before source is placed in this tree."})
	}
	if has && !Exists(readme) {
		d.add(Violation{Policy: "enterprise-layout", File: readme, Message: "enterprise/README.md must explain and catalogue the governed Enterprise tree."})
	}
	if text, err := os.ReadFile(license); err == nil && !licenseHeading.Match(text) {
		d.add(Violation{Policy: "enterprise-license", File: license, Message: "enterprise/LICENSE.md must contain the LangWatch Enterprise License."})
	}
}

func (d *discovery) enterpriseRoot() error {
	manifest := filepath.Join(d.enterpriseDir(), "package.json")
	root, err := d.fixed(fixedPackage{root: d.enterpriseDir(), fallback: "@langwatch/enterprise", kind: "enterprise-root", enterprise: true})
	if err != nil || root == nil {
		return err
	}
	if misnamed(root, "@langwatch/enterprise") {
		d.add(Violation{Policy: "enterprise-layout", File: manifest,
			Message: `The portable Enterprise catalogue package must be named "@langwatch/enterprise".`})
	}
	if value, ok := root.Manifest.String("license"); !ok || !licenseFile.MatchString(value) || apache.MatchString(value) {
		d.add(Violation{Policy: "enterprise-license", File: manifest,
			Message: "The Enterprise root manifest must identify enterprise/LICENSE.md rather than an Apache license.",
			Allowed: `Use "license": "SEE LICENSE IN LICENSE.md".`})
	}
	return nil
}

func (d *discovery) compositions() error {
	for _, c := range compositionPackages {
		pkg, err := d.fixed(fixedPackage{root: filepath.Join(d.enterpriseDir(), "packages", "composition", c.role), fallback: c.name, kind: "enterprise-composition", enterprise: true})
		if err != nil {
			return err
		}
		if pkg != nil {
			pkg.CompositionRole = c.role
			if misnamed(pkg, c.name) {
				d.add(Violation{Policy: "enterprise-layout", File: pkg.ManifestPath,
					Message: fmt.Sprintf("Enterprise %s composition must be named %q, found %s.", c.role, c.name, pkg.Manifest.Printed("name"))})
			}
		}
	}
	return nil
}

// strayEnterpriseManifests is checkStrayEnterpriseManifests.
func (d *discovery) strayEnterpriseManifests() {
	if !Exists(d.enterpriseDir()) {
		return
	}
	for _, dir := range directories(d.enterpriseDir()) {
		if stray := filepath.Join(d.enterpriseDir(), dir, "package.json"); dir != "packages" && dir != "modules" && Exists(stray) {
			d.add(Violation{Policy: "enterprise-layout", File: stray,
				Message: fmt.Sprintf("Enterprise aggregate package at enterprise/%s is outside the fixed package layout.", dir), Allowed: enterpriseLayoutAllowed})
		}
	}
	composition := filepath.Join(d.enterpriseDir(), "packages", "composition")
	for _, dir := range directories(composition) {
		if stray := filepath.Join(composition, dir, "package.json"); dir != "api" && dir != "worker" && Exists(stray) {
			d.add(Violation{Policy: "enterprise-layout", File: stray, Message: fmt.Sprintf("Unknown Enterprise composition role %q.", dir), Allowed: "Use api, worker, or web."})
		}
	}
}

// enterpriseAggregates is checkEnterpriseAggregates.
func (d *discovery) enterpriseAggregates() error {
	for _, dir := range directories(filepath.Join(d.root, "packages")) {
		path := filepath.Join(d.root, "packages", dir, "package.json")
		if !Exists(path) {
			continue
		}
		m, err := readManifest(path)
		if err != nil {
			return err
		}
		if name, _ := m.String("name"); strings.HasPrefix(name, "@langwatch/enterprise") {
			d.add(Violation{Policy: "enterprise-layout", File: path, Message: name + " is an Enterprise aggregate outside enterprise.", Allowed: enterpriseLayoutAllowed})
		}
	}
	d.apacheDescendants()
	return nil
}

// apacheDescendants refuses an Enterprise package that claims Apache-2.0.
func (d *discovery) apacheDescendants() {
	for _, pkg := range d.packages {
		if value, _ := pkg.Manifest.String("license"); pkg.Enterprise && pkg.Kind != "enterprise-root" && apache.MatchString(value) {
			d.add(Violation{Policy: "enterprise-license", File: pkg.ManifestPath, Message: "An Enterprise descendant package cannot claim that its source is Apache-2.0.",
				Allowed: "Inherit the LangWatch Enterprise license rooted at enterprise/LICENSE.md."})
		}
	}
}

func (d *discovery) tooling() error {
	pkg, err := d.fixed(fixedPackage{root: filepath.Join(d.root, "packages", "design-system"), fallback: "@langwatch/design-system", kind: "design-system"})
	if err != nil {
		return err
	}
	if pkg != nil {
		if misnamed(pkg, "@langwatch/design-system") {
			d.add(Violation{Policy: "feature-layout", File: pkg.ManifestPath,
				Message: `The design-system package must be named "@langwatch/design-system".`})
		}
	}
	if _, err := d.fixed(fixedPackage{root: filepath.Join(d.root, "packages", "architecture-enforcer"), fallback: "@langwatch/architecture-enforcer", kind: "tooling"}); err != nil {
		return err
	}
	_, err = d.fixed(fixedPackage{root: filepath.Join(d.root, "packages", "config"), fallback: "@langwatch/config", kind: "config"})
	return err
}

func (d *discovery) duplicateNames() {
	names := map[string]string{}
	for _, pkg := range d.packages {
		if first, ok := names[pkg.Name]; ok {
			d.add(Violation{Policy: "feature-layout", File: pkg.ManifestPath, Message: fmt.Sprintf("Duplicate package name %q; first declared by %s.", pkg.Name, first)})
		} else {
			names[pkg.Name] = pkg.ManifestPath
		}
	}
}

// discover is discoverClassifiedPackages, step for step in its order.
func discover(root string) (*discovery, error) {
	d := &discovery{root: root, byRoot: map[string]CatalogueEntry{}}
	reader := catalogueReader{path: filepath.Join(root, "modules", "catalogue.json")}
	d.catalogue = reader.read()
	d.violations = reader.violations
	for _, entry := range d.catalogue {
		d.byRoot[filepath.Join(root, entry.Root)] = entry
	}
	steps := []func() error{
		func() error { return d.featureTree(filepath.Join(root, "modules"), false) },
		func() error { return d.featureTree(filepath.Join(root, "enterprise", "modules"), true) },
		d.applications,
		d.devRuntime,
		func() error { d.governance(); return nil },
		d.enterpriseRoot,
		d.compositions,
		func() error { d.strayEnterpriseManifests(); return nil },
		d.enterpriseAggregates,
		d.tooling,
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return nil, err
		}
	}
	d.duplicateNames()
	return d, nil
}

// CatalogueEntry is one modules/catalogue.json feature.
type CatalogueEntry struct {
	ID, Root, Classification string
	Subjects                 []string
}

var featureName = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

var catalogueKeys = []string{"classification", "id", "root", "subjects"}

// catalogueReader is feature-catalogue.ts readFeatureCatalogue.
type catalogueReader struct {
	path       string
	violations []Violation
	ids, roots map[string]bool
	owners     map[string]string
}

func (r *catalogueReader) issue(message, allowed string) {
	r.violations = append(r.violations, Violation{Policy: "feature-catalogue", File: r.path, Message: message, Allowed: allowed})
}

func sortedSubjects(subjects []string) bool {
	for i, subject := range subjects {
		if !featureName.MatchString(subject) || (i > 0 && collate.Compare(subjects[i-1], subject) >= 0) {
			return false
		}
	}
	return len(subjects) > 0
}

func parseEntry(raw json.RawMessage) (CatalogueEntry, bool) {
	var entry struct {
		Classification *string
		ID             *string `json:"id"`
		Root           *string
		Subjects       *[]string
	}
	if json.Unmarshal(raw, &entry) != nil || entry.Classification == nil || entry.ID == nil || entry.Root == nil || entry.Subjects == nil {
		return CatalogueEntry{}, false
	}
	valid := (*entry.Classification == "core" || *entry.Classification == "enterprise") && featureName.MatchString(*entry.ID) && sortedSubjects(*entry.Subjects)
	return CatalogueEntry{ID: *entry.ID, Root: *entry.Root, Classification: *entry.Classification, Subjects: *entry.Subjects}, valid
}

// features is the features array, or nil after reporting why there is none.
func (r *catalogueReader) features() []json.RawMessage {
	data, err := os.ReadFile(r.path)
	if err != nil {
		r.issue("The repository must declare its singular feature ownership catalogue.",
			"Add modules/catalogue.json with version 0 and its core and Enterprise feature entries.")
		return nil
	}
	var catalogue struct {
		Features *[]json.RawMessage
		Version  *json.Number
	}
	err = json.Unmarshal(data, &catalogue)
	var syntax *json.SyntaxError
	switch {
	case errors.As(err, &syntax):
		r.issue("Feature catalogue must be valid JSON: "+err.Error(), "")
	case err != nil, catalogue.Features == nil, catalogue.Version == nil || catalogue.Version.String() != "0":
		r.issue("Feature catalogue must contain version 0 and a features array.", "")
	default:
		return *catalogue.Features
	}
	return nil
}

// entry validates one raw entry's shape.
func (r *catalogueReader) entry(index int, raw json.RawMessage) (CatalogueEntry, bool) {
	if len(raw) == 0 || raw[0] != '{' {
		r.issue(fmt.Sprintf("Feature catalogue entry %d must be an object.", index), "")
		return CatalogueEntry{}, false
	}
	if slices.ContainsFunc(OrderedKeys(raw), func(key string) bool { return !slices.Contains(catalogueKeys, key) }) {
		r.issue(fmt.Sprintf("Feature catalogue entry %d must contain only id, root, classification, and subjects.", index), "")
		return CatalogueEntry{}, false
	}
	entry, ok := parseEntry(raw)
	if !ok {
		r.issue(fmt.Sprintf("Feature catalogue entry %d is malformed.", index),
			"Use a singular lower-case kebab-case id, its derived root, a core or enterprise classification, and a sorted duplicate-free subjects array.")
	}
	return entry, ok
}

// check is checkCatalogueEntry: the derived root and cross-entry uniqueness.
func (r *catalogueReader) check(entry CatalogueEntry) {
	expected := "modules/" + entry.ID
	if entry.Classification == "enterprise" {
		expected = "enterprise/modules/" + entry.ID
	}
	if entry.Root != expected {
		r.issue(fmt.Sprintf("Feature %s must use root %s, found %s.", quote(entry.ID), quote(expected), quote(entry.Root)), "")
	}
	if r.ids[entry.ID] {
		r.issue(fmt.Sprintf("Feature id %s is declared more than once.", quote(entry.ID)), "")
	}
	if r.roots[entry.Root] {
		r.issue(fmt.Sprintf("Feature root %s is declared more than once.", quote(entry.Root)), "")
	}
	r.ids[entry.ID], r.roots[entry.Root] = true, true
	for _, subject := range entry.Subjects {
		if owner, ok := r.owners[subject]; ok && owner != entry.ID {
			r.issue(fmt.Sprintf("Subject %s is owned by both %s and %s.", quote(subject), quote(owner), quote(entry.ID)), "")
		} else {
			r.owners[subject] = entry.ID
		}
	}
}

func (r *catalogueReader) read() []CatalogueEntry {
	r.ids, r.roots, r.owners = map[string]bool{}, map[string]bool{}, map[string]string{}
	var entries []CatalogueEntry
	for index, raw := range r.features() {
		if entry, ok := r.entry(index, raw); ok {
			r.check(entry)
			entries = append(entries, entry)
		}
	}
	if !catalogueSorted(entries) {
		r.issue("Feature catalogue entries must be sorted by classification (core first) and then id.", "")
	}
	return entries
}

// catalogueSorted is whether entries are core first, then by id.
func catalogueSorted(entries []CatalogueEntry) bool {
	sorted := slices.Clone(entries)
	sort.SliceStable(sorted, func(i, j int) bool {
		if left, right := sorted[i].Classification == "enterprise", sorted[j].Classification == "enterprise"; left != right {
			return right
		}
		return collate.Compare(sorted[i].ID, sorted[j].ID) < 0
	})
	return slices.EqualFunc(sorted, entries, func(a, b CatalogueEntry) bool { return a.ID == b.ID })
}
