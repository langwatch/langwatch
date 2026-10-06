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
		bound, parked := has(s.Tags, isBoundTag), has(s.Tags, isUnimplemented)
		if parked {
			r.UnimplementedScenarios++
		}
		if !bound && !parked {
			r.UntaggedScenarios++
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
	return r
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

func validateExemptionList(repo, name string, entries, all []string) []string {
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
	errs = append(errs, validateExemptionList(repo, "LEGACY_UNBOUND", l.LegacyUnbound, all)...)
	errs = append(errs, validateExemptionList(repo, "LEGACY_INERT", l.LegacyInert, all)...)
	return append(errs, validateExemptionList(repo, "LEGACY_PARTIAL", l.LegacyPartial, all)...)
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
	a := Analysis{ListErrors: validateLists(repo, l, features)}

	var bindings []Binding
	done := make(chan struct{})
	go func() { bindings = collectBindings(repo, l); close(done) }()
	scenarios := parallel.Map(features, func(f string) []Scenario { return ParseFeature(readSource(filepath.Join(repo, f))) })
	<-done

	byTitle := map[string][]BindingRef{}
	for _, b := range bindings {
		byTitle[b.Title] = append(byTitle[b.Title], b.Ref)
	}
	known := map[string]bool{}
	for _, ss := range scenarios {
		for _, s := range ss {
			known[s.Title] = true
		}
	}
	a.Unknown = []Binding{}
	for _, b := range bindings {
		if !known[b.Title] {
			a.Unknown = append(a.Unknown, b)
		}
	}

	var all []Report
	for i, f := range features {
		r := buildReport(f, scenarios[i], byTitle)
		all = append(all, r)
		if slices.Contains(l.LegacyUnbound, f) {
			a.Legacy = append(a.Legacy, toLegacy(r))
		} else {
			a.Enforced = append(a.Enforced, r)
		}
	}

	inertSeen := map[string]bool{}
	for _, r := range a.Enforced {
		if isInert(r) {
			ir := toInert(r)
			a.Inert = append(a.Inert, ir)
			inertSeen[r.Feature] = true
			if slices.Contains(l.LegacyInert, r.Feature) {
				a.ExemptInert = append(a.ExemptInert, ir)
			} else {
				a.NewInert = append(a.NewInert, ir)
			}
		}
	}
	partialSeen := map[string]bool{}
	for _, r := range all {
		if isPartiallyTagged(r) {
			pr := toPartial(r)
			a.Partial = append(a.Partial, pr)
			partialSeen[r.Feature] = true
			if slices.Contains(l.LegacyPartial, r.Feature) {
				a.ExemptPartial = append(a.ExemptPartial, pr)
			} else {
				a.NewPartial = append(a.NewPartial, pr)
			}
		}
	}
	for _, r := range a.Legacy {
		if r.Unbound == 0 {
			a.StaleLegacy = append(a.StaleLegacy, r)
		}
	}
	for _, f := range l.LegacyInert {
		if slices.Contains(features, f) && !inertSeen[f] {
			a.StaleInert = append(a.StaleInert, f)
		}
	}
	for _, f := range l.LegacyPartial {
		if slices.Contains(features, f) && !partialSeen[f] {
			a.StalePartial = append(a.StalePartial, f)
		}
	}
	return a, nil
}
