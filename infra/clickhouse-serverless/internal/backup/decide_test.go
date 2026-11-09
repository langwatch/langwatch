package backup

import (
	"strings"
	"testing"
	"time"
)

var now = time.Date(2026, 10, 23, 12, 30, 0, 0, time.UTC)

var policy = Policy{Database: "langwatch", RetentionDays: 7, StaleHours: 3}

func ago(d time.Duration) time.Time { return now.Add(-d) }

func created(mode Mode, path string, start, end time.Time) Backup {
	return Backup{ID: path, Path: path, Mode: mode, Status: "BACKUP_CREATED", Start: start, End: end}
}

func inFlight(mode Mode, path string, start time.Time) Backup {
	return Backup{ID: path, Path: path, Mode: mode, Status: "CREATING_BACKUP", Start: start, Host: "ch-1"}
}

// @scenario "A same-mode backup in flight blocks the run"
func TestDecide_SameModeInFlightBlocks(t *testing.T) {
	for _, mode := range Modes {
		st := State{InFlight: []Backup{inFlight(mode, "langwatch_"+string(mode)+"_20261023T120000Z", ago(30*time.Minute))}}
		if d := Decide(mode, st, policy, now, false); d.Action != Fail || !strings.Contains(d.Reason, "already in flight") {
			t.Errorf("%s with a %s in flight: %+v, want a failure", mode, mode, d)
		}
	}
}

// @scenario "An incremental gives way to a full in flight, and a full never gives way"
func TestDecide_FullAndIncrementalOverlap(t *testing.T) {
	full := inFlight(Full, "langwatch_full_20261023T050000Z", ago(80*time.Minute))
	inc := inFlight(Incremental, "langwatch_incremental_20261023T123000Z", ago(time.Minute))
	history := []Backup{created(Full, "langwatch_full_20261020T050000Z", ago(80*time.Hour), ago(79*time.Hour))}

	d := Decide(Incremental, State{InFlight: []Backup{full}, Created: history, FullsEver: 1}, policy, now, false)
	if d.Action != StandDown {
		t.Errorf("incremental with a full in flight: %+v, want stand-down", d)
	}
	d = Decide(Full, State{InFlight: []Backup{inc}, Created: history, FullsEver: 1}, policy, now, false)
	if d.Action != Start || d.Path != "langwatch_full_20261023T123000Z" {
		t.Errorf("full with an incremental in flight: %+v, want it to start", d)
	}
}

// @scenario "In-flight entries older than STALE_BACKUP_HOURS are orphans"
func TestDecide_StaleInFlightIsAnOrphan(t *testing.T) {
	orphanFull := inFlight(Full, "langwatch_full_20261022T050000Z", ago(3*time.Hour+time.Minute))
	st := State{
		InFlight:  []Backup{orphanFull, inFlight(Incremental, "langwatch_incremental_20261023T083000Z", ago(4*time.Hour))},
		Created:   []Backup{created(Full, "langwatch_full_20261021T050000Z", ago(55*time.Hour), ago(54*time.Hour))},
		FullsEver: 1,
	}
	if d := Decide(Full, st, policy, now, false); d.Action != Start {
		t.Errorf("full behind an orphaned full: %+v, want start", d)
	}
	if d := Decide(Incremental, st, policy, now, false); d.Action != Start {
		t.Errorf("incremental behind orphans: %+v, want start", d)
	}
}

// @scenario "A base older than retention less a day is never used"
func TestDecide_BaseMaxAge(t *testing.T) {
	for _, tc := range []struct {
		days int
		want time.Duration
	}{{7, 144 * time.Hour}, {2, 24 * time.Hour}, {1, 12 * time.Hour}} {
		if got := (Policy{RetentionDays: tc.days}).BaseMaxAge(); got != tc.want {
			t.Errorf("retention %dd: base max age %s, want %s", tc.days, got, tc.want)
		}
	}

	expired := created(Full, "langwatch_full_20261017T050000Z", ago(145*time.Hour), ago(144*time.Hour+time.Minute))
	newInc := created(Incremental, "langwatch_incremental_20261023T113000Z", ago(61*time.Minute), ago(60*time.Minute))
	d := Decide(Incremental, State{Created: []Backup{expired, newInc}, FullsEver: 4}, policy, now, false)
	if d.Action != Fail || !strings.Contains(d.Reason, "expired") {
		t.Errorf("only an expired full: %+v, want a failure naming expiry", d)
	}
}

// @scenario "An incremental with no full ever is a clean no-op"
func TestDecide_NoFullEver(t *testing.T) {
	d := Decide(Incremental, State{}, policy, now, false)
	if d.Action != StandDown || !strings.Contains(d.Reason, "ever been created") {
		t.Errorf("no full ever: %+v, want a stand-down", d)
	}
}

// @scenario "Each incremental chains on the newest backup since the newest valid full"
func TestDecide_ChainsOnTheNewestSinceTheFull(t *testing.T) {
	oldFull := created(Full, "langwatch_full_20261020T050000Z", ago(79*time.Hour), ago(78*time.Hour))
	oldInc := created(Incremental, "langwatch_incremental_20261020T073000Z", ago(77*time.Hour), ago(77*time.Hour-time.Minute))
	full := created(Full, "full-20261023_050000/", ago(7*time.Hour+30*time.Minute), ago(6*time.Hour))
	// Started while the full ran, so its chain roots in the older full.
	overlapping := created(Incremental, "langwatch_incremental_20261023T053000Z", ago(7*time.Hour), ago(5*time.Hour))
	inc1 := created(Incremental, "langwatch_incremental_20261023T103000Z", ago(2*time.Hour), ago(2*time.Hour-time.Minute))
	inc2 := created(Incremental, "langwatch_incremental_20261023T113000Z", ago(time.Hour), ago(time.Hour-time.Minute))

	t.Run("no incremental yet: the full itself", func(t *testing.T) {
		d := Decide(Incremental, State{Created: []Backup{oldFull, oldInc, full, overlapping}, FullsEver: 2}, policy, now, false)
		if d.Action != Start || d.Base.Path != full.Path || d.Root.Path != full.Path {
			t.Errorf("%+v, want base and root %s", d, full.Path)
		}
	})
	t.Run("the newest incremental after the full", func(t *testing.T) {
		d := Decide(Incremental, State{Created: []Backup{inc2, oldFull, oldInc, full, overlapping, inc1}, FullsEver: 2}, policy, now, false)
		if d.Action != Start || d.Base.Path != inc2.Path || d.Root.Path != full.Path {
			t.Errorf("%+v, want base %s rooted in %s", d, inc2.Path, full.Path)
		}
		if d.Path != "langwatch_incremental_20261023T123000Z" {
			t.Errorf("path %s", d.Path)
		}
	})
}

// @scenario "The sidecar adopts a backup in flight instead of starting a second"
func TestDecide_AdoptInFlight(t *testing.T) {
	b := inFlight(Full, "langwatch_full_20261023T120000Z", ago(30*time.Minute))
	d := Decide(Full, State{InFlight: []Backup{b}}, policy, now, true)
	if d.Action != Adopt || d.Adopt.ID != b.ID {
		t.Errorf("%+v, want it to adopt %s", d, b.ID)
	}
}
