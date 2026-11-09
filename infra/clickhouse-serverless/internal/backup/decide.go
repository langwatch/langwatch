package backup

import (
	"fmt"
	"sort"
	"time"
)

// Backup is one of db's backups as a system table reports it.
type Backup struct {
	ID     string
	Path   string // on the backups disk
	Mode   Mode
	Status string
	Error  string
	Start  time.Time
	End    time.Time
	Bytes  uint64
	Host   string
}

// State is what Decide reads, gathered from the system tables.
type State struct {
	// InFlight: db's CREATING_BACKUP entries in system.backups, every replica.
	InFlight []Backup
	// Created: db's BACKUP_CREATED entries in backup_log since the lookback.
	Created []Backup
	// FullsEver: db's BACKUP_CREATED fulls in backup_log, at any age.
	FullsEver int
}

// Policy is the configuration Decide applies.
type Policy struct {
	Database      string
	RetentionDays int // lifecycle expiry of the backups prefix
	StaleHours    int // older CREATING_BACKUP entries are orphans
}

// BaseMaxAge is how old a base may be: retention less a day of margin, at
// least 12h. A base the lifecycle rule has expired restores to nothing.
func (p Policy) BaseMaxAge() time.Duration {
	return max(time.Duration(p.RetentionDays*24-24)*time.Hour, 12*time.Hour)
}

// Action is what a run does.
type Action string

const (
	// Start a new backup at Decision.Path, chained on Decision.Base if set.
	Start Action = "start"
	// Adopt waits for the same-mode backup already in flight (sidecar only).
	Adopt Action = "adopt"
	// StandDown writes nothing and is not a failure.
	StandDown Action = "stand-down"
	// Fail writes nothing and is a failure.
	Fail Action = "fail"
)

// Decision is the outcome of Decide.
type Decision struct {
	Action Action
	Mode   Mode
	Path   string  // Start: the new backup
	Base   *Backup // Start, incremental: the backup it chains on
	Root   *Backup // Start, incremental: the full the chain roots in
	Adopt  *Backup // Adopt: the backup in flight
	Reason string
}

// Decide picks what a run of mode does at now. adopt is set by the sidecar,
// which waits for a same-mode backup in flight instead of failing on it.
//
// Only Start writes a backup and only Start or Adopt can succeed. The one
// StandDown that follows an attempt to back up is an incremental yielding
// to a full in flight: the full covers it and reports its own result.
func Decide(mode Mode, st State, p Policy, now time.Time, adopt bool) Decision {
	d := Decision{Mode: mode}

	// Entries stay CREATING_BACKUP forever when a server dies mid-backup, so
	// only recent ones are live; an unbounded check lets one orphan wedge
	// every later run.
	var live []Backup
	for _, b := range st.InFlight {
		if b.Start.After(now.Add(-time.Duration(p.StaleHours) * time.Hour)) {
			live = append(live, b)
		}
	}
	sort.Slice(live, func(i, j int) bool { return live[i].Start.After(live[j].Start) })

	// Only a backup of the same mode blocks this one: a full runs for
	// longer than the incremental interval, so the two overlap routinely.
	for _, b := range live {
		if b.Mode == mode {
			b := b
			if adopt {
				d.Action, d.Adopt = Adopt, &b
				d.Reason = fmt.Sprintf("a %s backup is already in flight (%s on %s); waiting for it instead of starting a second", mode, b.Path, b.Host)
				return d
			}
			d.Action = Fail
			d.Reason = fmt.Sprintf("a %s backup is already in flight (%s on %s), refusing to start a second one", mode, b.Path, b.Host)
			return d
		}
	}

	if mode == Full {
		d.Action, d.Path = Start, NewPath(p.Database, Full, now)
		return d
	}

	// An incremental never runs alongside a full; only it gives way.
	for _, b := range live {
		if b.Mode == Full {
			d.Action = StandDown
			d.Reason = fmt.Sprintf("a full backup is in flight (%s on %s); skipping this incremental, the next one chains on that full", b.Path, b.Host)
			return d
		}
	}

	maxAge := p.BaseMaxAge()
	var root *Backup
	for i := range st.Created {
		b := &st.Created[i]
		if b.Mode != Full || !b.End.After(now.Add(-maxAge)) {
			continue
		}
		if root == nil || b.End.After(root.End) {
			root = b
		}
	}
	if root == nil {
		if st.FullsEver > 0 {
			d.Action = Fail
			d.Reason = fmt.Sprintf("no full backup within %s to base this incremental on; the newest one has expired from the backups disk", maxAge)
			return d
		}
		d.Action = StandDown
		d.Reason = "no full backup has ever been created, nothing to base an incremental on yet"
		return d
	}

	// Chain on the newest backup since that full, not on the full: based on
	// the full, each incremental would carry every change since it. Only an
	// incremental started after the full ended chains back to it.
	base := root
	for i := range st.Created {
		b := &st.Created[i]
		if b.Mode == Incremental && !b.Start.Before(root.End) && b.End.After(base.End) {
			base = b
		}
	}
	d.Action, d.Path = Start, NewPath(p.Database, Incremental, now)
	d.Base, d.Root = base, root
	d.Reason = fmt.Sprintf("incremental from base %s (chain root %s)", base.Path, root.Path)
	return d
}
