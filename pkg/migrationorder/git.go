package migrationorder

import (
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
func (r Repo) Inputs(baseRef string) ([]Input, error) {
	mergeBase, err := r.git("merge-base", baseRef, "HEAD")
	if err != nil {
		return nil, err
	}
	mergeBase = strings.TrimSpace(mergeBase)

	inputs := make([]Input, 0, len(Sets))
	for _, set := range Sets {
		base, err := r.entriesAt(baseRef, set.Directory)
		if err != nil {
			return nil, err
		}
		head, err := r.entriesAt("HEAD", set.Directory)
		if err != nil {
			return nil, err
		}
		forked, err := r.entriesAt(mergeBase, set.Directory)
		if err != nil {
			return nil, err
		}
		touched, err := r.touchedSince(baseRef, set.Directory)
		if err != nil {
			return nil, err
		}
		inputs = append(inputs, Input{
			Set:       set,
			Base:      base,
			Head:      head,
			MergeBase: forked,
			Touched:   touched,
		})
	}
	return inputs, nil
}

func (r Repo) entriesAt(ref, directory string) ([]string, error) {
	out, err := r.git("ls-tree", "-r", "--name-only", ref, "--", directory)
	if err != nil {
		return nil, err
	}
	return TopLevelEntries(lines(out), directory), nil
}

func (r Repo) touchedSince(baseRef, directory string) ([]string, error) {
	out, err := r.git("diff", "--name-only", "--diff-filter=MDR", baseRef+"...HEAD", "--", directory)
	if err != nil {
		return nil, err
	}
	return TopLevelEntries(lines(out), directory), nil
}

func (r Repo) git(args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", r.Root}, args...)...)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git %s: %w", strings.Join(args, " "), err)
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
