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
}

// InertReport is a feature file with scenarios but none enforced.
type InertReport struct {
	Feature        string
	TotalScenarios int
	Unimplemented  int
}

// PartialReport is a feature file where some scenarios are enforced and some untagged.
type PartialReport struct {
	Feature        string
	TotalScenarios int
	Enforced       int
	Untagged       int
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
	Enforced      []Report
	Legacy        []LegacyReport
	Inert         []InertReport
	ExemptInert   []InertReport
	NewInert      []InertReport
	Partial       []PartialReport
	ExemptPartial []PartialReport
	NewPartial    []PartialReport
	StaleLegacy   []LegacyReport
	StaleInert    []string
	StalePartial  []string
	Unknown       []Binding
	ListErrors    []string
}

// Lists are the roots and ratcheted lists a run is judged against.
type Lists struct {
	TSRoots, BatsRoots, ShellRoots, GoRoots, PythonRoots []string
	LegacyUnbound, LegacyInert, LegacyPartial            []string
}

// DefaultLists are the Node tool's configured roots and lists.
func DefaultLists() Lists {
	return Lists{tsTestRoots, batsTestRoots, shellTestRoots, goTestRoots, pythonTestRoots, legacyUnbound, legacyInert, legacyPartial}
}

func has(tags []string, want func(string) bool) bool { return slices.ContainsFunc(tags, want) }

func isBoundTag(t string) bool { return boundTags[t] }

func isUnimplemented(t string) bool { return t == unimplemented }

func buildReport(feature string, all []Scenario, byTitle map[string][]BindingRef) Report {
	r := Report{Feature: feature, Scenarios: []AnnotatedScenario{}, Unbound: []Scenario{}, TotalScenarios: len(all)}
	for _, s := range all {
		if !r.countTags(s) {
			continue
		}
		binds := byTitle[s.Title]
		if len(binds) == 0 {
			r.Unbound = append(r.Unbound, s)
		}
		r.Scenarios = append(r.Scenarios, AnnotatedScenario{Scenario: s, Bindings: binds})
	}
	return r
}

// countTags counts s as parked or untagged, and reports whether it is enforced:
// bound by a level tag and not parked.
func (r *Report) countTags(s Scenario) bool {
	bound, parked := has(s.Tags, isBoundTag), has(s.Tags, isUnimplemented)
	if parked {
		r.UnimplementedScenarios++
	}
	if !bound && !parked {
		r.UntaggedScenarios++
	}
	return bound && !parked
}

func isInert(r Report) bool { return r.TotalScenarios > 0 && len(r.Scenarios) == 0 }

func isPartiallyTagged(r Report) bool { return len(r.Scenarios) > 0 && r.UntaggedScenarios > 0 }

func toInert(r Report) InertReport {
	return InertReport{r.Feature, r.TotalScenarios, r.UnimplementedScenarios}
}

func toPartial(r Report) PartialReport {
	return PartialReport{r.Feature, r.TotalScenarios, len(r.Scenarios), r.UntaggedScenarios}
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
	var errs []string
	for _, list := range []struct {
		name    string
		entries []string
	}{{"LEGACY_UNBOUND", l.LegacyUnbound}, {"LEGACY_PARTIAL", l.LegacyPartial}} {
		for _, e := range list.entries {
			if slices.Contains(l.LegacyInert, e) {
				errs = append(errs, e+" is listed in LEGACY_INERT and "+list.name+" — the first says the file enforces nothing, the second says it enforces something, keep the one that matches the file and delete the other")
			}
		}
	}
	errs = append(errs, validateExemptionList(repo, exemptionList{"LEGACY_UNBOUND", l.LegacyUnbound}, all)...)
	errs = append(errs, validateExemptionList(repo, exemptionList{"LEGACY_INERT", l.LegacyInert}, all)...)
	return append(errs, validateExemptionList(repo, exemptionList{"LEGACY_PARTIAL", l.LegacyPartial}, all)...)
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
	run := &analysis{lists: l, features: features, a: Analysis{ListErrors: validateLists(repo, l, features)}}

	var bindings []Binding
	done := make(chan struct{})
	go func() { bindings = collectBindings(repo, l); close(done) }()
	scenarios := parallel.Map(features, func(f string) []Scenario { return ParseFeature(readSource(filepath.Join(repo, f))) })
	<-done

	run.a.Unknown = unknownBindings(bindings, scenarios)
	all := run.addReports(scenarios, bindingsByTitle(bindings))
	inertSeen := run.addInert()
	partialSeen := run.addPartial(all)
	run.addStale(inertSeen, partialSeen)
	return run.a, nil
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

// addInert files each enforced report that enforces nothing, exempt or new,
// and answers the features it filed.
func (run *analysis) addInert() map[string]bool {
	inertSeen := map[string]bool{}
	for _, r := range run.a.Enforced {
		if !isInert(r) {
			continue
		}
		ir := toInert(r)
		run.a.Inert = append(run.a.Inert, ir)
		inertSeen[r.Feature] = true
		if slices.Contains(run.lists.LegacyInert, r.Feature) {
			run.a.ExemptInert = append(run.a.ExemptInert, ir)
		} else {
			run.a.NewInert = append(run.a.NewInert, ir)
		}
	}
	return inertSeen
}

// addPartial files each partially tagged report, exempt or new, and answers
// the features it filed.
func (run *analysis) addPartial(all []Report) map[string]bool {
	partialSeen := map[string]bool{}
	for _, r := range all {
		if !isPartiallyTagged(r) {
			continue
		}
		pr := toPartial(r)
		run.a.Partial = append(run.a.Partial, pr)
		partialSeen[r.Feature] = true
		if slices.Contains(run.lists.LegacyPartial, r.Feature) {
			run.a.ExemptPartial = append(run.a.ExemptPartial, pr)
		} else {
			run.a.NewPartial = append(run.a.NewPartial, pr)
		}
	}
	return partialSeen
}

// addStale files the list entries that no longer describe their file.
func (run *analysis) addStale(inertSeen, partialSeen map[string]bool) {
	for _, r := range run.a.Legacy {
		if r.Unbound == 0 {
			run.a.StaleLegacy = append(run.a.StaleLegacy, r)
		}
	}
	run.a.StaleInert = staleEntries(run.lists.LegacyInert, run.features, inertSeen)
	run.a.StalePartial = staleEntries(run.lists.LegacyPartial, run.features, partialSeen)
}

// staleEntries is each listed feature that exists but was not seen.
func staleEntries(listed, features []string, seen map[string]bool) []string {
	var stale []string
	for _, f := range listed {
		if slices.Contains(features, f) && !seen[f] {
			stale = append(stale, f)
		}
	}
	return stale
}
