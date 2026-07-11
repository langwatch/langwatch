package migrationorder

import (
	"fmt"
	"slices"
	"strconv"
)

// Input is one migration set as it looks from three refs: the tip of the base
// branch, the pull request head, and the merge base the pull request forked at.
type Input struct {
	Set Set
	// Base are the entries on the tip of the base branch.
	Base []string
	// Head are the entries on the pull request head.
	Head []string
	// MergeBase are the entries that already existed where the branch forked.
	MergeBase []string
	// Touched are the entries the pull request modified, renamed or deleted.
	Touched []string
}

// Check reports every ordering violation the pull request introduces.
//
// Only migrations the pull request adds are judged. What is already on the base
// branch is history: it predates the naming convention in places, and two merged
// migrations may even share a key. Neither is this pull request's problem.
func Check(in Input) []string {
	var errs []string

	existing := map[string]bool{}
	for _, entry := range slices.Concat(in.Base, in.MergeBase) {
		existing[entry] = true
	}

	touched := slices.Clone(in.Touched)
	slices.Sort(touched)
	for _, entry := range touched {
		if existing[entry] {
			errs = append(errs, fmt.Sprintf(
				"%s: `%s` already exists on the base branch and was modified, renamed or deleted — "+
					"applied migrations are immutable history, add a new migration instead",
				in.Set.Name, entry))
		}
	}

	baseKeys, highest := keysOf(in.Base, in.Set)

	added := []migration{}
	for _, entry := range slices.Sorted(slices.Values(in.Head)) {
		if existing[entry] {
			continue
		}
		key, ok := keyOf(entry, in.Set)
		if !ok {
			errs = append(errs, fmt.Sprintf(
				"%s: `%s` does not start with an ordering key — name it `%s`",
				in.Set.Name, entry, in.Set.Format))
			continue
		}
		added = append(added, migration{entry: entry, key: key})
	}
	slices.SortFunc(added, func(a, b migration) int { return int(a.key - b.key) })

	for _, m := range added {
		if taken, ok := baseKeys[m.key]; ok {
			errs = append(errs, fmt.Sprintf(
				"%s: `%s` reuses ordering key %d, already taken on the base branch by `%s` — renumber it above %d",
				in.Set.Name, m.entry, m.key, taken, highest))
			continue
		}
		if m.key <= highest {
			errs = append(errs, fmt.Sprintf(
				"%s: `%s` sorts at or before %d, the highest migration already on the base branch — "+
					"renumber it above %d so it runs after everything already merged",
				in.Set.Name, m.entry, highest, highest))
			continue
		}
		for _, twin := range added {
			if twin.key == m.key && twin.entry != m.entry {
				errs = append(errs, fmt.Sprintf(
					"%s: `%s` and `%s` share ordering key %d — keys must be unique",
					in.Set.Name, m.entry, twin.entry, m.key))
			}
		}
	}

	return errs
}

type migration struct {
	entry string
	key   int64
}

func keyOf(entry string, set Set) (int64, bool) {
	match := set.Key.FindStringSubmatch(entry)
	if match == nil {
		return 0, false
	}
	key, err := strconv.ParseInt(match[1], 10, 64)
	if err != nil {
		return 0, false
	}
	return key, true
}

func keysOf(entries []string, set Set) (map[int64]string, int64) {
	keys := map[int64]string{}
	highest := int64(-1)
	for _, entry := range entries {
		key, ok := keyOf(entry, set)
		if !ok {
			continue
		}
		keys[key] = entry
		highest = max(highest, key)
	}
	return keys, highest
}
