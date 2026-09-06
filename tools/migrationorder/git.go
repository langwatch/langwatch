package migrationorder

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"slices"
	"strings"
)

// Repo reads migration entries out of a git repository.
type Repo struct {
	Root string
}

// Inputs collects every migration set as it looks against baseRef.
//
// Ordering is judged against the tip of baseRef rather than the merge base: a
// branch is stale exactly when the base branch has moved ahead of it, so the
// merge base would be blind to the failure this check exists to catch.
func (r Repo) Inputs(ctx context.Context, baseRef string) ([]Input, error) {
	mergeBase, err := r.git(ctx, "merge-base", baseRef, "HEAD")
	if err != nil {
		return nil, err
	}
	mergeBase = strings.TrimSpace(mergeBase)

	inputs := make([]Input, 0, len(Sets))
	for _, set := range Sets {
		base, err := r.entriesAtAny(ctx, baseRef, set)
		if err != nil {
			return nil, err
		}
		head, err := r.entriesAt(ctx, "HEAD", set.Directory)
		if err != nil {
			return nil, err
		}
		forked, err := r.entriesAtAny(ctx, mergeBase, set)
		if err != nil {
			return nil, err
		}
		touched, err := r.touchedSince(ctx, baseRef, set.Directory)
		if err != nil {
			return nil, err
		}
		inputs = append(inputs, Input{
			Set:       set,
			BaseRef:   baseRef,
			Base:      base,
			Head:      head,
			MergeBase: forked,
			Touched:   touched,
		})
	}
	return inputs, nil
}

// entriesAtAny reads the set's entries at ref from its current directory and
// every previous one, so a branch that only relocates merged migrations (a repo
// restructure) does not see them as newly added.
func (r Repo) entriesAtAny(ctx context.Context, ref string, set Set) ([]string, error) {
	entries, err := r.entriesAt(ctx, ref, set.Directory)
	if err != nil {
		return nil, err
	}
	for _, dir := range set.PreviousDirectories {
		previous, err := r.entriesAt(ctx, ref, dir)
		if err != nil {
			return nil, err
		}
		entries = append(entries, previous...)
	}
	slices.Sort(entries)
	return slices.Compact(entries), nil
}

func (r Repo) entriesAt(ctx context.Context, ref, directory string) ([]string, error) {
	out, err := r.git(ctx, "ls-tree", "-r", "--name-only", ref, "--", directory)
	if err != nil {
		return nil, err
	}
	return TopLevelEntries(lines(out), directory), nil
}

func (r Repo) touchedSince(ctx context.Context, baseRef, directory string) ([]string, error) {
	// --no-renames: rename detection would report only the destination path,
	// letting a renamed merged migration slip past the immutability guard. As
	// delete-plus-add, the merged name stays visible here.
	out, err := r.git(ctx, "diff", "--name-only", "--no-renames", "--diff-filter=MDR", baseRef+"...HEAD", "--", directory)
	if err != nil {
		return nil, err
	}
	return TopLevelEntries(lines(out), directory), nil
}

func (r Repo) git(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", r.Root}, args...)...) //nolint:gosec // argv array, no shell; fixed git subcommands with CI-controlled refs
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return string(out), nil
}

// TopLevelEntries reduces git paths to the migration entries directly under
// directory: a file for ClickHouse, a directory for Prisma.
func TopLevelEntries(paths []string, directory string) []string {
	prefix := directory + "/"
	seen := map[string]bool{}
	var entries []string
	for _, path := range paths {
		if !strings.HasPrefix(path, prefix) {
			continue
		}
		entry, _, _ := strings.Cut(strings.TrimPrefix(path, prefix), "/")
		if entry == "" || entry == "migration_lock.toml" || seen[entry] {
			continue
		}
		seen[entry] = true
		entries = append(entries, entry)
	}
	slices.Sort(entries)
	return entries
}

func lines(out string) []string {
	out = strings.TrimSpace(out)
	if out == "" {
		return nil
	}
	return strings.Split(out, "\n")
}
