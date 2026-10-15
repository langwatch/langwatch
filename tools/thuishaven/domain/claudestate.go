// Claude Code's own state: where it writes, which worktree each directory
// belongs to, and when a directory has sat around long enough — and grown large
// enough — to be worth a line in a cleanup report. Nothing here removes
// anything. Transcripts are the record of work rather than scratch, so the
// catalog exists to attribute and to warn, never to offer a delete.
package domain

import (
	"path/filepath"
	"strings"
	"time"
)

// ClaudeStateScope is what a directory under the Claude home is keyed by, which
// decides whether it can be attributed to a worktree at all.
type ClaudeStateScope string

const (
	// ClaudeScopeWorktree is keyed by the path Claude was run in, so it maps onto
	// exactly one worktree.
	ClaudeScopeWorktree ClaudeStateScope = "per worktree"
	// ClaudeScopeSession is keyed by a session id. The session knows its project;
	// the directory name does not, so these are named and left unattributed.
	ClaudeScopeSession ClaudeStateScope = "per session"
	// ClaudeScopeMachine belongs to the installation, not to any one checkout.
	ClaudeScopeMachine ClaudeStateScope = "machine-wide"
)

// ClaudeStateRoot names which base directory a location sits under. Claude Code
// writes in two places, not one: its own home, and a per-user directory in the
// system temp root — which holds the same per-project split under a name that
// looks like scratch and outlives the session that made it.
type ClaudeStateRoot string

const (
	// ClaudeRootHome is Claude Code's own home, ~/.claude.
	ClaudeRootHome ClaudeStateRoot = "home"
	// ClaudeRootTmp is the per-user temp directory, /tmp/claude-<uid>.
	ClaudeRootTmp ClaudeStateRoot = "tmp"
)

// ClaudeLocation is one directory Claude Code writes, in the words of what it
// holds. PerEntry marks the ones whose children are the unit worth reporting —
// `projects` holds one directory per worktree, and reporting its total would
// hide which worktree the weight belongs to. An empty Name is the root itself,
// which is how the temp root is described: its children are the projects.
type ClaudeLocation struct {
	Root     ClaudeStateRoot
	Name     string
	Scope    ClaudeStateScope
	Holds    string
	PerEntry bool
}

// ClaudeLocations is the catalog: every directory under the Claude home a
// cleanup should be able to name, minus the two haven already reclaims. It is
// deliberately a list of names rather than a scan of the home directory, so a
// directory that appears in a new release is reported as unknown by the reader
// instead of silently sized and attributed wrongly.
var ClaudeLocations = []ClaudeLocation{
	{Root: ClaudeRootHome, Name: "projects", Scope: ClaudeScopeWorktree, Holds: "conversation transcripts", PerEntry: true},
	{Root: ClaudeRootHome, Name: "file-history", Scope: ClaudeScopeSession, Holds: "pre-edit copies of the files a session changed"},
	{Root: ClaudeRootHome, Name: "session-env", Scope: ClaudeScopeSession, Holds: "the environment each session resolved"},
	{Root: ClaudeRootHome, Name: "shell-snapshots", Scope: ClaudeScopeSession, Holds: "the shell each session inherited"},
	{Root: ClaudeRootHome, Name: "paste-cache", Scope: ClaudeScopeSession, Holds: "text pasted into a session"},
	{Root: ClaudeRootHome, Name: "sessions", Scope: ClaudeScopeSession, Holds: "session bookkeeping"},
	{Root: ClaudeRootHome, Name: "tasks", Scope: ClaudeScopeSession, Holds: "task lists a session kept"},
	{Root: ClaudeRootHome, Name: "backups", Scope: ClaudeScopeSession, Holds: "copies taken before a rewrite"},
	{Root: ClaudeRootHome, Name: "plugins", Scope: ClaudeScopeMachine, Holds: "installed plugins and their marketplace checkouts"},
	{Root: ClaudeRootHome, Name: "cache", Scope: ClaudeScopeMachine, Holds: "downloads and computed data, regenerable"},
	{Root: ClaudeRootHome, Name: "telemetry", Scope: ClaudeScopeMachine, Holds: "buffered telemetry awaiting export"},
	// The temp root's own children are the per-project directories, so the
	// location is the root itself. It is easy to miss twice over: it is not under
	// the Claude home, and a path in the temp root reads as something the system
	// clears — which nothing here does, on any platform, while a machine stays up.
	{Root: ClaudeRootTmp, Name: "", Scope: ClaudeScopeWorktree, Holds: "per-session working files kept outside the Claude home", PerEntry: true},
}

// ClaudeReclaimedLocations are the directories under the Claude home a cleanup
// already owns — job scratch and agent worktrees, each with its own guards, its
// own picker and its own age rule. Naming them here is what keeps this report
// from counting the same gigabytes a second time under a different heading.
var ClaudeReclaimedLocations = []string{"jobs", "worktrees"}

// ClaudeStateCold is how long a file must have gone untouched to count as old.
// Three months is past every review of a finished branch, and well past the
// point where a transcript is being read rather than remembered.
const ClaudeStateCold = 90 * 24 * time.Hour

// ClaudeStateNoticeBytes is how much cold weight has to pile up in one place
// before haven says anything about it. Below a quarter of a gigabyte the honest
// answer is that it does not matter, and a report that mentions everything is
// one nobody reads.
const ClaudeStateNoticeBytes int64 = 250 << 20

// ClaudeStateLeftBehindBytes is how much a gone worktree has to have left
// before its directory is worth a line of its own. Without a floor the report
// is thirty lines of forty-kilobyte test sandboxes above the gigabyte that
// actually costs something — true, and useless. Below it the directories are
// counted in one line rather than listed.
const ClaudeStateLeftBehindBytes int64 = 50 << 20

// ClaudeProjectSlug encodes a filesystem path the way Claude Code names the
// transcript directory for it: every character that is not a letter or a digit
// becomes a dash. The encoding is lossy — a slash, a dot and a dash all arrive
// as a dash — so a slug can never be turned back into one path. Linking only
// ever goes this way: encode each worktree haven knows about, then compare.
func ClaudeProjectSlug(dir string) string {
	cleaned := filepath.Clean(dir)
	var b strings.Builder
	b.Grow(len(cleaned))
	for _, r := range cleaned {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	return b.String()
}

// ClaudeScan is one measurement request: which root to look under, which
// location to measure, and the instant before which a file counts as old.
type ClaudeScan struct {
	Root       string
	Loc        ClaudeLocation
	ColdBefore time.Time
}

// Dir is where this scan's location lives. An empty location Name is the root
// itself, which is how the temp root is described.
func (s ClaudeScan) Dir() string { return filepath.Join(s.Root, s.Loc.Name) }

// ClaudeNameIsPath reports whether a directory name is an encoded path rather
// than a plain name. An encoded absolute path always begins with the separator,
// which the encoding turns into a leading dash — so the per-entry locations that
// mix the two (a temp root holding both project directories and a bundled-skills
// cache) can tell which of their children names a worktree.
func ClaudeNameIsPath(name string) bool { return strings.HasPrefix(name, "-") }

// ClaudeStateRecord is what the filesystem answers about one directory: how big
// it is, how much of that has not been touched since ClaudeStateCold, and when
// anything in it was last written. The cold share is measured per file rather
// than from the directory's own mtime, because the directory a machine writes to
// every day is exactly the one whose bytes are mostly a year old.
type ClaudeStateRecord struct {
	Name      string
	Dir       string
	Bytes     int64
	ColdBytes int64
	Newest    time.Time
}

// Add folds one file into the record: its bytes, whether they are cold, and
// whether it is the newest thing in the directory. Cold and newest are asked
// separately on purpose — a directory appended to every day is exactly the one
// whose weight is mostly old, and reporting either fact alone misleads.
func (r *ClaudeStateRecord) Add(size int64, modified, coldBefore time.Time) {
	r.Bytes += size
	if modified.Before(coldBefore) {
		r.ColdBytes += size
	}
	if modified.After(r.Newest) {
		r.Newest = modified
	}
}

// ClaudeStateFacts is one reported row before the verdict: what the directory
// is, what it holds, and which worktree — if any — it belongs to.
type ClaudeStateFacts struct {
	ClaudeStateRecord
	Scope ClaudeStateScope
	Holds string
	// WorktreeDir is the live worktree this directory belongs to, empty when
	// nothing on disk matches or when the scope cannot name one.
	WorktreeDir string
	// Slugged marks a name that encodes a path — the only kind that can be said
	// to have lost its worktree rather than never having had one.
	Slugged bool
}

// ClaudeStateVerdict is what a cleanup says about one directory. Notice is the
// whole of it: empty means there is nothing worth interrupting for, which is the
// answer for most rows on most machines.
type ClaudeStateVerdict struct {
	Linked     bool
	LeftBehind bool
	Notice     string
}

// ClassifyClaudeState decides what, if anything, to say about one directory. A
// row earns a notice two ways and they compose: its worktree is gone and it is
// still holding bytes, or enough of its weight has sat untouched past
// ClaudeStateCold. Large-but-current and old-but-small both say nothing.
func ClassifyClaudeState(f ClaudeStateFacts) ClaudeStateVerdict {
	v := ClaudeStateVerdict{
		Linked:     f.WorktreeDir != "",
		LeftBehind: f.Slugged && f.WorktreeDir == "",
	}
	var parts []string
	if v.LeftBehind && f.Bytes >= ClaudeStateLeftBehindBytes {
		parts = append(parts, "worktree gone — "+HumanBytes(f.Bytes)+" still here")
	}
	if f.ColdBytes >= ClaudeStateNoticeBytes {
		parts = append(parts, HumanBytes(f.ColdBytes)+" untouched for "+HumanAge(ClaudeStateCold)+"+")
	}
	v.Notice = strings.Join(parts, " · ")
	return v
}
