package lintrun

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
)

// The impure half: git, nx and the oxlint processes.

// git is the lines of a git command's stdout; a failing git returns its stderr in the error.
func (r runner) git(args ...string) ([]string, error) {
	cmd := exec.CommandContext(r.ctx, "git", args...)
	cmd.Dir = r.root
	out, err := cmd.Output()
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return nil, fmt.Errorf("git %s: %w\n%s", strings.Join(args, " "), err, exit.Stderr)
		}
		return nil, fmt.Errorf("git %s: %w", strings.Join(args, " "), err)
	}
	return slices.DeleteFunc(strings.Split(string(out), "\n"), func(s string) bool { return s == "" }), nil
}

// mergeBase is the merge base with the branch's upstream (else upstreamFallback),
// then with origin/main. A branch without an upstream is normal; no merge base is an error.
func (r runner) mergeBase() (string, error) {
	upstream := upstreamFallback
	if found, err := r.git("rev-parse", "--abbrev-ref", "@{upstream}"); err == nil && len(found) > 0 {
		upstream = found[0]
	}
	var last error
	for _, ref := range []string{upstream, "origin/main"} {
		found, err := r.git("merge-base", "HEAD", ref)
		if err == nil && len(found) > 0 {
			return found[0], nil
		}
		last = err
	}
	return "", fmt.Errorf("no merge base with %s or origin/main; fetch it or pass --base: %w", upstream, last)
}

// changedFiles is every committed, staged, unstaged and untracked change since base.
func (r runner) changedFiles(base string) ([]string, error) {
	tracked, err := r.git("diff", "--name-only", "--diff-filter=ACMRD", base)
	if err != nil {
		return nil, err
	}
	untracked, err := r.git("ls-files", "--others", "--exclude-standard")
	if err != nil {
		return nil, err
	}
	files := slices.Concat(tracked, untracked)
	slices.Sort(files)
	return slices.Compact(files), nil
}

// affectedProjects is the package names `nx show projects --affected` lists; nx's own
// exit status ends the run when it fails.
func (r runner) affectedProjects(q request) ([]string, error) {
	affected := "--files=" + strings.Join(q.files, ",")
	if q.base != nil {
		affected = "--base=" + *q.base
	}
	cmd := exec.CommandContext(r.ctx, "pnpm", "exec", "nx", "show", "projects", "--affected", affected, "--json")
	cmd.Dir = r.root
	out, err := cmd.Output()
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		r.stderr.Write(exit.Stderr) //nolint:errcheck // best effort: the exit status is the verdict
		return nil, exitError{status: max(exit.ExitCode(), 1)}
	}
	if err != nil {
		return nil, fmt.Errorf("nx show projects: cannot run pnpm: %w", err)
	}
	var names []string
	if err := json.Unmarshal(out, &names); err != nil {
		return nil, fmt.Errorf("nx show projects: %w", err)
	}
	return names, nil
}

func (r runner) packageName(member string) (string, error) {
	manifest, err := os.ReadFile(filepath.Join(r.root, member, "package.json"))
	if err != nil {
		return "", err
	}
	var pkg struct {
		Name string `json:"name"`
	}
	err = json.Unmarshal(manifest, &pkg)
	return pkg.Name, err
}

func (r runner) printedConfig(config string) (map[string]json.RawMessage, error) {
	cmd := exec.CommandContext(r.ctx, r.oxlint, "--print-config", "-c", config) //nolint:gosec // G204: this workspace's own oxlint
	cmd.Dir = r.root
	out, err := cmd.Output()
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return nil, fmt.Errorf("oxlint --print-config -c %s failed: %w\n%s%s", config, err, out, exit.Stderr)
		}
		return nil, fmt.Errorf("oxlint --print-config -c %s: %w", config, err)
	}
	var printed map[string]json.RawMessage
	if err := json.Unmarshal(out, &printed); err != nil {
		return nil, fmt.Errorf("oxlint --print-config -c %s: %w", config, err)
	}
	return printed, nil
}

// ignoreArgs is the union config's ignorePatterns: `extends` does not carry them to the parts.
func (r runner) ignoreArgs() ([]string, error) {
	printed, err := r.printedConfig(unionConfig)
	if err != nil {
		return nil, err
	}
	var patterns []string
	if err := json.Unmarshal(printed["ignorePatterns"], &patterns); err != nil {
		return nil, fmt.Errorf("%s ignorePatterns: %w", unionConfig, err)
	}
	args := []string{}
	for _, p := range patterns {
		args = append(args, "--ignore-pattern", p)
	}
	return args, nil
}

// typeOnlyRules is the bare names of the rules the type-aware config turns on.
func (r runner) typeOnlyRules() (map[string]bool, error) {
	printed, err := r.printedConfig(typesConfig)
	if err != nil {
		return nil, err
	}
	var rules map[string]json.RawMessage
	if err := json.Unmarshal(printed["rules"], &rules); err != nil {
		return nil, fmt.Errorf("%s rules: %w", typesConfig, err)
	}
	typeOnly := map[string]bool{}
	for rule := range rules {
		typeOnly[RuleName(rule)] = true
	}
	return typeOnly, nil
}

// lintAll runs one oxlint process per config in parallel; ok is false when any failed.
func (r runner) lintAll(configs, args []string) ([][]Diagnostic, bool) {
	reports := make([][]Diagnostic, len(configs))
	oks := make([]bool, len(configs))
	var wg sync.WaitGroup
	for i, config := range configs {
		wg.Go(func() { reports[i], oks[i] = r.lint(config, args) })
	}
	wg.Wait()
	return reports, !slices.Contains(oks, false)
}

func (r runner) lint(config string, args []string) ([]Diagnostic, bool) {
	argv := []string{"--quiet", "-f", "json", "-c", config}
	if config == typesConfig {
		argv = append(argv, "--type-aware")
	}
	cmd := exec.CommandContext(r.ctx, r.oxlint, slices.Concat(argv, args)...) //nolint:gosec // G204: this workspace's own oxlint
	cmd.Dir = r.root
	cmd.Stderr = r.stderr
	var out bytes.Buffer
	cmd.Stdout = &out
	status := 0
	if err := cmd.Run(); err != nil {
		status = -1
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			status = exit.ExitCode()
		}
	}
	report, ok := ParseReport(out.String(), status)
	if !ok {
		fmt.Fprintf(r.stderr, "oxlint -c %s exited %d:\n%s\n", config, status, out.String())
	}
	return report, ok
}
