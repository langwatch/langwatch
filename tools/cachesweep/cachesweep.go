// Package cachesweep picks main's superseded copies of the Actions caches keyed
// by the commit, so the repository keeps one copy of each.
//
// Spec: specs/ci/main-cache-sweep.feature
package cachesweep

import (
	"regexp"
	"sort"
	"time"
)

// Entry is one Actions cache as `gh cache list --json id,key,createdAt` prints it.
type Entry struct {
	ID        int64     `json:"id"`
	Key       string    `json:"key"`
	CreatedAt time.Time `json:"createdAt"`
}

// commitKeyed matches a key ending in the 40-hex commit. Everything before it,
// hashFiles segments included, names the cache: a pull request branched before
// a lockfile bump restores from main's copy under the old hash, and some of
// those restore keys are pinned to the hash with no wider fallback.
var commitKeyed = regexp.MustCompile(`^(.+-)[0-9a-f]{40}$`)

// Superseded returns the entries a newer copy of the same cache makes redundant.
// Entries whose key does not end in a commit are never returned.
func Superseded(entries []Entry) []Entry {
	byAge := append([]Entry(nil), entries...)
	sort.SliceStable(byAge, func(i, j int) bool { return byAge[i].CreatedAt.After(byAge[j].CreatedAt) })

	seen := map[string]bool{}
	var redundant []Entry
	for _, entry := range byAge {
		match := commitKeyed.FindStringSubmatch(entry.Key)
		if match == nil {
			continue
		}
		if seen[match[1]] {
			redundant = append(redundant, entry)
			continue
		}
		seen[match[1]] = true
	}
	return redundant
}
