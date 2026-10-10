package domain

import (
	"fmt"
	"strings"
)

// ReclaimKind names one class of thing a cleanup reclaims, in the words the
// operator reads. Every progress line, picker header and summary takes its noun
// from here, so a pass that is deleting job scratch can never announce itself as
// worktrees — the defect that made "deleting 187 worktree(s)" appear while 187
// agent job directories were being emptied.
type ReclaimKind struct {
	Singular string
	Plural   string
}

var (
	// WorktreeKind is a git worktree: its stack is stopped, its databases are
	// dropped and its directory is removed.
	WorktreeKind = ReclaimKind{Singular: "worktree", Plural: "worktrees"}
	// JobScratchKind is one agent job directory: its scratch goes, its record stays.
	JobScratchKind = ReclaimKind{Singular: "job scratch dir", Plural: "job scratch dirs"}
)

// Count renders n of this kind: "1 worktree", "158 job scratch dirs".
func (k ReclaimKind) Count(n int) string {
	if k.Singular == "" {
		return fmt.Sprintf("%d item(s)", n)
	}
	if n == 1 {
		return "1 " + k.Singular
	}
	return fmt.Sprintf("%d %s", n, k.Plural)
}

// ReclaimTally accumulates what one cleanup actually freed, per kind and in the
// order the kinds were first touched. It is what replaces the per-item log line
// on the terminal: the detail goes to the log file, and the run ends with one
// compact sentence naming each kind separately.
type ReclaimTally struct {
	order  []ReclaimKind
	counts map[string]int
	freed  map[string]int64
	kept   map[string]int
}

// Add records one reclaimed item of a kind and the bytes it freed.
func (t *ReclaimTally) Add(kind ReclaimKind, freed int64) { t.AddMany(kind, 1, freed) }

// AddMany records count reclaimed items of a kind and the bytes they freed
// together — what a picker reports back for a whole confirmed batch.
func (t *ReclaimTally) AddMany(kind ReclaimKind, count int, freed int64) {
	if count <= 0 {
		return
	}
	t.touch(kind)
	t.counts[kind.Singular] += count
	t.freed[kind.Singular] += freed
}

// Kept records one item of a kind that was offered but not reclaimed — refused
// by a guard, or failed. A cleanup that silently drops these reads as if it did
// everything it was asked to.
func (t *ReclaimTally) Kept(kind ReclaimKind) { t.KeptMany(kind, 1) }

// KeptMany records count items of a kind that were not reclaimed.
func (t *ReclaimTally) KeptMany(kind ReclaimKind, count int) {
	if count <= 0 {
		return
	}
	t.touch(kind)
	t.kept[kind.Singular] += count
}

func (t *ReclaimTally) touch(kind ReclaimKind) {
	if t.counts == nil {
		t.counts, t.freed, t.kept = map[string]int{}, map[string]int64{}, map[string]int{}
	}
	for _, k := range t.order {
		if k.Singular == kind.Singular {
			return
		}
	}
	t.order = append(t.order, kind)
}

// Summary is the one line a cleanup prints when its work is done — each kind
// counted and sized on its own, never merged into a single number.
func (t ReclaimTally) Summary() string {
	var parts []string
	for _, k := range t.order {
		n := t.counts[k.Singular]
		if n > 0 {
			parts = append(parts, k.Count(n)+", "+HumanBytes(t.freed[k.Singular]))
		}
		if kept := t.kept[k.Singular]; kept > 0 {
			parts = append(parts, k.Count(kept)+" kept")
		}
	}
	if len(parts) == 0 {
		return "reclaimed nothing"
	}
	return "reclaimed " + strings.Join(parts, "; ")
}
