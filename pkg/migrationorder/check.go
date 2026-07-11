package migrationorder

import (
	"cmp"
	"fmt"
	"slices"
	"strconv"
	"strings"
)

// Input is one migration set seen from three refs: the tip of the base branch,
// the branch head, and the merge base the branch forked at.
type Input struct {
	Set Set
	// BaseRef is the ref being compared against, e.g. "origin/main". It names the
	// branch in the findings and in the commands that fix them.
	BaseRef string
	// Base are the entries on the tip of the base branch.
	Base []string
	// Head are the entries on the branch head.
	Head []string
	// MergeBase are the entries that existed where the branch forked.
	MergeBase []string
	// Touched are the entries the branch modified, renamed or deleted.
	Touched []string
}

// Finding is one migration that is out of order, and how to fix it.
type Finding struct {
	Set string `json:"set"`
	// Entry is the migration at fault.
	Entry string `json:"entry"`
	// Problem is one plain sentence.
	Problem string `json:"problem"`
	// Fix is the shell command that resolves it.
	Fix string `json:"fix"`
}

// Check reports the migrations the branch adds that are out of order.
//
// Only what the branch adds is judged. Migrations already on the base branch are
// history — some predate the naming convention, and a few share a key — and
// renumbering them is not on the table.
func Check(in Input) []Finding {
	var findings []Finding

	existing := map[string]bool{}
	for _, entry := range slices.Concat(in.Base, in.MergeBase) {
		existing[entry] = true
	}

	base := strings.TrimPrefix(in.BaseRef, "origin/")

	for _, entry := range slices.Sorted(slices.Values(in.Touched)) {
		if existing[entry] {
			findings = append(findings, Finding{
				Set:     in.Set.Name,
				Entry:   entry,
				Problem: "already merged, and migrations that have run somewhere cannot change",
				Fix:     fmt.Sprintf("git checkout %s -- %s/%s", in.BaseRef, in.Set.Directory, entry),
			})
		}
	}

	taken, highest := keysOf(in.Base, in.Set)

	var added []migration
	for _, entry := range slices.Sorted(slices.Values(in.Head)) {
		if existing[entry] {
			continue
		}
		key, ok := keyOf(entry, in.Set)
		if !ok {
			findings = append(findings, Finding{
				Set:     in.Set.Name,
				Entry:   entry,
				Problem: fmt.Sprintf("has no ordering key, so it has no place in the sequence — migrations are named %s", in.Set.Format),
			})
			continue
		}
		added = append(added, migration{entry: entry, key: key})
	}
	slices.SortFunc(added, func(a, b migration) int { return cmp.Compare(a.key, b.key) })

	// Suggested keys are handed out above everything in play — the newest on the
	// base branch and anything this branch already numbered — so a suggestion
	// never lands on a key that is itself taken, and two clashing migrations get
	// two different answers.
	free := highest
	for _, m := range added {
		free = max(free, m.key)
	}
	suggest := func(entry string) string {
		free++
		_, suffix, _ := strings.Cut(entry, "_")
		return fmt.Sprintf("git mv %s/%s %s/%s_%s",
			in.Set.Directory, entry, in.Set.Directory, in.Set.Render(free), suffix)
	}

	for _, m := range added {
		twin := slices.ContainsFunc(added, func(other migration) bool {
			return other.key == m.key && other.entry != m.entry
		})

		switch {
		case taken[m.key] != "":
			findings = append(findings, Finding{
				Set:     in.Set.Name,
				Entry:   m.entry,
				Problem: fmt.Sprintf("takes key %d, which %s already took on %s", m.key, taken[m.key], base),
				Fix:     suggest(m.entry),
			})
		case m.key < highest:
			findings = append(findings, Finding{
				Set:     in.Set.Name,
				Entry:   m.entry,
				Problem: fmt.Sprintf("is numbered below %d, the newest migration on %s, so it runs out of order or not at all", highest, base),
				Fix:     suggest(m.entry),
			})
		case twin:
			findings = append(findings, Finding{
				Set:     in.Set.Name,
				Entry:   m.entry,
				Problem: fmt.Sprintf("shares key %d with another migration in this branch", m.key),
				Fix:     suggest(m.entry),
			})
		}
	}

	return findings
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
