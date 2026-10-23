package backup

import (
	"regexp"
	"strings"
	"testing"
	"time"
)

// @scenario "The bandwidth cap reaches the BACKUP statement"
func TestBackupSQL(t *testing.T) {
	got, err := BackupSQL("langwatch", "langwatch_incremental_20261023T123000Z", "full-20261023_050000/", 104857600)
	if err != nil {
		t.Fatal(err)
	}
	want := "BACKUP DATABASE `langwatch` TO Disk('backups', 'langwatch_incremental_20261023T123000Z') " +
		"SETTINGS id = 'langwatch_incremental_20261023T123000Z', base_backup = Disk('backups', 'full-20261023_050000/'), max_backup_bandwidth = 104857600 ASYNC"
	if got != want {
		t.Errorf("got  %s\nwant %s", got, want)
	}
	got, _ = BackupSQL("langwatch", "langwatch_full_20261023T050000Z", "", 0)
	if strings.Contains(got, "max_backup_bandwidth") || strings.Contains(got, "base_backup") {
		t.Errorf("a full without a cap: %s", got)
	}
	if _, err := BackupSQL("langwatch", "x", "", -1); err == nil {
		t.Error("a negative cap was accepted")
	}
}

// @scenario "Names and identifiers are validated and quoted before they reach SQL"
func TestSQLRefusesAndQuotes(t *testing.T) {
	for _, db := range []string{"lang watch", "a`b", "x;DROP", "", "db.table"} {
		if _, err := BackupSQL(db, "p", "", 0); err == nil {
			t.Errorf("database %q accepted", db)
		}
	}
	for _, p := range []string{"../etc", "a'b", "a\\b", "/abs", "", "x y", "a/../b"} {
		if _, err := BackupSQL("langwatch", p, "", 0); err == nil {
			t.Errorf("path %q accepted", p)
		}
		if _, err := RestoreSQL("langwatch", p, "id"); err == nil {
			t.Errorf("restore path %q accepted", p)
		}
	}
	if got := quoteString(`it's \ here`); got != `'it\'s \\ here'` {
		t.Errorf("quoteString = %s", got)
	}
	if got := quoteIdent("a`b"); got != "`a\\`b`" {
		t.Errorf("quoteIdent = %s", got)
	}
	got, _ := RestoreSQL("langwatch", "full-20261023_050000/", "restore_x")
	if got != "RESTORE DATABASE `langwatch` FROM Disk('backups', 'full-20261023_050000/') SETTINGS id = 'restore_x', allow_non_empty_tables = true ASYNC" {
		t.Errorf("restore: %s", got)
	}
	// The cluster name is a quoted literal, never spliced as an identifier.
	q := Tables{Cluster: "lang'watch"}.InFlightSQL()
	if !strings.Contains(q, `clusterAllReplicas('lang\'watch', system.backups)`) {
		t.Errorf("cluster not quoted: %s", q)
	}
}

// @scenario "The base is looked up in the persistent backup_log, on every replica"
func TestLookupsReadBackupLogAcrossReplicas(t *testing.T) {
	since := time.Unix(1_800_000_000, 0)
	local := Tables{}.CreatedSQL("langwatch", since)
	if !strings.Contains(local, "FROM system.backup_log ") || strings.Contains(local, "system.backups ") || strings.Contains(local, "skip_unavailable") {
		t.Errorf("local lookup: %s", local)
	}
	cluster := Tables{Cluster: "langwatch"}
	for _, q := range []string{cluster.CreatedSQL("langwatch", since), cluster.SummarySQL("langwatch", Full)} {
		if !strings.Contains(q, "FROM clusterAllReplicas('langwatch', system.backup_log)") || !strings.HasSuffix(q, "SETTINGS skip_unavailable_shards = 1") {
			t.Errorf("cluster lookup: %s", q)
		}
		if !strings.Contains(q, "status = 'BACKUP_CREATED'") {
			t.Errorf("lookup not limited to completed backups: %s", q)
		}
	}
	if !strings.Contains(local, "event_time >= toDateTime(1800000000)") {
		t.Errorf("lookback missing: %s", local)
	}
	if q := cluster.InFlightSQL(); !strings.Contains(q, "clusterAllReplicas('langwatch', system.backups)") {
		t.Errorf("in-flight check is not cluster-wide: %s", q)
	}
}

// The SQL regexp and Classify must agree, or a full ClickHouse counts would
// be invisible to the decision (or the reverse).
func TestNameRegexpMatchesClassify(t *testing.T) {
	names := map[string]Mode{
		"Disk('backups', 'langwatch_full_20261023T050000Z')":        Full,
		"Disk('backups', 'langwatch_incremental_20261023T053000Z')": Incremental,
		"Disk('backups', 'full-20261023_050000/')":                  Full,
		"Disk('backups', 'incremental-20261023_053000/')":           Incremental,
		"Disk('backups', 'other_full_20261023T050000Z')":            "",
		"Disk('backups_dr', 'langwatch_full_20261023T050000Z')":     "",
		"Disk('backups', 'langwatch_full_20261023T050000Z.zip')":    "",
		"S3('https://x/langwatch_full_20261023T050000Z', 'k', 's')": "",
	}
	for name, want := range names {
		_, got, ok := Classify("langwatch", name)
		if (want == "") == ok || got != want {
			t.Errorf("Classify(%s) = %q %v, want %q", name, got, ok, want)
		}
		for _, mode := range Modes {
			// ClickHouse match() is re2, as is Go's regexp.
			if m := regexp.MustCompile(nameRegexp("langwatch", mode)).MatchString(name); m != (want == mode) {
				t.Errorf("nameRegexp(%s) on %s = %v", mode, name, m)
			}
		}
	}
}

func TestNewPathKeepsTheScriptsFormat(t *testing.T) {
	if got := NewPath("e2e", Full, time.Date(2025, 1, 2, 3, 4, 5, 0, time.FixedZone("x", 3600))); got != "e2e_full_20250102T020405Z" {
		t.Errorf("NewPath = %s", got)
	}
}
