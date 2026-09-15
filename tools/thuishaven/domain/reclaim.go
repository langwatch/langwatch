package domain

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

// WorktreeClass names why a worktree is reclaimable sooner than the plain idle
// clock would say. The empty class is the ordinary case: nothing about the
// worktree says it may go, so only the operator's own tick in `haven clean`
// removes it.
type WorktreeClass string

const (
	// ClassNone is a worktree that is only ever removed by hand.
	ClassNone WorktreeClass = ""
	// ClassTemporary is scratch a tool made and forgot: a detached checkout in one
	// of the tools' own directories, a visual-diff or apidiff drive, or a worktree
	// on an agent-minted branch. Regenerable by definition — the tool that wants
	// one makes another.
	ClassTemporary WorktreeClass = "temporary"
	// ClassMerged is a worktree whose branch is already contained in origin/main.
	// Its commits are on main; the directory is a copy of history, not history.
	ClassMerged WorktreeClass = "merged"
)

// TemporaryWorktreeIdle is how long a temporary worktree must sit untouched
// before it is reclaimed. A day is long enough that a diff drive or an agent lane
// still running this morning is never taken out from under it, and short enough
// that a machine does not carry a week of scratch.
const TemporaryWorktreeIdle = 24 * time.Hour

// agentBranchPrefixes name the branches a spawned agent or a worktree driver
// creates for itself. Matching on the branch (not the path) catches the ones that
// live in an ordinary directory.
var agentBranchPrefixes = []string{"worktree-agent-", "agent/"}

// scratchDirPrefixes are the basenames the diff drives mint — one directory per
// comparison, never returned to. They are matched wherever they are, because the
// drives put them in three different places on one machine (a `worktrees`
// sibling, /tmp, a job's own scratch) and the names are unmistakable.
var scratchDirPrefixes = []string{"visual-", "apidiff-"}

// scratchParents are the directories a tool owns wholesale: everything a worktree
// of theirs contains is theirs. Each entry is matched as consecutive path
// segments, so `.claude/worktrees` does not match a directory merely called
// "worktrees".
var scratchParents = [][]string{
	{".apidiff"},
	{".claude", "worktrees"},
	{".claude", "jobs"},
}

// IsScratchWorktreePath reports whether dir is one of the locations a diff tool
// or an agent creates worktrees in: under `.apidiff/`, `.claude/worktrees/` or
// `.claude/jobs/`, or a directory the drives named `visual-*` / `apidiff-*`. It
// matches on path segments rather than a prefix of the repo root, so a worktree
// created beside the repository, or in the system temp directory, is classified
// the same as one created inside it.
func IsScratchWorktreePath(dir string) bool {
	segs := strings.Split(strings.Trim(filepath.ToSlash(filepath.Clean(dir)), "/"), "/")
	return hasScratchParent(segs) || hasScratchBasename(segs)
}

// hasScratchParent matches the directories a tool owns wholesale: anything under
// `.apidiff/`, `.claude/worktrees/` or `.claude/jobs/` — the last because a
// visual-diff drive checks its two worktrees out inside the job's own scratch,
// where reclaiming the job would otherwise leave git's admin entry dangling.
func hasScratchParent(segs []string) bool {
	for i := range segs {
		for _, parent := range scratchParents {
			if segmentsMatchAt(segs, i, parent) {
				return true
			}
		}
	}
	return false
}

// segmentsMatchAt reports whether want appears in segs starting at i.
func segmentsMatchAt(segs []string, i int, want []string) bool {
	if i+len(want) > len(segs) {
		return false
	}
	for j, w := range want {
		if segs[i+j] != w {
			return false
		}
	}
	return true
}

// hasScratchBasename matches one drive's own directory by the name the drive
// gave it, wherever it put it.
func hasScratchBasename(segs []string) bool {
	if len(segs) == 0 {
		return false
	}
	for _, p := range scratchDirPrefixes {
		if strings.HasPrefix(segs[len(segs)-1], p) {
			return true
		}
	}
	return false
}

// IsAgentBranch reports whether a branch name is one an agent or worktree driver
// minted for itself rather than one a person named.
func IsAgentBranch(branch string) bool {
	for _, p := range agentBranchPrefixes {
		if strings.HasPrefix(branch, p) {
			return true
		}
	}
	return false
}

// WorktreeFacts is everything the classification reads. Every guard is a field
// rather than a rule applied afterwards, so no caller can classify a worktree
// while forgetting one.
type WorktreeFacts struct {
	Dir    string
	Branch string // "" for a detached HEAD
	// IsProtected is the primary checkout or the worktree haven runs from.
	IsProtected bool
	IsDirty     bool
	IsLive      bool
	// MergedIntoMain is `git merge-base --is-ancestor <branch> origin/main`.
	MergedIntoMain bool
	// UntouchedFor is how long nothing has been written in the directory itself —
	// the only clock the temporary rule may use (see Hygiene.LastTouched).
	UntouchedFor   time.Duration
	UntouchedKnown bool
}

// ClassifyWorktree decides whether a worktree may be reclaimed ahead of the idle
// clock, and returns the class plus the one-line reason shown in the picker, the
// report and the daemon's log.
//
// The guards come first and are absolute: the primary checkout, the worktree
// haven runs from, a worktree with uncommitted changes, and one with a running
// stack are never candidates, whatever their age or shape. Uncommitted work is
// unrecoverable and no age makes it disposable (ADR-064).
func ClassifyWorktree(f WorktreeFacts) (WorktreeClass, string) {
	if f.IsProtected || f.IsDirty || f.IsLive {
		return ClassNone, ""
	}
	if isTemporaryShape(f) && f.UntouchedKnown && f.UntouchedFor >= TemporaryWorktreeIdle {
		return ClassTemporary, fmt.Sprintf("temporary scratch, untouched %s", HumanAge(f.UntouchedFor))
	}
	if f.MergedIntoMain {
		return ClassMerged, "branch already contained in origin/main"
	}
	return ClassNone, ""
}

// isTemporaryShape is the shape half of the temporary class: a detached checkout
// in a scratch location, or any worktree on an agent-minted branch. The detached
// requirement is what keeps a hand-made branch that happens to live under
// .claude/worktrees/ out of the class.
func isTemporaryShape(f WorktreeFacts) bool {
	if IsAgentBranch(f.Branch) {
		return true
	}
	return f.Branch == "" && IsScratchWorktreePath(f.Dir)
}
