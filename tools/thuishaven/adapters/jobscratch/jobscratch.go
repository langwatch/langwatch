// Package jobscratch implements app.JobScratch over the agent job directories
// under ~/.claude/jobs. Each job keeps a record of itself — state.json and
// timeline.jsonl — beside the scratch it produced getting there, and the scratch
// is what fills a disk: a single run's tmp/ tree can reach tens of gigabytes.
// Reclaiming a job means deleting that scratch and keeping the record, so what
// the job was and what it did survive its working files.
package jobscratch

import (
	"context"
	"encoding/json"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// JobScratch is the filesystem-backed implementation of app.JobScratch. It
// answers what the filesystem knows — state, timestamps, size — and nothing
// about which jobs are in use: that is read from the process table, which the
// app layer owns through its System port and samples once for a whole plan.
type JobScratch struct{}

// New returns a JobScratch.
func New() JobScratch { return JobScratch{} }

// stateFile is the per-job record the classification reads.
type stateFile struct {
	State string `json:"state"`
	Name  string `json:"name"`
}

// Jobs reads every job directory under root. A root that does not exist is not
// an error — a machine that has never run an agent job simply has no jobs — and
// a directory whose state.json is missing or unparseable is still returned with
// an empty State, so the age rule can still reclaim its scratch.
func (JobScratch) Jobs(root string) ([]domain.JobRecord, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var jobs []domain.JobRecord
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		jobs = append(jobs, readJob(root, e.Name()))
	}
	return jobs, nil
}

// readJob is one directory's record: what its state file says, and how recently
// anything in it was written or read.
//
// The full tree walk is only needed to answer the age rule, and the age rule is
// only consulted for a job that has NOT finished. Walking a terminal job's tree
// anyway is what turned `haven clean --agent` into a six-minute command on a
// machine holding twenty gigabytes of scratch, for timestamps nothing then
// reads — so a finished job is dated from its own record files instead.
func readJob(root, id string) domain.JobRecord {
	dir := filepath.Join(root, id)
	rec := domain.JobRecord{ID: id, Dir: dir}
	if st, ok := readState(dir); ok {
		rec.State, rec.Name = st.State, st.Name
	}
	if domain.IsTerminalJobState(rec.State) {
		rec.NewestMtime, rec.NewestAtime = recordTimes(dir)
	} else {
		rec.NewestMtime, rec.NewestAtime = newestTimes(dir)
	}
	return rec
}

// readState parses a job's state.json. Unreadable or malformed reads as absent:
// the age rule then decides, which is the conservative answer.
func readState(dir string) (stateFile, bool) {
	b, err := os.ReadFile(filepath.Join(dir, "state.json"))
	if err != nil {
		return stateFile{}, false
	}
	var st stateFile
	if err := json.Unmarshal(b, &st); err != nil {
		return stateFile{}, false
	}
	return st, true
}

// recordTimes dates a finished job from the directory and its two record files
// alone — three stats instead of a walk over everything the run produced.
func recordTimes(dir string) (newestMtime, newestAtime time.Time) {
	paths := []string{dir}
	for _, name := range domain.JobRecordFiles {
		paths = append(paths, filepath.Join(dir, name))
	}
	for _, path := range paths {
		info, err := os.Lstat(path)
		if err != nil {
			continue
		}
		if mt := info.ModTime(); mt.After(newestMtime) {
			newestMtime = mt
		}
		if at, ok := accessTime(info); ok && at.After(newestAtime) {
			newestAtime = at
		}
	}
	return newestMtime, newestAtime
}

// newestTimes walks the job tree for the most recent modification and access
// time anywhere in it. Both are needed: a directory nobody has written to may
// still be one somebody is reading, and only "neither written nor read" makes a
// job old enough to reclaim on age alone. Walk errors are skipped rather than
// returned — a file that vanished mid-walk says nothing about the job's age.
func newestTimes(dir string) (newestMtime, newestAtime time.Time) {
	_ = filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		if mt := info.ModTime(); mt.After(newestMtime) {
			newestMtime = mt
		}
		if at, ok := accessTime(info); ok && at.After(newestAtime) {
			newestAtime = at
		}
		return nil
	})
	return newestMtime, newestAtime
}

// Size reports how much disk a job directory occupies, via `du -sk` — the same
// measurement (and the same read of its exit code) the worktree picker uses, so
// the two size columns mean the same thing. The verdict is "did it print a
// number": du exits non-zero on an unreadable subdirectory yet still prints a
// usable total.
func (JobScratch) Size(ctx context.Context, dir string) (int64, bool) {
	out, _ := exec.CommandContext(ctx, "du", "-sk", dir).Output()
	fields := strings.Fields(string(out))
	if len(fields) == 0 {
		return 0, false
	}
	kb, err := strconv.ParseInt(fields[0], 10, 64)
	if err != nil {
		return 0, false
	}
	return kb * 1024, true
}

// Reclaim deletes every entry in dir except the named files and reports how many
// bytes went. The directory itself always survives, so the job stays listed with
// its record intact. A single entry that refuses to go is returned as an error
// after the rest have been removed — one locked file must not strand the other
// twelve gigabytes.
func (JobScratch) Reclaim(dir string, keep []string) (int64, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	var freed int64
	var firstErr error
	for _, e := range entries {
		if slices.Contains(keep, e.Name()) {
			continue
		}
		path := filepath.Join(dir, e.Name())
		freed += treeBytes(path)
		if rerr := os.RemoveAll(path); rerr != nil && firstErr == nil {
			firstErr = rerr
		}
	}
	return freed, firstErr
}

// treeBytes sums the apparent sizes under path, so the reclaimed total can be
// reported. Measured before the removal, because after it there is nothing left
// to measure.
func treeBytes(path string) int64 {
	var total int64
	_ = filepath.WalkDir(path, func(_ string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if info, ierr := d.Info(); ierr == nil {
			total += info.Size()
		}
		return nil
	})
	return total
}
