package migrationorder

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os/exec"
	"path"
	"slices"
	"strings"
)

// ReleasesDirectory holds one manifest per release, <version>.json, written by
// the stamp step in the release PR (plan 5.3, D9).
const ReleasesDirectory = "packages/upgrade/releases"

// StepRoots are where modules declare their code steps (.withMigrations).
var StepRoots = []string{"modules", "enterprise/modules"}

// floorManifest is the LTS floor file beside the manifests; it names no steps.
const floorManifest = "lts-floor.json"

// manifest is the part of a release manifest this check reads.
type manifest struct {
	Release string `json:"release"`
	Steps   []struct {
		ID string `json:"id"`
	} `json:"steps"`
}

// ReleasedStep is a code step a release manifest names, and the file on the
// base branch that declares it.
type ReleasedStep struct {
	ID      string
	Release string
	// Path is repository-relative, on the base branch.
	Path string
}

// StepInput is what the step check reads: the released code steps and the
// paths the branch modified, renamed or deleted since the base branch.
type StepInput struct {
	BaseRef  string
	Released []ReleasedStep
	Touched  []string
}

// CheckSteps reports every released code step whose declaring file the branch
// changed. A step a release shipped has run on real installs, so its file is
// frozen exactly as a merged migration is (rethink 6.5 point 2); a change is a
// new step with a new id.
func CheckSteps(in StepInput) []Finding {
	touched := map[string]bool{}
	for _, p := range in.Touched {
		touched[p] = true
	}
	var findings []Finding
	for _, step := range in.Released {
		if !touched[step.Path] {
			continue
		}
		findings = append(findings, Finding{
			Set:   "Code steps",
			Entry: step.Path,
			Problem: fmt.Sprintf("declares %s, which release %s shipped, and a released step cannot change: declare a new step instead",
				step.ID, step.Release),
			Fix: fmt.Sprintf("git checkout %s -- %s", in.BaseRef, shellArg(step.Path)),
		})
	}
	slices.SortFunc(findings, func(a, b Finding) int { return strings.Compare(a.Entry+a.Problem, b.Entry+b.Problem) })
	return findings
}

// isCodeStep reports whether a manifest step id names a module's code step
// rather than a Prisma folder or a goose version (plan 5.3 step id grammar).
func isCodeStep(id string) bool {
	owner, name, ok := strings.Cut(id, ":")
	return ok && name != "" && owner != "prisma" && owner != "clickhouse"
}

// Steps reads the released code steps from the manifests on baseRef and on
// every release line, finds the base branch file declaring each by its quoted
// id, and lists what the branch changed in those files.
func (r Repo) Steps(ctx context.Context, baseRef string, releasedRefs ...string) (StepInput, error) {
	in := StepInput{BaseRef: baseRef}
	releaseOf := map[string]string{}
	for _, ref := range slices.Concat([]string{baseRef}, releasedRefs) {
		if err := r.readManifests(ctx, ref, releaseOf); err != nil {
			return StepInput{}, err
		}
	}
	if len(releaseOf) == 0 {
		return in, nil
	}

	declared, err := r.declaringFiles(ctx, baseRef, slices.Sorted(maps.Keys(releaseOf)))
	if err != nil {
		return StepInput{}, err
	}
	var paths []string
	for _, d := range declared {
		in.Released = append(in.Released, ReleasedStep{ID: d.id, Release: releaseOf[d.id], Path: d.path})
		paths = append(paths, d.path)
	}
	if len(paths) == 0 {
		return in, nil
	}
	slices.Sort(paths)
	paths = slices.Compact(paths)
	out, err := r.git(ctx, slices.Concat(
		[]string{"diff", "--name-only", "--no-renames", "--diff-filter=MDR", baseRef + "...HEAD", "--"}, paths)...)
	if err != nil {
		return StepInput{}, err
	}
	in.Touched = lines(out)
	return in, nil
}

// readManifests adds every code step id the manifests on ref name, keeping
// the first manifest (base branch first, then in file order) that names each.
func (r Repo) readManifests(ctx context.Context, ref string, releaseOf map[string]string) error {
	files, err := r.entriesAt(ctx, ref, ReleasesDirectory)
	if err != nil {
		return err
	}
	for _, file := range files {
		if path.Ext(file) != ".json" || file == floorManifest {
			continue
		}
		m, err := r.readManifest(ctx, ref, file)
		if err != nil {
			return err
		}
		addCodeSteps(m, releaseOf)
	}
	return nil
}

func addCodeSteps(m manifest, releaseOf map[string]string) {
	for _, step := range m.Steps {
		if _, known := releaseOf[step.ID]; isCodeStep(step.ID) && !known {
			releaseOf[step.ID] = m.Release
		}
	}
}

func (r Repo) readManifest(ctx context.Context, ref, file string) (manifest, error) {
	content, err := r.git(ctx, "show", ref+":"+ReleasesDirectory+"/"+file)
	if err != nil {
		return manifest{}, err
	}
	var m manifest
	if err := json.Unmarshal([]byte(content), &m); err != nil {
		return manifest{}, fmt.Errorf("release manifest %s:%s/%s is not valid JSON: %w", ref, ReleasesDirectory, file, err)
	}
	return m, nil
}

// declaration is one file declaring one step id.
type declaration struct {
	id   string
	path string
}

// declaringFiles finds the non-test files under StepRoots on ref that hold a
// step id as a quoted literal, the form defineMigrationStep({ id }) takes.
func (r Repo) declaringFiles(ctx context.Context, ref string, ids []string) ([]declaration, error) {
	args := []string{"grep", "-o", "-F", "--full-name"}
	for _, id := range ids {
		for _, quote := range []string{`"`, `'`, "`"} {
			args = append(args, "-e", quote+id+quote)
		}
	}
	args = append(args, ref, "--")
	args = append(args, StepRoots...)
	out, err := r.git(ctx, args...)
	var exit *exec.ExitError
	if err != nil && (!errors.As(err, &exit) || exit.ExitCode() != 1) {
		return nil, err
	}
	var found []declaration
	for _, line := range lines(out) {
		if d, ok := parseDeclaration(ref, line); ok {
			found = append(found, d)
		}
	}
	slices.SortFunc(found, func(a, b declaration) int { return strings.Compare(a.path+a.id, b.path+b.id) })
	return slices.Compact(found), nil
}

// parseDeclaration reads one `git grep -o` line, <ref>:<path>:<quoted id>,
// skipping test files, which may name a step without declaring it.
func parseDeclaration(ref, line string) (declaration, bool) {
	rest, ok := strings.CutPrefix(line, ref+":")
	if !ok {
		return declaration{}, false
	}
	file, match, ok := strings.Cut(rest, ":")
	if !ok || strings.Contains(file, "/__tests__/") || strings.Contains(file, ".test.") {
		return declaration{}, false
	}
	return declaration{id: strings.Trim(match, "\"'`"), path: file}, true
}
