package visualdiff

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// A baseline is one base commit's captures for one edition, replayed instead
// of booting the base again. Its key covers what decides how a capture looks
// (commit, edition, viewport, settle, fixtures, captureSources); routes and
// flows are not in it: its meta lists what it holds, and a plan it does not
// cover renders the base live (BaselineMeta.Covers).
const (
	BaselinesDir     = "baselines"
	BaselineCaptures = "captures.jsonl"
	BaselineMetaFile = "meta.json"
	baselineFormat   = "3"
	runnerSourceDir  = "tools/visualdiff/runner/src"
)

// captureSources are the runner sources, under runnerSourceDir, whose change
// changes a capture. Scheduling, pairing and the protocol are left out.
var captureSources = []string{"capture.ts", "settle.ts", "noise.ts", "diff.ts", "screens.ts", "sign-in.ts", "static-ui.ts", "flows"}

// BaselineMeta is what a baseline records beside its captures: Routes and
// Flows (flow id to its steps' hash) are what it can answer.
type BaselineMeta struct {
	BaseRef    string            `json:"baseRef"`
	BaseCommit string            `json:"baseCommit"`
	Edition    Edition           `json:"edition"`
	CreatedAt  time.Time         `json:"createdAt"`
	Routes     []string          `json:"routes,omitempty"`
	Flows      map[string]string `json:"flows,omitempty"`
}

// Covers reports whether a baseline holds every route the plan renders and
// every flow it runs, each flow with the same steps.
func (meta BaselineMeta) Covers(routes []string, flows map[string]string) bool {
	missingRoutes, missingFlows := meta.Missing(routes, flows)
	return len(missingRoutes)+len(missingFlows) == 0
}

// flowHashes names each flow's steps by a hash, so a flow edited since the
// baseline was recorded is never replayed.
func flowHashes(flows []Flow) map[string]string {
	hashes := make(map[string]string, len(flows))
	for _, flow := range flows {
		encoded, _ := json.Marshal(flow.Steps)
		sum := sha256.Sum256(encoded)
		hashes[flow.ID] = hex.EncodeToString(sum[:8])
	}
	return hashes
}

// readBaselineMeta reads a present baseline's meta, or the zero meta.
func readBaselineMeta(dir string) BaselineMeta {
	var meta BaselineMeta
	if content, err := os.ReadFile(filepath.Join(dir, BaselineMetaFile)); err == nil { // #nosec G304 -- inside the tool's own baseline cache.
		_ = json.Unmarshal(content, &meta)
	}
	return meta
}

// Baseline is one resolved cache slot. Cached means this run replays it;
// an uncached slot with a Dir is filled by this run's live base pass.
type Baseline struct {
	Dir    string
	Meta   BaselineMeta
	Cached bool
	// MissingRoutes and MissingFlows are what a present slot lacks: only those
	// render on the base, and are added to the slot (baseline_fill.go).
	MissingRoutes []string
	MissingFlows  []string
	// Why says why anything renders live.
	Why string
}

// Partial reports a present slot this run tops up rather than replaces.
func (baseline Baseline) Partial() bool {
	return !baseline.Cached && len(baseline.MissingRoutes)+len(baseline.MissingFlows) > 0
}

// Present reports whether the slot holds a complete baseline.
func (baseline Baseline) Present() bool {
	_, captures := os.Stat(filepath.Join(baseline.Dir, BaselineCaptures))
	_, meta := os.Stat(filepath.Join(baseline.Dir, BaselineMetaFile))
	return captures == nil && meta == nil
}

// CapturesPath is the replay file the runner reads the base side from.
func (baseline Baseline) CapturesPath() string {
	return filepath.Join(baseline.Dir, BaselineCaptures)
}

// baselineKeyInputs are what a baseline's key is derived from.
type baselineKeyInputs struct {
	commit   string
	edition  Edition
	config   *Config
	viewport Viewport
	root     string
	// ui is how the sides' UI is served (uiMode): a dev-server base never
	// replays against a built candidate.
	ui string
}

// BaselineKey derives the cache slot name. Any input changing means a new
// slot, never a stale replay.
func BaselineKey(inputs baselineKeyInputs) (string, error) {
	digest := sha256.New()
	fmt.Fprintf(digest, "format=%s\nviewport=%s\n", baselineFormat, inputs.viewport)
	if inputs.ui != "" {
		fmt.Fprintf(digest, "ui=%s\n", inputs.ui)
	}
	encoded, err := json.Marshal(struct {
		Settle   Settle            `json:"settle"`
		Fixtures map[string]string `json:"fixtures"`
	}{inputs.config.Settle, inputs.config.Fixtures})
	if err != nil {
		return "", err
	}
	digest.Write(encoded)
	for _, source := range captureSources {
		if err := hashTree(digest, filepath.Join(inputs.root, runnerSourceDir, source)); err != nil {
			return "", err
		}
	}
	commit := inputs.commit
	if len(commit) > 12 {
		commit = commit[:12]
	}
	return fmt.Sprintf("%s-%s-%s", commit, inputs.edition, hex.EncodeToString(digest.Sum(nil))[:12]), nil
}

// hashTree folds every non-test source file under dir (or dir itself, when
// it is one file) into digest, in a stable order; a missing path adds nothing.
func hashTree(digest io.Writer, dir string) error {
	files, err := runnerSources(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("hash runner source: %w", err)
	}
	for _, file := range files {
		content, err := os.ReadFile(file) // #nosec G304 -- walked from the tool's own source directory.
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(filepath.Dir(dir), file)
		if _, err := fmt.Fprintf(digest, "%s\n%s", rel, content); err != nil {
			return err
		}
	}
	return nil
}

// runnerSources lists the runner's non-test TypeScript sources, sorted.
func runnerSources(dir string) ([]string, error) {
	var files []string
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		switch {
		case err != nil:
			return err
		case entry.IsDir() && entry.Name() == "__tests__":
			return filepath.SkipDir
		case !entry.IsDir() && strings.HasSuffix(path, ".ts"):
			files = append(files, path)
		}
		return nil
	})
	sort.Strings(files)
	return files, err
}

// gitRef is one ref of the repository at root, resolved through run.
type gitRef struct {
	run  runner
	root string
	ref  string
}

// resolveCommit turns a ref into the commit it names right now, so the cache
// follows main as it moves.
func resolveCommit(ctx context.Context, target gitRef) (string, error) {
	var out bytes.Buffer
	spec := commandSpec{name: "git", args: []string{"rev-parse", "--verify", target.ref + "^{commit}"}, dir: target.root}
	if err := target.run(ctx, spec, &out); err != nil {
		return "", fmt.Errorf("resolve %s: %w", target.ref, err)
	}
	commit := strings.TrimSpace(out.String())
	if len(commit) < 40 {
		return "", fmt.Errorf("resolve %s: git answered %q", target.ref, commit)
	}
	return commit, nil
}

// baselineInputs carries resolveBaselines' inputs, grouped so the function
// itself stays within this repository's argument-count limit.
type baselineInputs struct {
	options Options
	config  *Config
	deps    Deps
	// done narrows each edition's routes and flows (DoneLedger.Scope).
	done DoneLedger
}

// resolveBaselines finds each edition's slot for the base as it is now.
// Without Options.Baseline it returns none, so nothing is replayed or saved.
func resolveBaselines(ctx context.Context, inputs baselineInputs) (map[Edition]Baseline, error) {
	baselines := map[Edition]Baseline{}
	options := inputs.options
	if !options.Baseline {
		return baselines, nil
	}
	commit, err := resolveCommit(ctx, gitRef{run: inputs.deps.Run, root: options.Root, ref: options.BaseRef})
	if err != nil {
		return nil, err
	}
	now := inputs.deps.Now()
	for _, edition := range options.Editions {
		config, _ := inputs.done.Scope(inputs.config, edition)
		wanted := flowHashes(config.Flows)
		if options.RoutesOnly {
			wanted = nil
		}
		key, err := BaselineKey(baselineKeyInputs{
			commit: commit, edition: edition, config: inputs.config,
			viewport: options.Viewport, root: options.Root, ui: uiMode(options),
		})
		if err != nil {
			return nil, err
		}
		baseline := Baseline{
			Dir: filepath.Join(options.Root, ".visualdiff", BaselinesDir, key),
			Meta: BaselineMeta{
				BaseRef: options.BaseRef, BaseCommit: commit, Edition: edition, CreatedAt: now.UTC(),
				Routes: config.Routes, Flows: wanted,
			},
		}
		baselines[edition] = coverBaseline(baseline, options.RefreshBaseline)
	}
	return baselines, nil
}

// coverBaseline decides what a slot answers: everything (Cached), a part (the
// Missing lists), or nothing, and why anything renders live.
func coverBaseline(baseline Baseline, refresh bool) Baseline {
	switch {
	case refresh:
		baseline.Why = "-refresh-baseline"
		return baseline
	case !baseline.Present():
		baseline.Why = "no baseline for " + shortCommit(baseline.Meta.BaseCommit) + " yet"
		return baseline
	}
	held := readBaselineMeta(baseline.Dir)
	baseline.MissingRoutes, baseline.MissingFlows = held.Missing(baseline.Meta.Routes, baseline.Meta.Flows)
	baseline.Cached = !baseline.Partial()
	if !baseline.Cached {
		baseline.Why = missingWhy(baseline, held)
	}
	return baseline
}

// Missing lists the routes a baseline does not hold and the flows it holds
// with other steps or not at all.
func (meta BaselineMeta) Missing(routes []string, flows map[string]string) ([]string, []string) {
	held := map[string]bool{}
	for _, route := range meta.Routes {
		held[route] = true
	}
	var missingRoutes, missingFlows []string
	for _, route := range routes {
		if !held[route] {
			missingRoutes = append(missingRoutes, route)
		}
	}
	for id, steps := range flows {
		if meta.Flows[id] != steps {
			missingFlows = append(missingFlows, id)
		}
	}
	sort.Strings(missingFlows)
	return missingRoutes, missingFlows
}

// missingWhy names what a partial slot lacks: new routes, new flows, changed flows.
func missingWhy(baseline Baseline, held BaselineMeta) string {
	var added, changed []string
	for _, id := range baseline.MissingFlows {
		if _, ok := held.Flows[id]; ok {
			changed = append(changed, id)
		} else {
			added = append(added, id)
		}
	}
	var parts []string
	if len(baseline.MissingRoutes) > 0 {
		parts = append(parts, fmt.Sprintf("%d new route(s)", len(baseline.MissingRoutes)))
	}
	if len(added) > 0 {
		parts = append(parts, "new flow(s) "+strings.Join(added, ","))
	}
	if len(changed) > 0 {
		parts = append(parts, "changed flow(s) "+strings.Join(changed, ","))
	}
	return strings.Join(parts, "; ")
}

// Counts are how many of the wanted routes and flows replay, and how many render live.
func (baseline Baseline) Counts() (int, int) {
	wanted := len(baseline.Meta.Routes) + len(baseline.Meta.Flows)
	if baseline.Cached {
		return wanted, 0
	}
	if baseline.Partial() {
		live := len(baseline.MissingRoutes) + len(baseline.MissingFlows)
		return wanted - live, live
	}
	return 0, wanted
}

// needsLiveBase reports whether any edition has no baseline to replay.
func needsLiveBase(editions []Edition, baselines map[Edition]Baseline) bool {
	for _, edition := range editions {
		if !baselines[edition].Cached {
			return true
		}
	}
	return false
}

// writeBaselinePlan says, per edition, what of main replays and what renders
// live and why: "main: cached (N) / live (M, why)".
func writeBaselinePlan(out io.Writer, editions []Edition, baselines map[Edition]Baseline) {
	for _, edition := range editions {
		baseline, ok := baselines[edition]
		if !ok {
			fmt.Fprintf(out, "main: %s rendered live, not cached (-no-baseline)\n", edition)
			continue
		}
		cached, live := baseline.Counts()
		if live == 0 {
			fmt.Fprintf(out, "main: %s cached (%d) / live (0), replayed from %s\n", edition, cached, baseline.Dir)
			continue
		}
		fmt.Fprintf(out, "main: %s cached (%d) / live (%d, %s), cached at %s after\n", edition, cached, live, baseline.Why, baseline.Dir)
	}
}

// SaveBaseline copies a live base pass into its slot: every base capture's
// screenshot moves under the slot and its path is rewritten to match. It is
// written beside the slot and renamed into place, so a crash mid-copy never
// leaves a slot that reads as present.
func SaveBaseline(baseline Baseline, captures []Capture) error {
	staging := baseline.Dir + ".partial"
	_ = os.RemoveAll(staging)
	if err := os.MkdirAll(filepath.Join(staging, "shots"), 0o750); err != nil {
		return err
	}
	lines, err := stageBaseCaptures(baseline.Dir, staging, captures)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(staging, BaselineCaptures), lines, 0o600); err != nil {
		return err
	}
	meta, err := json.MarshalIndent(baseline.Meta, "", " ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(staging, BaselineMetaFile), meta, 0o600); err != nil {
		return err
	}
	_ = os.RemoveAll(baseline.Dir)
	return os.Rename(staging, baseline.Dir)
}

// UnloadedBaseCaptures counts the base captures whose own modules did not
// load: a baseline holding one would replay the tool's failure on every run.
func UnloadedBaseCaptures(captures []Capture) int {
	count := 0
	for index := range captures {
		if captures[index].Side == "base" && len(captures[index].ModuleFailures) > 0 {
			count++
		}
	}
	return count
}

// stageBaseCaptures copies each base capture's screenshot into staging and
// returns the captures as JSON lines pointing at where they will live in dir.
func stageBaseCaptures(dir, staging string, captures []Capture) ([]byte, error) {
	var lines bytes.Buffer
	for index := range captures {
		stored := captures[index]
		if stored.Side != "base" {
			continue
		}
		if stored.Screenshot != "" {
			name := fmt.Sprintf("%05d.png", index)
			if err := copyIfPresent(stored.Screenshot, filepath.Join(staging, "shots", name)); err != nil {
				return nil, err
			}
			stored.Screenshot = filepath.Join(dir, "shots", name)
		}
		encoded, err := json.Marshal(stored)
		if err != nil {
			return nil, err
		}
		lines.Write(append(encoded, '\n'))
	}
	return lines.Bytes(), nil
}

func copyIfPresent(source, target string) error {
	in, err := os.Open(source) // #nosec G304 -- a screenshot this run's own runner wrote.
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(target) // #nosec G304 -- inside the baseline's own staging directory.
	if err != nil {
		return err
	}
	if _, err := bufio.NewReader(in).WriteTo(out); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}
