package ciguard

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// The Go version used to live in eight places — go.work, three go.mod files
// and four Dockerfile base images — plus three workflows that restated it as
// a literal string. They had already drifted: go.work and the root module
// said 1.26.5, infra/clickhouse-serverless said 1.26.1 while its Dockerfile
// said a floating golang:1.26-alpine, and two workflows pinned "1.25" and
// "1.26" by hand. Nothing failed; different jobs simply compiled the same
// code with different toolchains, and the image was built with a third.
//
// Workflows are fixed by reading go-version-file instead of a literal, which
// leaves no second copy to drift. Dockerfiles cannot read a go.mod, so this
// guard is what keeps them honest.

// GoDockerfileRoots are the directories walked for Dockerfiles.
var GoDockerfileRoots = []string{"infra", "services", "platform", "tools"}

// ModuleFamilies are subtrees that track a floor of their own instead of the
// root module's version, each with the reason. A family is a decision, so it
// carries one.
//
// The exemption is from the ROOT version, not from agreement: every module
// inside a family must still match the family's own go.mod. That distinction
// is the whole point here — #4998 added nine modules under sdks/go/, and
// enumerating each one would have meant the guard broke on every new
// instrumentation package while still missing the failure that matters, which
// is one of them drifting above the floor the SDK actually publishes. A
// consumer who meets the SDK's directive cannot build a sibling module that
// quietly asks for more.
var ModuleFamilies = map[string]string{
	"sdks/go/": "published SDK: its go directive is the floor consumers must meet, and raising it drops support for anyone below. sdk-go-ci and sdk-go-cd build the tree standalone with GOWORK=off precisely so that stays true, and examples/ and e2e/ sit outside the workspace so they compile against the SDK at the floor it really publishes.",
}

var (
	goDirectivePattern = regexp.MustCompile(`(?m)^go\s+(\d+\.\d+(?:\.\d+)?)\s*$`)
	// Case-insensitive with optional indent: the Dockerfile spec treats
	// instructions case-insensitively, so `from golang:1.26.1` is valid and
	// an uppercase-only, column-zero pattern would let it drift unchecked.
	golangImagePattern = regexp.MustCompile(`(?mi)^\s*FROM\s+(?:--platform=\S+\s+)?golang:(\S+)`)
	fullVersionPattern = regexp.MustCompile(`^\d+\.\d+\.\d+$`)
)

func goDirective(text string) string {
	if match := goDirectivePattern.FindStringSubmatch(text); match != nil {
		return match[1]
	}

	return ""
}

// GoVersion reports every place that disagrees with the root go.mod.
func GoVersion(repoRoot string) ([]string, error) {
	rootModule, err := os.ReadFile(filepath.Join(repoRoot, "go.mod"))
	if err != nil {
		return nil, fmt.Errorf("read go.mod: %w", err)
	}

	want := goDirective(string(rootModule))
	if want == "" {
		return []string{"go.mod has no parseable `go` directive"}, nil
	}

	var problems []string

	work, err := os.ReadFile(filepath.Join(repoRoot, "go.work"))
	if err != nil {
		return nil, fmt.Errorf("read go.work: %w", err)
	}
	if got := goDirective(string(work)); got != want {
		problems = append(problems, fmt.Sprintf(
			"go.work says %s, go.mod says %s — the workspace and the root module must agree", got, want))
	}

	modules, err := goChildModules(repoRoot, want)
	if err != nil {
		return nil, err
	}
	problems = append(problems, modules...)

	literals, err := goVersionLiterals(repoRoot)
	if err != nil {
		return nil, err
	}
	problems = append(problems, literals...)

	images, err := goDockerfileImages(repoRoot, want)
	if err != nil {
		return nil, err
	}

	return append(problems, images...), nil
}

// goChildModules compares every non-root go.mod against the version it is
// supposed to track — the root module's, or its family's floor.
//
// Without this the guard read the root module and nothing else, so
// infra/clickhouse-serverless/go.mod could drift straight back to 1.26.1
// unnoticed — and the family list, which exists to let sdks/go keep its floor,
// was never consulted at runtime at all.
func goChildModules(repoRoot, rootVersion string) ([]string, error) {
	paths, err := childModulePaths(repoRoot)
	if err != nil {
		return nil, err
	}

	var problems []string
	for _, path := range paths {
		expected, governed, err := expectationFor(repoRoot, path, rootVersion)
		if err != nil {
			return nil, err
		}
		if !governed {
			continue
		}

		contents, err := os.ReadFile(filepath.Join(repoRoot, path))
		if err != nil {
			return nil, err
		}
		if got := goDirective(string(contents)); got != expected.version {
			problems = append(problems, expected.disagreement(path, got))
		}
	}

	return problems, nil
}

// expectation is the version a module must declare and the file that decides
// it, so a report can name the authority it disagrees with rather than always
// pointing at the root.
type expectation struct {
	version   string
	authority string
	inFamily  bool
}

// expectationFor decides which file governs a module's version. `governed` is
// false for the module that defines its own family's floor: it is the
// authority, so it has nothing above it to disagree with.
func expectationFor(repoRoot, path, rootVersion string) (expectation, bool, error) {
	family, isInFamily := moduleFamily(path)
	if !isInFamily {
		return expectation{version: rootVersion, authority: "go.mod"}, true, nil
	}

	authority := family + "go.mod"
	if path == authority {
		return expectation{}, false, nil
	}

	floor, err := floorOf(repoRoot, authority)
	if err != nil {
		return expectation{}, false, err
	}

	return expectation{version: floor, authority: authority, inFamily: true}, true, nil
}

func (e expectation) disagreement(path, got string) string {
	if e.inFamily {
		return fmt.Sprintf(
			"%s declares Go %s, %s says %s — a module in this family tracks the floor its own tree publishes, not the repo's",
			path, got, e.authority, e.version)
	}

	return fmt.Sprintf(
		"%s declares Go %s, %s says %s — add its subtree to ModuleFamilies with a reason if that is deliberate",
		path, got, e.authority, e.version)
}

// moduleFamily returns the family prefix a module sits under, if any.
func moduleFamily(path string) (string, bool) {
	for prefix := range ModuleFamilies {
		if strings.HasPrefix(path, prefix) {
			return prefix, true
		}
	}

	return "", false
}

func floorOf(repoRoot, modulePath string) (string, error) {
	contents, err := os.ReadFile(filepath.Join(repoRoot, modulePath))
	if err != nil {
		return "", fmt.Errorf("read %s: %w", modulePath, err)
	}

	floor := goDirective(string(contents))
	if floor == "" {
		return "", fmt.Errorf("%s has no parseable `go` directive, so it cannot define a floor", modulePath)
	}

	return floor, nil
}

func childModulePaths(repoRoot string) ([]string, error) {
	var paths []string

	err := filepath.WalkDir(repoRoot, func(path string, entry fs.DirEntry, err error) error {
		switch {
		case err != nil && os.IsNotExist(err):
			return fs.SkipDir
		case err != nil:
			return err
		case entry.IsDir() && isSkippedDir(entry.Name()):
			return fs.SkipDir
		case entry.IsDir() || entry.Name() != "go.mod":
			return nil
		}

		rel, relErr := filepath.Rel(repoRoot, path)
		if relErr != nil {
			return relErr
		}
		if rel != "go.mod" {
			paths = append(paths, filepath.ToSlash(rel))
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)

	return paths, nil
}

// goVersionLiterals finds workflows that restate the version rather than
// reading it. go-version-file cannot drift; go-version: "1.25" already did.
func goVersionLiterals(repoRoot string) ([]string, error) {
	workflows, err := ciscan.LoadAll(repoRoot)
	if err != nil {
		return nil, err
	}

	var problems []string
	for _, workflow := range workflows {
		problems = append(problems, workflowLiterals(workflow)...)
	}

	return problems, nil
}

func workflowLiterals(workflow *ciscan.Workflow) []string {
	var problems []string
	for _, job := range workflow.JobNames() {
		for _, step := range workflow.Jobs[job].Steps {
			if !strings.HasPrefix(step.Uses, "actions/setup-go@") {
				continue
			}
			problems = append(problems, setupGoStep(workflow.Path, job, step)...)
		}
	}

	return problems
}

func setupGoStep(path, job string, step ciscan.Step) []string {
	if literal, ok := step.StringWith("go-version"); ok {
		return []string{fmt.Sprintf(
			"%s job %q pins Go with a literal (%s) — use go-version-file so it follows the module",
			path, job, literal)}
	}

	// Neither key means setup-go installs its own default, which is whatever
	// the action currently ships — a third source of truth, and a silent one.
	if file, ok := step.StringWith("go-version-file"); !ok || strings.TrimSpace(file) == "" {
		return []string{fmt.Sprintf(
			"%s job %q sets up Go without go-version-file, so it uses the action's default toolchain rather than the module's",
			path, job)}
	}

	return nil
}

func goDockerfileImages(repoRoot, want string) ([]string, error) {
	paths, err := dockerfilePaths(repoRoot)
	if err != nil {
		return nil, err
	}

	var problems []string
	// Read after the walk rather than inside its callback: a filesystem
	// operation in a WalkDir callback races the walk itself against a symlink
	// swap (gosec G122).
	for _, path := range paths {
		contents, err := os.ReadFile(filepath.Join(repoRoot, path))
		if err != nil {
			return nil, err
		}
		for _, match := range golangImagePattern.FindAllStringSubmatch(string(contents), -1) {
			problems = append(problems, checkGolangImage(path, match[1], want)...)
		}
	}

	return problems, nil
}

func isSkippedDir(name string) bool {
	return name == "node_modules" || name == ".git" || name == "dist"
}

func isDockerfile(name string) bool {
	return name == "Dockerfile" || strings.HasPrefix(name, "Dockerfile.")
}

// dockerfilePaths collects every Dockerfile under the Go roots, repo-relative
// and sorted so guard output does not reorder between runs.
func dockerfilePaths(repoRoot string) ([]string, error) {
	var paths []string

	collect := func(path string, entry fs.DirEntry, err error) error {
		switch {
		case err != nil && os.IsNotExist(err):
			// A root that does not exist in this tree is not a failure.
			return fs.SkipDir
		case err != nil:
			return err
		case entry.IsDir() && isSkippedDir(entry.Name()):
			return fs.SkipDir
		case entry.IsDir() || !isDockerfile(entry.Name()):
			return nil
		}

		rel, relErr := filepath.Rel(repoRoot, path)
		if relErr != nil {
			return relErr
		}
		paths = append(paths, filepath.ToSlash(rel))

		return nil
	}

	for _, root := range GoDockerfileRoots {
		if err := filepath.WalkDir(filepath.Join(repoRoot, root), collect); err != nil {
			return nil, err
		}
	}
	sort.Strings(paths)

	return paths, nil
}

func checkGolangImage(path, tag, want string) []string {
	version, _, _ := strings.Cut(tag, "-")

	if !fullVersionPattern.MatchString(version) {
		// A floating tag resolves to whatever patch was newest that day, so
		// the image quietly stops matching the module without any file
		// changing.
		return []string{fmt.Sprintf(
			"%s uses golang:%s, a floating tag — pin the patch so the image is built with the toolchain go.mod asks for", path, tag)}
	}

	if version != want {
		return []string{fmt.Sprintf("%s builds with Go %s, go.mod says %s", path, version, want)}
	}

	return nil
}
