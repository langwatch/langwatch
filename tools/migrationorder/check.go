package migrationorder

import (
	"cmp"
	"fmt"
	"regexp"
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
	// Misplaced are migration entries present under a forbidden, non-canonical
	// root at the branch head. Values are repository-relative paths.
	Misplaced []string
	// Released are the entries on release lines other than the base branch
	// (origin/main for a PR into a long-running branch). A migration that has
	// shipped there has run on real databases under that exact name, so a
	// branch carrying it is porting history, not adding a migration, and it
	// must keep the name.
	Released []string
	// Diverged are released entries the branch head carries with contents that
	// differ from the release line's copy. The name alone does not make a port
	// history: databases that ran the release recorded that name for its SQL.
	Diverged []Divergence
}

// Divergence is a released migration the branch carries with other contents.
type Divergence struct {
	// Entry is the migration name, as it appears under the set's directory.
	Entry string
	// Ref is the release line whose copy differs.
	Ref string
	// Path is the repository-relative path of the copy on Ref, which may sit
	// under one of the set's previous directories.
	Path string
}

// Finding is one migration that is out of order, and how to fix it.
type Finding struct {
	Set string `json:"set"`
	// Entry is the migration at fault.
	Entry string `json:"entry"`
	// Problem is one plain sentence.
	Problem string `json:"problem"`
	// Fix is the shell command that resolves it, empty when the fix is a naming
	// decision only the author can make.
	Fix string `json:"fix"`
}

// Check reports the migrations the branch adds that are out of order.
//
// Only what the branch adds is judged. Migrations already on the base branch are
// history — some predate the naming convention, and a few share a key — and
// renumbering them is not on the table.
func Check(in Input) []Finding {
	var findings []Finding

	for _, misplaced := range slices.Sorted(slices.Values(in.Misplaced)) {
		entry := misplacedEntry(misplaced, in.Set)
		fix := fmt.Sprintf("git mv %s %s", shellArg(misplaced), shellArg(in.Set.Directory+"/"+entry))
		problem := fmt.Sprintf("is outside the canonical migration root %s", in.Set.Directory)
		if slices.Contains(in.Head, entry) {
			problem = fmt.Sprintf("duplicates %s under the canonical migration root", entry)
			fix = fmt.Sprintf("git rm -r %s", shellArg(misplaced))
		}
		findings = append(findings, Finding{
			Set:     in.Set.Name,
			Entry:   misplaced,
			Problem: problem,
			Fix:     fix,
		})
	}

	existing := map[string]bool{}
	for _, entry := range slices.Concat(in.Base, in.MergeBase, in.Released) {
		existing[entry] = true
	}

	base := strings.TrimPrefix(in.BaseRef, "origin/")

	for _, entry := range slices.Sorted(slices.Values(in.Touched)) {
		if existing[entry] {
			findings = append(findings, Finding{
				Set:     in.Set.Name,
				Entry:   entry,
				Problem: "already merged, and migrations that have run somewhere cannot change",
				Fix:     fmt.Sprintf("git checkout %s -- %s", in.BaseRef, shellArg(in.Set.Directory+"/"+entry)),
			})
		}
	}

	for _, divergence := range slices.SortedFunc(slices.Values(in.Diverged), func(a, b Divergence) int {
		return cmp.Compare(a.Entry, b.Entry)
	}) {
		findings = append(findings, Finding{
			Set:     in.Set.Name,
			Entry:   divergence.Entry,
			Problem: fmt.Sprintf("differs from %s:%s, and migrations that have run somewhere cannot change", divergence.Ref, divergence.Path),
			Fix:     restoreReleased(divergence, in.Set),
		})
	}

	// Keys are taken by everything ever seen on either ref: a migration deleted
	// from the base branch after this branch forked has still run somewhere, so
	// its key is not free to reuse.
	taken, highest := keysOf(slices.Concat(in.Base, in.MergeBase), in.Set)

	// A released migration the branch ports keeps its name, and with it its key:
	// a migration the branch adds may not share that key either.
	portedKeys, highestPorted := keysOf(portedEntries(in), in.Set)

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
	// base branch, the released migrations this branch ports, and anything this
	// branch already numbered — so a suggestion never lands on a key that is
	// itself taken, and two clashing migrations get two different answers.
	free := max(highest, highestPorted)
	for _, m := range added {
		free = max(free, m.key)
	}
	suggest := func(entry string) string {
		free++
		_, suffix, _ := strings.Cut(entry, "_")
		return fmt.Sprintf("git mv %s %s%s%s",
			shellArg(in.Set.Directory+"/"+entry),
			shellArg(in.Set.Directory+"/"), in.Set.Render(free), shellArg("_"+suffix))
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
		case portedKeys[m.key] != "":
			findings = append(findings, Finding{
				Set:     in.Set.Name,
				Entry:   m.entry,
				Problem: fmt.Sprintf("shares key %d with %s, a released migration this branch ports", m.key, portedKeys[m.key]),
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

// portedEntries are the released entries the branch head carries that the base
// branch never had: migrations the branch ports from a release line.
func portedEntries(in Input) []string {
	onBase := map[string]bool{}
	for _, entry := range slices.Concat(in.Base, in.MergeBase) {
		onBase[entry] = true
	}
	var ported []string
	for _, entry := range in.Head {
		if !onBase[entry] && slices.Contains(in.Released, entry) {
			ported = append(ported, entry)
		}
	}
	return ported
}

// restoreReleased is the command that puts the release line's copy of a
// diverged migration back under the set's directory.
func restoreReleased(divergence Divergence, set Set) string {
	target := set.Directory + "/" + divergence.Entry
	if divergence.Path == target {
		return fmt.Sprintf("git checkout %s -- %s", shellArg(divergence.Ref), shellArg(target))
	}
	return fmt.Sprintf("git rm -r -q %s && git checkout %s -- %s && git mv %s %s",
		shellArg(target), shellArg(divergence.Ref), shellArg(divergence.Path),
		shellArg(divergence.Path), shellArg(target))
}

func misplacedEntry(misplaced string, set Set) string {
	for _, directory := range set.ForbiddenDirectories {
		if entry, found := strings.CutPrefix(misplaced, directory+"/"); found {
			return entry
		}
	}
	return misplaced
}

type migration struct {
	entry string
	key   int64
}

var plainArg = regexp.MustCompile(`^[A-Za-z0-9._/-]+$`)

// shellArg single-quotes s unless it needs no quoting. Entry names are chosen
// by the PR under review, and the findings end up in a bot comment as commands
// to copy-paste — a hostile name must not smuggle an expansion into them.
func shellArg(s string) string {
	if plainArg.MatchString(s) {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
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
