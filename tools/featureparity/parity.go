// Package featureparity is the Go port of
// packages/architecture-enforcer/src/tools/check-feature-parity.ts: every
// enforced scenario in every .feature file must be bound to a test by a
// `@scenario "<title>"` annotation. Output and exit code match the Node tool.
package featureparity

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"unsafe"

	"github.com/langwatch/langwatch/tools/internal/parallel"
)

var (
	boundTags     = map[string]bool{"@unit": true, "@integration": true, "@e2e": true, "@regression": true}
	unimplemented = "@unimplemented"
	tsTestFile    = regexp.MustCompile(`\.(?:test|spec)\.(?:tsx?|mjs)$`)
	pyTestFile    = regexp.MustCompile(`^test_[^\n\r\x{2028}\x{2029}]+\.py$`)
)

// AnnotatedScenario is an enforced scenario with the tests that bind it.
type AnnotatedScenario struct {
	Scenario
	Bindings []BindingRef
}

// Report is one feature file's binding result: its enforced scenarios and the
// ones no test binds.
type Report struct {
	Feature                string
	Scenarios              []AnnotatedScenario
	Unbound                []Scenario
	TotalScenarios         int
	UnimplementedScenarios int
	UntaggedScenarios      int
	// Untagged carry neither a binding tag nor @unimplemented.
	Untagged []Scenario
	// UnimplementedWithoutIssue are parked scenarios citing no tracked issue.
	UnimplementedWithoutIssue []Scenario
}

// InertReport is a feature file with scenarios but none enforced.
type InertReport struct {
	Feature        string
	TotalScenarios int
	Unimplemented  int
}

// LegacyReport is a feature file's bound and unbound counts, with the unbound titles.
type LegacyReport struct {
	Feature       string
	Bound         int
	Unbound       int
	Total         int
	UnboundTitles []string
}

// Analysis is everything the check worked out; report, verdict and JSON are
// three views of it.
type Analysis struct {
	Enforced                  []Report
	Legacy                    []LegacyReport
	Inert                     []InertReport
	Untagged                  FrozenVerdict
	UnimplementedWithoutIssue FrozenVerdict
	AnnotationsOnUntagged     AnnotationVerdict
	StaleLegacy               []LegacyReport
	Unknown                   []Binding
	ListErrors                []string
}

// Lists are the roots and the ratcheted list a run is judged against.
type Lists struct {
	TSRoots, BatsRoots, ShellRoots, GoRoots, PythonRoots []string
	LegacyUnbound                                        []string
}

// DefaultLists are the Node tool's configured roots and list.
func DefaultLists() Lists {
	return Lists{tsTestRoots, batsTestRoots, shellTestRoots, goTestRoots, pythonTestRoots, legacyUnbound}
}

func has(tags []string, want func(string) bool) bool { return slices.ContainsFunc(tags, want) }

func isBoundTag(t string) bool { return boundTags[t] }

func isUnimplemented(t string) bool { return t == unimplemented }

func buildReport(feature string, all []Scenario, byTitle map[string][]BindingRef) Report {
	r := Report{Feature: feature, Scenarios: []AnnotatedScenario{}, Unbound: []Scenario{}, TotalScenarios: len(all),
		Untagged: []Scenario{}, UnimplementedWithoutIssue: []Scenario{}}
	for _, s := range all {
		bound, parked := has(s.Tags, isBoundTag), has(s.Tags, isUnimplemented)
		if parked {
			r.UnimplementedScenarios++
			if !s.CitesIssue {
				r.UnimplementedWithoutIssue = append(r.UnimplementedWithoutIssue, s)
			}
		}
		if !bound && !parked {
			r.Untagged = append(r.Untagged, s)
		}
		if !bound || parked {
			continue
		}
		binds := byTitle[s.Title]
		if len(binds) == 0 {
			r.Unbound = append(r.Unbound, s)
		}
		r.Scenarios = append(r.Scenarios, AnnotatedScenario{Scenario: s, Bindings: binds})
	}
	r.UntaggedScenarios = len(r.Untagged)
	return r
}

func isInert(r Report) bool { return r.TotalScenarios > 0 && len(r.Scenarios) == 0 }

func toInert(r Report) InertReport {
	return InertReport{r.Feature, r.TotalScenarios, r.UnimplementedScenarios}
}

func toLegacy(r Report) LegacyReport {
	titles := []string{}
	for _, s := range r.Unbound {
		titles = append(titles, s.Title)
	}
	return LegacyReport{r.Feature, len(r.Scenarios) - len(r.Unbound), len(r.Unbound), len(r.Scenarios), titles}
}

// exemptionList is one ratcheted list by its name in the Node tool.
type exemptionList struct {
	name    string
	entries []string
}

func validateExemptionList(repo string, list exemptionList, all []string) []string {
	name, entries := list.name, list.entries
	var errs []string
	seen := map[string]bool{}
	for _, e := range entries {
		if seen[e] {
			errs = append(errs, name+" contains duplicate entry: "+e)
			continue
		}
		seen[e] = true
		if slices.Contains(all, e) {
			continue
		}
		if _, err := os.Stat(filepath.Join(repo, e)); err != nil {
			errs = append(errs, name+" entry does not resolve to an existing .feature file: "+e)
		} else {
			errs = append(errs, name+" entry is not discovered under the configured spec roots: "+e)
		}
	}
	return errs
}

func validateLists(repo string, l Lists, all []string) []string {
	return validateExemptionList(repo, exemptionList{"LEGACY_UNBOUND", l.LegacyUnbound}, all)
}

// readSource reads a file as a string without copying it: the bytes are
// never written again once read.
func readSource(path string) string {
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		return ""
	}
	return unsafe.String(&b[0], len(b))
}

// collectBindings reads every test file under the roots, in the Node tool's
// collector order, scanning files in parallel.
func collectBindings(repo string, l Lists) []Binding {
	abs := func(roots []string) []string {
		out := make([]string, len(roots))
		for i, r := range roots {
			out[i] = filepath.Join(repo, r)
		}
		return out
	}
	type job struct {
		path string
		scan func(file, src string) []Binding
	}
	var jobs []job
	add := func(roots []string, keep func(string) bool, scan func(file, src string) []Binding) {
		for _, p := range walkRoots(abs(roots), keep) {
			jobs = append(jobs, job{p, scan})
		}
	}
	suffix := func(s string) func(string) bool { return func(n string) bool { return strings.HasSuffix(n, s) } }
	add(l.TSRoots, tsTestFile.MatchString, func(f, src string) []Binding { return blockBindings(f, src, IsFollowedByTestCall) })
	add(l.BatsRoots, suffix(".bats"), func(f, src string) []Binding { return hashBindings(f, src, nextCodeLineMatches(batsTestLineRE)) })
	add(l.ShellRoots, suffix(".sh"), func(f, src string) []Binding { return hashBindings(f, src, nextCodeLineMatches(shellTestLineRE)) })
	add(l.GoRoots, suffix("_test.go"), func(f, src string) []Binding { return blockBindings(f, src, IsFollowedByGoTestFunc) })
	add(l.PythonRoots, pyTestFile.MatchString, pythonBindings)

	var out []Binding
	for _, bs := range parallel.Map(jobs, func(j job) []Binding { return j.scan(rel(repo, j.path), readSource(j.path)) }) {
		out = append(out, bs...)
	}
	return out
}

// Analyze runs the whole check against the tree at repo.
func Analyze(repo string, l Lists) (Analysis, error) {
	roots, err := specRoots(repo)
	if err != nil {
		return Analysis{}, err
	}
	features, err := DiscoverFeatureFiles(repo, roots)
	if err != nil {
		return Analysis{}, err
	}
	frozen, err := loadFrozen(repo)
	if err != nil {
		return Analysis{}, err
	}
	run := &analysis{lists: l, features: features, a: Analysis{ListErrors: validateLists(repo, l, features)}}

	var bindings []Binding
	done := make(chan struct{})
	go func() { bindings = collectBindings(repo, l); close(done) }()
	scenarios := parallel.Map(features, func(f string) []Scenario { return ParseFeature(readSource(filepath.Join(repo, f))) })
	<-done

	run.a.Unknown = unknownBindings(bindings, scenarios)
	all := run.addReports(scenarios, bindingsByTitle(bindings))
	run.a.Inert = []InertReport{}
	for i := range all {
		if isInert(all[i]) {
			run.a.Inert = append(run.a.Inert, toInert(all[i]))
		}
	}
	// Per scenario, across every file, legacy ones included: a listed file can
	// no longer hide a new untagged scenario behind its older ones.
	run.a.Untagged = compareFrozen(refsOf(all, func(r Report) []Scenario { return r.Untagged }), frozen.Untagged)
	run.a.UnimplementedWithoutIssue = compareFrozen(refsOf(all, func(r Report) []Scenario { return r.UnimplementedWithoutIssue }), frozen.UnimplementedWithoutIssue)
	var declared []DeclaredScenario
	for i, f := range features {
		for _, s := range scenarios[i] {
			declared = append(declared, DeclaredScenario{f, s})
		}
	}
	run.a.AnnotationsOnUntagged = frozenAnnotations(findAnnotationsOnUntagged(bindings, declared), frozen.AnnotatedUntagged)
	// Every legacy entry must still have an unbound scenario.
	for _, r := range run.a.Legacy {
		if r.Unbound == 0 {
			run.a.StaleLegacy = append(run.a.StaleLegacy, r)
		}
	}
	return run.a, nil
}

// refsOf names the scenarios pick selects from each report.
func refsOf(reports []Report, pick func(Report) []Scenario) []ScenarioRef {
	refs := []ScenarioRef{}
	for i := range reports {
		for _, s := range pick(reports[i]) {
			refs = append(refs, ScenarioRef{reports[i].Feature, s.Title, s.Line})
		}
	}
	return refs
}

// analysis is one Analyze over its feature files, judged by its lists.
type analysis struct {
	lists    Lists
	features []string
	a        Analysis
}

// bindingsByTitle groups the bindings' refs by the scenario title they name.
func bindingsByTitle(bindings []Binding) map[string][]BindingRef {
	byTitle := map[string][]BindingRef{}
	for _, b := range bindings {
		byTitle[b.Title] = append(byTitle[b.Title], b.Ref)
	}
	return byTitle
}

// unknownBindings is every binding naming a title no feature file holds.
func unknownBindings(bindings []Binding, scenarios [][]Scenario) []Binding {
	known := map[string]bool{}
	for _, ss := range scenarios {
		for _, s := range ss {
			known[s.Title] = true
		}
	}
	unknown := []Binding{}
	for _, b := range bindings {
		if !known[b.Title] {
			unknown = append(unknown, b)
		}
	}
	return unknown
}

// addReports builds each feature's report and files it as legacy or enforced.
func (run *analysis) addReports(scenarios [][]Scenario, byTitle map[string][]BindingRef) []Report {
	var all []Report
	for i, f := range run.features {
		r := buildReport(f, scenarios[i], byTitle)
		all = append(all, r)
		if slices.Contains(run.lists.LegacyUnbound, f) {
			run.a.Legacy = append(run.a.Legacy, toLegacy(r))
		} else {
			run.a.Enforced = append(run.a.Enforced, r)
		}
	}
	return all
}
