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
//
// releasedRefs name release lines besides baseRef; their entries are history
// (see Input.Released).
func (r Repo) Inputs(ctx context.Context, baseRef string, releasedRefs ...string) ([]Input, error) {
	mergeBase, err := r.git(ctx, "merge-base", baseRef, "HEAD")
	if err != nil {
		return nil, err
	}
	mergeBase = strings.TrimSpace(mergeBase)

	inputs := make([]Input, 0, len(Sets))
	for _, set := range Sets {
		in, err := r.input(ctx, set, comparedRefs{base: baseRef, mergeBase: mergeBase, released: releasedRefs})
		if err != nil {
			return nil, err
		}
		inputs = append(inputs, in)
	}
	return inputs, nil
}

// comparedRefs are the refs one check run reads a migration set at.
type comparedRefs struct {
	base      string
	mergeBase string
	released  []string
}

// input reads one migration set at every ref the check compares.
func (r Repo) input(ctx context.Context, set Set, refs comparedRefs) (Input, error) {
	in := Input{Set: set, BaseRef: refs.base}
	var err error
	if in.Base, err = r.entriesAtAny(ctx, refs.base, set); err != nil {
		return Input{}, err
	}
	if in.Head, err = r.entriesAt(ctx, "HEAD", set.Directory); err != nil {
		return Input{}, err
	}
	if in.MergeBase, err = r.entriesAtAny(ctx, refs.mergeBase, set); err != nil {
		return Input{}, err
	}
	if in.Touched, err = r.touchedSince(ctx, refs.base, set.Directory); err != nil {
		return Input{}, err
	}
	if in.Released, err = r.releasedEntries(ctx, set, refs.released); err != nil {
		return Input{}, err
	}
	if in.Misplaced, err = r.misplacedEntries(ctx, set); err != nil {
		return Input{}, err
	}
	return in, nil
}

// releasedEntries reads the set's entries on every release line.
func (r Repo) releasedEntries(ctx context.Context, set Set, refs []string) ([]string, error) {
	var released []string
	for _, ref := range refs {
		entries, err := r.entriesAtAny(ctx, ref, set)
		if err != nil {
			return nil, err
		}
		released = append(released, entries...)
	}
	return released, nil
}

// misplacedEntries lists the entries under the set's forbidden roots at HEAD,
// as repository-relative paths.
func (r Repo) misplacedEntries(ctx context.Context, set Set) ([]string, error) {
	var misplaced []string
	for _, directory := range set.ForbiddenDirectories {
		entries, err := r.entriesAt(ctx, "HEAD", directory)
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			misplaced = append(misplaced, directory+"/"+entry)
		}
	}
	return misplaced, nil
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
