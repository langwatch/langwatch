package domain

import (
	"fmt"
	"time"
)

// JobScratchIdle is how long a job directory must have gone both unmodified and
// unread before its scratch is reclaimed on age alone. A week outlives any
// review of last Friday's run.
const JobScratchIdle = 7 * 24 * time.Hour

// JobScratchRecent is how long a finished job's scratch is treated as recent
// work regardless of the state it recorded. A job that ended an hour ago is the
// one whose files somebody is still opening — the tail of a run is read long
// after the run itself is `done` — so its scratch is never pre-ticked and never
// reclaimed unattended. Two days puts yesterday evening's run out of reach of a
// cleanup run this morning.
const JobScratchRecent = 48 * time.Hour

// JobRecordFiles are the two files a reclaim always keeps: what the job was and
// what it did. Everything else in the directory — a `tmp/` tree, worktree
// copies, logs — is scratch the job produced on its way there, and can run to
// tens of gigabytes for a single run.
var JobRecordFiles = []string{"state.json", "timeline.jsonl"}

// terminalJobStates are the states a job never leaves. Read off the states
// present on a real machine: a finished job is `done`, a cancelled one
// `stopped`, a crashed one `failed`. Anything else — `blocked`, or a state added
// later — is treated as still live, so an unknown vocabulary keeps the scratch
// rather than deleting it.
var terminalJobStates = []string{"done", "stopped", "failed"}

// IsTerminalJobState reports whether a job has finished for good.
func IsTerminalJobState(state string) bool {
	for _, s := range terminalJobStates {
		if state == s {
			return true
		}
	}
	return false
}

// JobRecord is one directory under the agent jobs root as the reclaimer sees it.
type JobRecord struct {
	ID   string
	Dir  string
	Name string
	// State is state.json's `state`, or "" when the file is missing or unreadable.
	State string
	// NewestMtime and NewestAtime are the most recent modification and access
	// times anywhere in the directory tree. Both must be old before age alone
	// reclaims a job: a directory nobody has written to may still be one somebody
	// is reading.
	NewestMtime time.Time
	NewestAtime time.Time
	// InUse marks a job a live process is working in, or the job haven itself was
	// launched from. Never reclaimed, whatever its recorded state says.
	InUse bool
}

// JobVerdict is one job's classification: whether its scratch may go, and the
// one line explaining why, shown in the picker, the report and the daemon log.
type JobVerdict struct {
	Reclaimable bool
	// Cold marks a job whose scratch is clearly beyond use: terminal for longer
	// than JobScratchRecent, or untouched for JobScratchIdle. Only a cold job is
	// pre-ticked in the picker or reclaimed unattended; a terminal job younger
	// than that is offered to a person who asks for it by name and to nobody else.
	Cold   bool
	Reason string
}

// ClassifyJob decides whether a job's scratch may be reclaimed, and whether it
// is cold enough to reclaim without being asked twice. A job in use is
// never touched — that guard comes before the state, because a state file
// written minutes ago can already say `done` while the process that wrote it is
// still tidying up. Otherwise a terminal job's scratch has no reader left, and a
// job whose directory has gone both unwritten and unread for JobScratchIdle has
// no reader either, whatever state it recorded.
func ClassifyJob(rec JobRecord, now time.Time) JobVerdict {
	if rec.InUse {
		return JobVerdict{Reason: "in use by a live process"}
	}
	if IsTerminalJobState(rec.State) {
		age := JobAge(rec, now)
		if age < JobScratchRecent {
			return JobVerdict{
				Reclaimable: true,
				Reason:      "finished (" + rec.State + ") " + HumanAge(age) + " ago — recent",
			}
		}
		return JobVerdict{Reclaimable: true, Cold: true, Reason: "finished (" + rec.State + ")"}
	}
	cutoff := now.Add(-JobScratchIdle)
	if !rec.NewestMtime.IsZero() && !rec.NewestAtime.IsZero() &&
		rec.NewestMtime.Before(cutoff) && rec.NewestAtime.Before(cutoff) {
		return JobVerdict{Reclaimable: true, Cold: true, Reason: fmt.Sprintf("untouched %s", HumanAge(now.Sub(rec.NewestMtime)))}
	}
	return JobVerdict{Reason: "still active"}
}

// JobAge is how long ago a job was last touched — the newer of its two
// timestamps, so a job being read counts as recent. Zero when neither is known.
func JobAge(rec JobRecord, now time.Time) time.Duration {
	last := rec.NewestMtime
	if rec.NewestAtime.After(last) {
		last = rec.NewestAtime
	}
	if last.IsZero() {
		return 0
	}
	if d := now.Sub(last); d > 0 {
		return d
	}
	return 0
}
