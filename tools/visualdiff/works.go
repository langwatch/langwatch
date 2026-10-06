package visualdiff

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// WorksFile is the works ledger (README "Skipping what works"): every route
// with no finding and every flow judged works, with the candidate commit it
// was at. A later run skips each one while nothing it touches has changed.
const WorksFile = "works.json"

// WorksEntry is one section that worked. Steps is a flow's step hash
// (flowHashes), so an edited flow is walked again; a route has none.
type WorksEntry struct {
	Commit string `json:"commit"`
	Steps  string `json:"steps,omitempty"`
}

// WorksLedger is keyed like the done ledger (DoneKey).
type WorksLedger map[string]WorksEntry

// sharedScreenInputs are what every screen renders through: the shell, the
// design system, the app, and the runner that drives it.
var sharedScreenInputs = []string{"packages/browser-host", "packages/design-system", "apps/ui", "tools/visualdiff/runner/src"}

// moduleHalves are the parts of a module a screen of it can reach.
var moduleHalves = []string{"browser", "process", "contract"}

func worksPath(root string) string { return filepath.Join(root, ".visualdiff", WorksFile) }

// LoadWorks reads the works ledger; no ledger is an empty one.
func LoadWorks(root string) (WorksLedger, error) {
	ledger := WorksLedger{}
	content, err := os.ReadFile(worksPath(root)) // #nosec G304 -- the tool's own ledger.
	if errors.Is(err, fs.ErrNotExist) {
		return ledger, nil
	}
	if err != nil {
		return nil, err
	}
	return ledger, json.Unmarshal(content, &ledger)
}

// SaveWorks writes the works ledger.
func SaveWorks(root string, ledger WorksLedger) error {
	if err := os.MkdirAll(filepath.Dir(worksPath(root)), 0o750); err != nil {
		return err
	}
	return writeJSON(worksPath(root), ledger)
}

// Record takes a finished run's verdicts: a route with no finding and a flow
// judged works are recorded at commit, anything else captured is forgotten,
// and a section the run did not capture keeps its entry.
func (ledger WorksLedger) Record(rows []Row, commit string, flows []Flow) {
	steps := flowHashes(flows)
	captured, failing := map[string]string{}, map[string]bool{}
	for index := range rows {
		if row := rows[index]; row.Kind == "route" {
			key := DoneKey(row.Edition, "route", row.Key)
			captured[key] = ""
			failing[key] = failing[key] || row.Finding()
		}
	}
	for _, verdict := range JudgeFlows(rows) {
		key := DoneKey(verdict.Edition, "flow", verdict.Flow)
		captured[key], failing[key] = steps[verdict.Flow], verdict.Verdict != VerdictWorks
	}
	for key, stepHash := range captured {
		if failing[key] {
			delete(ledger, key)
			continue
		}
		ledger[key] = WorksEntry{Commit: commit, Steps: stepHash}
	}
}

// screenOwner is one declared screen pattern and the module root that
// declares it: "" for the app shell, which the shared inputs cover.
type screenOwner struct {
	pattern string
	module  string
	file    string
	known   bool
}

// ScreenOwners reads which module declares each screen from its
// defineBrowserModule screens (coverage.go's declarations, with their files).
type ScreenOwners []screenOwner

func screenOwners(parser *declarationParser) ScreenOwners {
	owners := make(ScreenOwners, 0, len(parser.patterns))
	for index, pattern := range parser.patterns {
		module, known := moduleOf(parser.files[index])
		owners = append(owners, screenOwner{pattern: pattern, module: module, file: parser.files[index], known: known})
	}
	return owners
}

// moduleOf is the module root a declaring file sits in ("modules/x",
// "enterprise/modules/x"), "" for apps/ui, and false anywhere else.
func moduleOf(file string) (string, bool) {
	if _, path, found := strings.Cut(file, ":"); found {
		file = path
	}
	parts := strings.Split(file, "/")
	switch {
	case len(parts) > 2 && parts[0] == "modules":
		return strings.Join(parts[:2], "/"), true
	case len(parts) > 3 && parts[0] == "enterprise" && parts[1] == "modules":
		return strings.Join(parts[:3], "/"), true
	case len(parts) > 2 && parts[0] == "apps" && parts[1] == "ui":
		return "", true
	}
	return "", false
}

// RouteTouches are the paths a configured route renders through, or why
// they cannot be told.
func (owners ScreenOwners) RouteTouches(route string) ([]string, string) {
	paths := map[string]bool{}
	for _, path := range sharedScreenInputs {
		paths[path] = true
	}
	matched := false
	for _, owner := range owners {
		if !PatternCovers(owner.pattern, route) {
			continue
		}
		if !owner.known {
			return nil, "declared outside a module and the app (" + owner.file + ")"
		}
		matched = true
		addModuleHalves(paths, owner.module)
	}
	if !matched {
		return nil, "no module's screens declare " + route
	}
	return sortedKeys(paths), ""
}

// addModuleHalves adds every half of module to paths; no module adds none.
func addModuleHalves(paths map[string]bool, module string) {
	if module == "" {
		return
	}
	for _, half := range moduleHalves {
		paths[module+"/"+half] = true
	}
}

// FlowTouches are the paths every screen a flow goes to renders through.
func (owners ScreenOwners) FlowTouches(flow Flow) ([]string, string) {
	paths := map[string]bool{}
	for _, step := range flow.Steps {
		if step.Action != "go" || step.With["path"] == "" {
			continue
		}
		touched, why := owners.RouteTouches(step.With["path"])
		if why != "" {
			return nil, why
		}
		for _, path := range touched {
			paths[path] = true
		}
	}
	if len(paths) == 0 {
		return nil, "no go step names a screen, so what it touches is unknown"
	}
	return sortedKeys(paths), ""
}

func sortedKeys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for key := range set {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

// worksInputs carries WorksSkips' inputs.
type worksInputs struct {
	run          runner
	root         string
	candidateRef string
	config       *Config
	editions     []Edition
	works        WorksLedger
	out          io.Writer
}

// WorksSkips are the sections whose last verdict was works and whose inputs
// have not changed since, as done-ledger entries a run skips. A section whose
// inputs cannot be told is walked, and the reason printed.
func WorksSkips(ctx context.Context, inputs worksInputs) DoneLedger {
	if len(inputs.works) == 0 {
		return nil
	}
	candidate, err := resolveCommit(ctx, gitRef{run: inputs.run, root: inputs.root, ref: inputs.candidateRef})
	source := coverageSource{run: inputs.run, root: inputs.root}
	var parser *declarationParser
	if err == nil {
		parser, err = source.candidateDeclarations(ctx, candidate, inputs.config.Coverage.CandidateScreens)
	}
	if err != nil {
		fmt.Fprintf(inputs.out, "works: skipping nothing, %v\n", err)
		return nil
	}
	skipper := worksSkipper{inputs: inputs, candidate: candidate, owners: screenOwners(parser), unchanged: map[string]bool{}}
	return skipper.skips(ctx)
}

// worksSkipper decides each section, caching one git diff per commit and paths.
type worksSkipper struct {
	inputs    worksInputs
	candidate string
	owners    ScreenOwners
	unchanged map[string]bool
}

func (skipper worksSkipper) skips(ctx context.Context) DoneLedger {
	steps := flowHashes(skipper.inputs.config.Flows)
	var skipped DoneLedger
	for _, edition := range skipper.inputs.editions {
		for _, route := range skipper.inputs.config.Routes {
			paths, why := skipper.owners.RouteTouches(route)
			skipped = skipper.decide(ctx, &worksSection{edition: edition, kind: "route", section: route, paths: paths, why: why}, skipped)
		}
		for _, flow := range skipper.inputs.config.Flows {
			paths, why := skipper.owners.FlowTouches(flow)
			section := &worksSection{edition: edition, kind: "flow", section: flow.ID, paths: paths, why: why, steps: steps[flow.ID]}
			skipped = skipper.decide(ctx, section, skipped)
		}
	}
	return skipped
}

// worksSection is one route or flow on one edition and what it touches.
type worksSection struct {
	edition Edition
	kind    string
	section string
	paths   []string
	why     string
	steps   string
}

func (skipper worksSkipper) decide(ctx context.Context, section *worksSection, skipped DoneLedger) DoneLedger {
	key := DoneKey(section.edition, section.kind, section.section)
	entry, worked := skipper.inputs.works[key]
	switch {
	case !worked:
		return skipped
	case section.why != "":
		fmt.Fprintf(skipper.inputs.out, "works: walking %s, %s\n", key, section.why)
		return skipped
	case entry.Steps != section.steps:
		return skipped
	case !skipper.isUnchanged(ctx, entry.Commit, section.paths):
		return skipped
	}
	return append(skipped, DoneEntry{
		Key: key, Edition: section.edition, Kind: section.kind, Section: section.section,
		CandidateCommit: entry.Commit, Note: "works at " + short(entry.Commit) + ", unchanged", Works: true,
	})
}

// isUnchanged reports `git diff --name-only commit..candidate -- paths` empty;
// a commit git cannot diff (gone, shallow) counts as changed.
func (skipper worksSkipper) isUnchanged(ctx context.Context, commit string, paths []string) bool {
	cacheKey := commit + "\x00" + strings.Join(paths, "\x00")
	if unchanged, seen := skipper.unchanged[cacheKey]; seen {
		return unchanged
	}
	var out bytes.Buffer
	args := append([]string{"diff", "--name-only", commit, skipper.candidate, "--"}, paths...)
	err := skipper.inputs.run(ctx, commandSpec{name: "git", args: args, dir: skipper.inputs.root}, &out)
	unchanged := err == nil && strings.TrimSpace(out.String()) == ""
	skipper.unchanged[cacheKey] = unchanged
	return unchanged
}

// recordWorks keeps a finished run's verdicts for the next run to skip by.
func (run *session) recordWorks(rows []Row) {
	options := run.request.Options
	commit, err := resolveCommit(context.Background(), gitRef{run: run.request.Deps.Run, root: options.Root, ref: options.CandidateRef})
	if err != nil {
		fmt.Fprintf(run.streams.Err, "works: not recorded, %v\n", err)
		return
	}
	ledger, err := LoadWorks(options.Root)
	if err == nil {
		ledger.Record(rows, commit, run.request.Config.Flows)
		err = SaveWorks(options.Root, ledger)
	}
	if err != nil {
		fmt.Fprintf(run.streams.Err, "works: not recorded, %v\n", err)
	}
}
