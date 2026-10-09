package seedgen

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/readmegen"
)

// CoverageMap is tools/seedgen/coverage.json: each item's generating action kinds, or its exemption.
type CoverageMap struct {
	Generators map[string][]string `json:"generators"`
	Exemptions map[string]string   `json:"exemptions"`
}

// StaticReport is the static check's verdict, by id.
type StaticReport struct {
	Gaps         []string `json:"gaps"`         // items with neither a generator nor an exemption
	Stale        []string `json:"stale"`        // map entries naming no item in the tree
	UnknownKinds []string `json:"unknownKinds"` // "item -> kind" where the plan declares no such kind
	Unexplained  []string `json:"unexplained"`  // exemptions with an empty reason
}

// Failed reports whether the check found anything to fix.
func (r StaticReport) Failed() bool {
	return len(r.Gaps)+len(r.Stale)+len(r.UnknownKinds)+len(r.Unexplained) > 0
}

// actionKinds is the seam to SG1's plan model: the action kinds a generator may name.
// Until the plan's kind registry lands it returns nil, and kind names go unchecked.
var actionKinds = func() []string { return nil }

// CheckStatic compares the inventory with the map as sets.
func CheckStatic(inventory []string, coverage CoverageMap) StaticReport {
	var report StaticReport
	present := map[string]bool{}
	for _, item := range inventory {
		present[item] = true
		_, generated := coverage.Generators[item]
		_, exempt := coverage.Exemptions[item]
		if !generated && !exempt {
			report.Gaps = append(report.Gaps, item)
		}
	}
	checkGenerators(&report, present, coverage.Generators)
	for item, reason := range coverage.Exemptions {
		if !present[item] {
			report.Stale = append(report.Stale, item)
		}
		if strings.TrimSpace(reason) == "" {
			report.Unexplained = append(report.Unexplained, item)
		}
	}
	for _, ids := range [][]string{report.Gaps, report.Stale, report.UnknownKinds, report.Unexplained} {
		sort.Strings(ids)
	}
	return report
}

func checkGenerators(report *StaticReport, present map[string]bool, generators map[string][]string) {
	known := map[string]bool{}
	for _, kind := range actionKinds() {
		known[kind] = true
	}
	for item, kinds := range generators {
		switch {
		case !present[item]:
			report.Stale = append(report.Stale, item)
		case len(kinds) == 0:
			report.Gaps = append(report.Gaps, item)
		}
		for _, kind := range kinds {
			if len(known) > 0 && !known[kind] {
				report.UnknownKinds = append(report.UnknownKinds, item+" -> "+kind)
			}
		}
	}
}

// RunCoverage is `seedgen coverage --static`: exit 0 clean, 1 on any finding, 2 on bad input.
func RunCoverage(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("seedgen coverage", flag.ContinueOnError)
	flags.SetOutput(stderr)
	root := flags.String("root", ".", "workspace root")
	static := flags.Bool("static", false, "check the tree's inventory against coverage.json (no stack)")
	manifest := flags.String("manifest", "", "readmegen extractor manifest (JSON) holding the pipelines")
	asJSON := flags.Bool("json", false, "print the report as JSON")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if !*static {
		fmt.Fprintln(stderr, "seedgen coverage: only --static is built; the run-time check is SG11's second half")
		return 2
	}
	report, err := staticReport(*root, *manifest)
	if err != nil {
		fmt.Fprintln(stderr, "seedgen coverage:", err)
		return 2
	}
	if *asJSON {
		encoder := json.NewEncoder(stdout)
		encoder.SetIndent("", "  ")
		_ = encoder.Encode(report)
	} else {
		printReport(stdout, report)
	}
	if report.Failed() {
		return 1
	}
	return 0
}

func staticReport(root, manifestFile string) (StaticReport, error) {
	manifest, err := extractManifest(manifestFile)
	if err != nil {
		return StaticReport{}, err
	}
	inventory, err := Inventory(root, manifest)
	if err != nil {
		return StaticReport{}, err
	}
	coverage, err := readCoverageMap(filepath.Join(root, "tools", "seedgen", "coverage.json"))
	if err != nil {
		return StaticReport{}, err
	}
	return CheckStatic(inventory, coverage), nil
}

// extractManifest reads the readmegen manifest. Running the extractor in-process waits on
// readmegen exporting it (handoff: shared-file request); until then the file is required.
func extractManifest(file string) (readmegen.Manifest, error) {
	var manifest readmegen.Manifest
	if file == "" {
		return manifest, errors.New("--manifest is required until readmegen exports its extractor")
	}
	data, err := os.ReadFile(file) // #nosec G304 -- a path the caller named
	if err != nil {
		return manifest, err
	}
	err = json.Unmarshal(data, &manifest)
	return manifest, err
}

func readCoverageMap(file string) (CoverageMap, error) {
	var coverage CoverageMap
	data, err := os.ReadFile(file) // #nosec G304 -- a fixed path under the root the caller named
	if err != nil {
		return coverage, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&coverage); err != nil {
		return coverage, fmt.Errorf("decode %s: %w", file, err)
	}
	return coverage, nil
}

func printReport(out io.Writer, report StaticReport) {
	sections := []struct {
		title string
		ids   []string
	}{
		{"gap (no generator, no exemption)", report.Gaps},
		{"stale (names no item in the tree)", report.Stale},
		{"unknown action kind", report.UnknownKinds},
		{"exemption without a reason", report.Unexplained},
	}
	for _, section := range sections {
		for _, id := range section.ids {
			fmt.Fprintf(out, "%s\t%s\n", section.title, id)
		}
	}
	counts := map[string]int{}
	for _, id := range report.Gaps {
		category, _, _ := strings.Cut(id, ":")
		counts[category]++
	}
	categories := make([]string, 0, len(counts))
	for category := range counts {
		categories = append(categories, category)
	}
	sort.Strings(categories)
	for _, category := range categories {
		fmt.Fprintf(out, "gaps\t%s\t%d\n", category, counts[category])
	}
}
