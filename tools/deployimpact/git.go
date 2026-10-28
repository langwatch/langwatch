package deployimpact

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// GitTree is the repository at one revision, read through git without a checkout.
type GitTree struct {
	Ctx context.Context
	Rev string
}

func git(ctx context.Context, args ...string) (string, error) {
	out, err := exec.CommandContext(ctx, "git", args...).Output()
	if err != nil {
		if exit, ok := errors.AsType[*exec.ExitError](err); ok {
			return "", fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(exit.Stderr)))
		}
		return "", fmt.Errorf("git %s: %w", strings.Join(args, " "), err)
	}
	return string(out), nil
}

func splitNul(out string) []string {
	var parts []string
	for part := range strings.SplitSeq(out, "\x00") {
		if part != "" {
			parts = append(parts, part)
		}
	}
	return parts
}

// Paths lists every tracked file at the revision.
func (g GitTree) Paths() ([]string, error) {
	out, err := git(g.Ctx, "ls-tree", "-r", "-z", "--name-only", g.Rev)
	return splitNul(out), err
}

// Grep lists the files at the revision with a line matching pattern.
func (g GitTree) Grep(pattern string) ([]string, error) {
	out, err := git(g.Ctx, "grep", "-l", "-z", "-E", "-e", pattern, g.Rev)
	if exit, ok := errors.AsType[*exec.ExitError](err); ok && exit.ExitCode() == 1 {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var paths []string
	for _, hit := range splitNul(out) {
		paths = append(paths, strings.TrimPrefix(hit, g.Rev+":"))
	}
	return paths, nil
}

// Read returns a file's content at the revision, or an empty string when it is absent.
func (g GitTree) Read(path string) (string, error) {
	listed, err := git(g.Ctx, "ls-tree", "-z", "--name-only", g.Rev, "--", path)
	if err != nil || listed == "" {
		return "", err
	}
	return git(g.Ctx, "show", g.Rev+":"+path)
}

// Changes lists the files that differ between base and head, renames as a delete and an add.
func Changes(ctx context.Context, base, head string) ([]Change, error) {
	out, err := git(ctx, "diff", "--name-status", "-z", "--no-renames", base, head)
	if err != nil {
		return nil, err
	}
	fields := splitNul(out)
	var changes []Change
	for i := 0; i+1 < len(fields); i += 2 {
		changes = append(changes, Change{Status: fields[i][:1], Path: fields[i+1]})
	}
	return changes, nil
}

// MergeBase is where head branched from base, so what base gained since is not counted.
func MergeBase(ctx context.Context, base, head string) (string, error) {
	out, err := git(ctx, "merge-base", base, head)
	return strings.TrimSpace(out), err
}
