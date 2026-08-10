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

// ExemptModules are modules that deliberately do not track the root version,
// each with the reason. An exemption is a decision, so it carries one.
var ExemptModules = map[string]string{
	"sdks/go/go.mod":          "published SDK: its go directive is the floor consumers must meet, and raising it drops support for anyone below. sdk-go-ci and sdk-go-cd build it standalone with GOWORK=off precisely so that stays true.",
	"sdks/go/examples/go.mod": "compiled against the published SDK at its own floor, and deliberately outside the workspace (see go.work) so it resolves the SDK by relative replace. Raising it here would test the examples on a Go the SDK does not require.",
	"sdks/go/e2e/go.mod":      "same as sdks/go/examples: outside the workspace by design, pinned to the SDK's floor rather than the repo's.",
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

// goChildModules compares every non-root go.mod against the root version.
//
// Without this the guard read the root module and nothing else, so
// infra/clickhouse-serverless/go.mod could drift straight back to 1.26.1
// unnoticed — and ExemptModules, which exists to let sdks/go keep its floor,
// was never consulted at runtime at all.
func goChildModules(repoRoot, want string) ([]string, error) {
	paths, err := childModulePaths(repoRoot)
	if err != nil {
		return nil, err
	}

	var problems []string
	for _, path := range paths {
		if _, exempt := ExemptModules[path]; exempt {
			continue
		}

		contents, err := os.ReadFile(filepath.Join(repoRoot, path))
		if err != nil {
			return nil, err
		}
		got := goDirective(string(contents))
		if got != want {
			problems = append(problems, fmt.Sprintf(
				"%s declares Go %s, go.mod says %s — add it to ExemptModules with a reason if that is deliberate",
				path, got, want))
		}
	}

	return problems, nil
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
