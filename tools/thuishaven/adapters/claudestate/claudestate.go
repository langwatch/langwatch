// Package claudestate implements app.ClaudeState over the directories Claude
// Code keeps under its home. It answers three things about a directory — how
// big it is, how much of that has sat untouched, and when anything in it was
// last written — and it removes nothing: this is the reading half of a report
// whose whole point is that transcripts are a record rather than scratch.
package claudestate

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Reader is the filesystem-backed implementation of app.ClaudeState.
type Reader struct{}

// New returns a Reader.
func New() Reader { return Reader{} }

// Read returns one location's records: a directory per child for the per-entry
// locations, and a single record for the rest. A location that does not exist
// is not an error — Claude writes each directory the first time it needs one,
// so a missing name simply has nothing to report.
func (r Reader) Read(ctx context.Context, scan domain.ClaudeScan) ([]domain.ClaudeStateRecord, error) {
	if !scan.Loc.PerEntry {
		return r.whole(ctx, scan), nil
	}
	return r.perEntry(ctx, scan.Dir(), scan.ColdBefore)
}

// whole measures a location as one record, named for the location itself.
func (r Reader) whole(ctx context.Context, scan domain.ClaudeScan) []domain.ClaudeStateRecord {
	rec, ok := r.Stat(ctx, scan.Dir(), scan.ColdBefore)
	if !ok {
		return nil
	}
	rec.Name = scan.Loc.Name
	return []domain.ClaudeStateRecord{rec}
}

// perEntry measures each child of a location as its own record, which is what
// keeps a per-project directory's weight attached to the project it came from.
func (r Reader) perEntry(ctx context.Context, dir string, coldBefore time.Time) ([]domain.ClaudeStateRecord, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []domain.ClaudeStateRecord
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if rec, ok := r.Stat(ctx, filepath.Join(dir, e.Name()), coldBefore); ok {
			rec.Name = e.Name()
			out = append(out, rec)
		}
	}
	return out, nil
}

// Stat walks one directory for its size, the share of it older than coldBefore,
// and its newest write. The cold share has to be summed per file: the directory
// a machine appends to every day is exactly the one whose bytes are mostly a
// year old, and its own mtime would report the whole tree as current. Walk
// errors are skipped — a file that vanished mid-walk says nothing about the
// directory's weight — and a canceled context stops the walk where it is.
func (Reader) Stat(ctx context.Context, dir string, coldBefore time.Time) (domain.ClaudeStateRecord, bool) {
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return domain.ClaudeStateRecord{}, false
	}
	rec := domain.ClaudeStateRecord{Dir: dir, Name: filepath.Base(dir)}
	_ = filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if ctx.Err() != nil {
			return filepath.SkipAll
		}
		if err != nil {
			return nil //nolint:nilerr // a file that vanished mid-walk says nothing about the directory's weight
		}
		if d.IsDir() {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil //nolint:nilerr // same: an unreadable entry is skipped, not fatal
		}
		rec.Add(info.Size(), info.ModTime(), coldBefore)
		return nil
	})
	return rec, true
}
