package cell

import (
	"testing"

	"github.com/langwatch/langwatch/tools/upgradelab/snapshot"
)

func TestBlockingStartedNamesTheStep(t *testing.T) {
	line := `{"msg":"blocking step ops:copy-automation-migration-state started (from the start): Carries"}`
	match := blockingStarted.FindStringSubmatch(line)
	if len(match) < 2 || match[1] != "ops:copy-automation-migration-state" {
		t.Fatalf("got %v", match)
	}
	if blockingStarted.MatchString(`{"msg":"blocking step ops:x done in 76 ms"}`) {
		t.Fatal("a done line is not a start")
	}
}

func TestCompareUpgradedIgnoresTheLedgerAndRedis(t *testing.T) {
	a := upgraded{fingerprint: withoutLedger(snapshot.Fingerprint{
		"postgres": {"mydb.Project": {Count: 2, Hash: "a"}, "mydb._prisma_migrations": {Count: 3, Hash: "p"}, "mydb_upgrade_ledger._langwatch_upgrade_run": {Count: 2, Hash: "x"}},
		"redis":    {"keys": {Count: 1, Hash: "r"}},
	}), steps: map[string]string{"s1": "done"}}
	b := upgraded{fingerprint: withoutLedger(snapshot.Fingerprint{
		"postgres": {"mydb.Project": {Count: 2, Hash: "a"}, "mydb._prisma_migrations": {Count: 3, Hash: "q"}, "mydb_upgrade_ledger._langwatch_upgrade_run": {Count: 1, Hash: "y"}},
		"redis":    {"keys": {Count: 3, Hash: "q"}},
	}), steps: map[string]string{"s1": "done"}}
	if diffs := compareUpgraded(a, b); len(diffs) != 0 {
		t.Fatalf("want equal, got %v", diffs)
	}
	b.steps["s1"], b.steps["s2"] = "failed", "done"
	if diffs := compareUpgraded(a, b); len(diffs) != 2 {
		t.Fatalf("want two differences, got %v", diffs)
	}
}

func TestAlterTableNamesTheTable(t *testing.T) {
	match := alterTable.FindStringSubmatch("-- x\nALTER TABLE \"Project\" ADD COLUMN \"y\" TEXT;")
	if len(match) < 2 || match[1] != "Project" {
		t.Fatalf("got %v", match)
	}
}

func TestBlockingLeftSkipsBackgroundSteps(t *testing.T) {
	rows := []LedgerRow{{ID: "a", Mode: "blocking", Status: "done"}, {ID: "b", Mode: "background", Status: "pending"}, {ID: "c", Mode: "blocking", Status: "failed"}}
	if left := blockingLeft(rows); len(left) != 1 || left[0].ID != "c" {
		t.Fatalf("got %v", left)
	}
}

func TestConsoleFrontsAllButHealth(t *testing.T) {
	good := []string{"/healthz 200 console=false", "/readyz 503 console=false", "/ 503 console=true", "/api/x 503 console=true"}
	if !consoleFrontsAllButHealth(good) {
		t.Fatal("want fronted")
	}
	if consoleFrontsAllButHealth([]string{"/healthz 200 console=false", "/ 200 console=false"}) {
		t.Fatal("a route without the console is not fronted")
	}
	if consoleFrontsAllButHealth([]string{"/healthz 503 console=true", "/ 503 console=true"}) {
		t.Fatal("health behind the console is a failure")
	}
	if consoleFrontsAllButHealth([]string{"/healthz 200 console=false", "/readyz 200 console=false", "/ 503 console=true"}) {
		t.Fatal("a failed install answering ready is a failure")
	}
}
