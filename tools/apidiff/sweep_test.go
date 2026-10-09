package apidiff

import (
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"time"
)

// @scenario "Stale apidiff databases are swept, and nothing else"
func TestSweepSelectsOnlyStaleApidiffDatabasesOfNoLiveRun(t *testing.T) {
	now := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	old, fresh := now.Add(-72*time.Hour), now.Add(-time.Hour)
	candidates := []sweepCandidate{
		{"apidiff_old_branch", old},
		{"apidiff_old_main", old},
		{"apidiff_fresh_branch", fresh},
		{"apidiff_live_main", old},
		{"apidiff_current_branch", old},
		{"apidiff_admin", old},
		{"lw_someslug", old},
		{"postgres", old},
		{"apidiff_bad-name_main", old},
	}
	live := map[string]bool{"live": true, "current": true}
	got := selectStaleDatabases(staleSelection{candidates: candidates, now: now, maxAge: 48 * time.Hour, liveRuns: live})
	if want := []string{"apidiff_old_branch", "apidiff_old_main"}; !slices.Equal(got, want) {
		t.Fatalf("selected %v, want %v", got, want)
	}
}

// @scenario "A database owned by a running apidiff is never swept"
func TestLiveRunIDsReadsRunPIDFiles(t *testing.T) {
	root := t.TempDir()
	for run, pid := range map[string]string{"20261009-100000": "4242", "20261008-100000": "4343"} {
		dir := filepath.Join(toolDir(root), run)
		if err := os.MkdirAll(dir, 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, runPIDFile), []byte(pid+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	live := liveRunIDs(root, func(pid int) bool { return pid == 4242 })
	if len(live) != 1 || !live["20261009_100000"] {
		t.Fatalf("live runs = %v, want only 20261009_100000", live)
	}
}

// @scenario "Stale apidiff databases are swept, and nothing else"
func TestParseSweepCandidatesSkipsMalformedLines(t *testing.T) {
	got := parseSweepCandidates("apidiff_a_main|1760000000\nnoise\napidiff_b_main|x\n")
	if len(got) != 1 || got[0].name != "apidiff_a_main" || got[0].created.Unix() != 1760000000 {
		t.Fatalf("candidates = %v", got)
	}
}

// @scenario "Stale apidiff databases are swept, and nothing else"
func TestSweepSelectsClickHouseDatabasesByTheSameRules(t *testing.T) {
	now := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	old := now.Add(-72 * time.Hour)
	candidates := parseSweepCandidates("apidiff_old_main|" + strconv.FormatInt(old.Unix(), 10) + "\ndefault|" + strconv.FormatInt(old.Unix(), 10) + "\nlw_slug|" + strconv.FormatInt(old.Unix(), 10) + "\napidiff_live_branch|" + strconv.FormatInt(old.Unix(), 10) + "\napidiff_new_branch|" + strconv.FormatInt(now.Unix(), 10) + "\n")
	got := selectStaleDatabases(staleSelection{candidates: candidates, now: now, maxAge: 48 * time.Hour, liveRuns: map[string]bool{"live": true}})
	if want := []string{"apidiff_old_main"}; !slices.Equal(got, want) {
		t.Fatalf("selected %v, want %v", got, want)
	}
}

func TestClickHouseServerResolutionOrder(t *testing.T) {
	if got := clickHouseServerOf("http://u:p@127.0.0.1:58123/lw_x?a=b"); got != "http://u:p@127.0.0.1:58123" {
		t.Fatalf("database path must be dropped, got %q", got)
	}
	if clickHouseServerOf("") != "" || clickHouseServerOf("not a url") != "" {
		t.Fatal("an unusable URL names no server")
	}
	if got := resolveClickHouseServer("http://flag", "http://haven"); got != "http://flag" {
		t.Fatalf("explicit wins, got %q", got)
	}
	if got := resolveClickHouseServer("", "http://haven"); got != "http://haven" {
		t.Fatalf("haven beats the constant, got %q", got)
	}
	if got := resolveClickHouseServer("", ""); got != hostClickHouseURL {
		t.Fatalf("fallback is the constant, got %q", got)
	}
}
