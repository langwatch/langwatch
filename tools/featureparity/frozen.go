package featureparity

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// frozenRelative is the file both this tool and the Node tool read for the
// scenarios they tolerate.
const frozenRelative = "packages/architecture-enforcer/src/tools/feature-parity-frozen.json"

// FrozenList is one frozen list: feature (or test) file to scenario titles,
// keeping the file's key order, which the stale listing follows.
type FrozenList struct {
	Files  []string
	Titles map[string][]string
}

// Frozen is the per-scenario tolerance, read from frozenRelative.
type Frozen struct {
	Untagged, UnimplementedWithoutIssue, AnnotatedUntagged FrozenList
}

// ScenarioRef names a scenario by where it lives. Line 0 means unknown.
type ScenarioRef struct {
	Feature string
	Title   string
	Line    int
}

// FrozenVerdict compares the scenarios that break a rule with the frozen
// pairs that tolerate them.
type FrozenVerdict struct {
	Fresh, Stale []ScenarioRef
	Tolerated    int
}

// loadFrozen reads the frozen file under repo; an absent file freezes nothing.
func loadFrozen(repo string) (Frozen, error) {
	raw, err := os.ReadFile(filepath.Join(repo, frozenRelative))
	if errors.Is(err, fs.ErrNotExist) {
		return Frozen{}, nil
	}
	if err != nil {
		return Frozen{}, err
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	if err := expectDelim(dec, '{'); err != nil {
		return Frozen{}, err
	}
	var f Frozen
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return Frozen{}, err
		}
		name, _ := key.(string)
		switch name {
		case "untagged":
			f.Untagged, err = decodeFrozenList(dec)
		case "unimplementedWithoutIssue":
			f.UnimplementedWithoutIssue, err = decodeFrozenList(dec)
		case "annotatedUntagged":
			f.AnnotatedUntagged, err = decodeFrozenList(dec)
		default:
			var skip json.RawMessage
			err = dec.Decode(&skip)
		}
		if err != nil {
			return Frozen{}, fmt.Errorf("%s: %w", frozenRelative, err)
		}
	}
	return f, nil
}

func expectDelim(dec *json.Decoder, want json.Delim) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	if d, ok := tok.(json.Delim); !ok || d != want {
		return fmt.Errorf("%s: expected %q", frozenRelative, want)
	}
	return nil
}

func decodeFrozenList(dec *json.Decoder) (FrozenList, error) {
	list := FrozenList{Titles: map[string][]string{}}
	if err := expectDelim(dec, '{'); err != nil {
		return list, err
	}
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return list, err
		}
		file, _ := key.(string)
		var titles []string
		if err := dec.Decode(&titles); err != nil {
			return list, err
		}
		if _, seen := list.Titles[file]; !seen {
			list.Files = append(list.Files, file)
		}
		list.Titles[file] = append(list.Titles[file], titles...)
	}
	return list, expectDelim(dec, '}')
}

// compareFrozen counts titles, so a file holding the same title twice needs
// it listed twice. Fresh breaks the rule unlisted; stale is listed but no
// longer breaks it.
func compareFrozen(observed []ScenarioRef, frozen FrozenList) FrozenVerdict {
	remaining := frozenCounts(frozen)
	v := FrozenVerdict{Fresh: []ScenarioRef{}, Stale: []ScenarioRef{}}
	for _, ref := range observed {
		if !consume(remaining, [2]string{ref.Feature, ref.Title}) {
			v.Fresh = append(v.Fresh, ref)
		}
	}
	for _, file := range frozen.Files {
		for _, title := range frozen.Titles[file] {
			if consume(remaining, [2]string{file, title}) {
				v.Stale = append(v.Stale, ScenarioRef{Feature: file, Title: title})
			}
		}
	}
	v.Tolerated = len(observed) - len(v.Fresh)
	return v
}

// frozenCounts is how many times each (file, title) is listed.
func frozenCounts(frozen FrozenList) map[[2]string]int {
	counts := map[[2]string]int{}
	for _, file := range frozen.Files {
		for _, title := range frozen.Titles[file] {
			counts[[2]string{file, title}]++
		}
	}
	return counts
}

// consume uses up one listing of key and reports whether one was left.
func consume(remaining map[[2]string]int, key [2]string) bool {
	if remaining[key] > 0 {
		remaining[key]--
		return true
	}
	return false
}

// AnnotationOnUntagged is an `@scenario` annotation whose scenario carries no
// binding tag, so binds nothing.
type AnnotationOnUntagged struct {
	Title      string
	Ref        BindingRef
	Scenario   ScenarioRef
	MissingTag string
	// Parked: the scenario is @unimplemented although a test now binds it.
	Parked bool
}

// AnnotationVerdict is the frozen comparison for annotations on untagged scenarios.
type AnnotationVerdict struct {
	Fresh     []AnnotationOnUntagged
	Stale     []ScenarioRef
	Tolerated int
}

// DeclaredScenario is a scenario with the feature file declaring it.
type DeclaredScenario struct {
	Feature  string
	Scenario Scenario
}

var (
	integrationLane = regexp.MustCompile(`\.integration\.|/integration/`)
	e2eLane         = regexp.MustCompile(`\.e2e\.|/e2e/`)
	regressionLane  = regexp.MustCompile(`\.regression\.`)
	scenarioLane    = regexp.MustCompile(`\.scenario\.test\.`)
)

// laneTagForTest is the tag a test's own file says its scenario is missing:
// the lane it runs in, read from its name, and @unit when the name says nothing.
func laneTagForTest(testFile string) string {
	switch {
	case integrationLane.MatchString(testFile):
		return "@integration"
	case e2eLane.MatchString(testFile):
		return "@e2e"
	case regressionLane.MatchString(testFile):
		return "@regression"
	case scenarioLane.MatchString(testFile):
		return "@e2e"
	}
	return "@unit"
}

// findAnnotationsOnUntagged is every binding naming a scenario none of whose
// declarations carries a binding tag.
func findAnnotationsOnUntagged(bindings []Binding, declared []DeclaredScenario) []AnnotationOnUntagged {
	byTitle := map[string][]DeclaredScenario{}
	for _, d := range declared {
		byTitle[d.Scenario.Title] = append(byTitle[d.Scenario.Title], d)
	}
	found := []AnnotationOnUntagged{}
	for _, b := range bindings {
		decls := byTitle[b.Title]
		if len(decls) == 0 || slices.ContainsFunc(decls, func(d DeclaredScenario) bool { return has(d.Scenario.Tags, isBoundTag) }) {
			continue
		}
		first := decls[0]
		found = append(found, AnnotationOnUntagged{
			Title:      b.Title,
			Ref:        b.Ref,
			Scenario:   ScenarioRef{Feature: first.Feature, Title: b.Title, Line: first.Scenario.Line},
			MissingTag: laneTagForTest(b.Ref.File),
			Parked:     has(first.Scenario.Tags, isUnimplemented),
		})
	}
	return found
}

// frozenAnnotations judges the annotations against the frozen list, keyed by
// the test file that carries them.
func frozenAnnotations(found []AnnotationOnUntagged, frozen FrozenList) AnnotationVerdict {
	observed := make([]ScenarioRef, len(found))
	for i, a := range found {
		observed[i] = ScenarioRef{Feature: a.Ref.File, Title: a.Title, Line: a.Ref.Line}
	}
	v := compareFrozen(observed, frozen)
	freshKeys := map[string]bool{}
	for _, r := range v.Fresh {
		freshKeys[fmt.Sprintf("%s:%d", r.Feature, r.Line)] = true
	}
	out := AnnotationVerdict{Fresh: []AnnotationOnUntagged{}, Stale: v.Stale, Tolerated: v.Tolerated}
	for _, a := range found {
		if freshKeys[fmt.Sprintf("%s:%d", a.Ref.File, a.Ref.Line)] {
			out.Fresh = append(out.Fresh, a)
		}
	}
	return out
}
