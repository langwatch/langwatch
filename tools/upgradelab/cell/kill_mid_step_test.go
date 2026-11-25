package cell

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/snapshot"
)

func TestParseStepRowReadsStatusAndCheckpoint(t *testing.T) {
	row := parseStepRow(`running|{"afterUserId": "gap1user0001000", "users": 1000}` + "\n")
	if row.status != "running" || row.cursor("afterUserId") != "gap1user0001000" || row.count("users") != 1000 {
		t.Fatalf("row %+v", row)
	}
	if empty := parseStepRow("pending|"); empty.status != "pending" || empty.cursor("afterUserId") != "" {
		t.Fatalf("empty %+v", empty)
	}
}

func TestKillMayLandOnlyMidStepWithACheckpoint(t *testing.T) {
	cases := map[string]bool{"running|{\"afterUserId\":\"a\"}": true, "running|": false, "done|{\"afterUserId\":\"a\"}": false, "pending|{\"afterUserId\":\"a\"}": false}
	for raw, want := range cases {
		if got := killMayLand(parseStepRow(raw), "afterUserId"); got != want {
			t.Fatalf("%s: got %t", raw, got)
		}
	}
}

var killedAt = time.Date(2026, 10, 12, 2, 45, 0, 0, time.UTC)

func deadWorker() deathProof {
	return deathProof{killedAt: killedAt, killed: []int{100, 101, 102}, loggedPids: []int{102}}
}

// midStepFixture is a drilled run killed at atKill whose restarted worker first saved firstAfter.
func midStepFixture(atKill, firstAfter string) (midStepRun, midStepRun) {
	state := upgraded{fingerprint: snapshot.Fingerprint{"postgres": {"User": {Count: 40010, Hash: "a"}, "ProcessManagerOutbox": {Count: 126}}}, steps: map[string]string{"user:record-created-facts": "done"}}
	cleanState := upgraded{fingerprint: snapshot.Fingerprint{"postgres": {"User": {Count: 40010, Hash: "b"}, "ProcessManagerOutbox": {Count: 230}}}, steps: map[string]string{"user:record-created-facts": "done"}}
	drilled := midStepRun{
		kill:  killMoment{at: parseStepRow(atKill), after: parseStepRow(atKill), firstAfter: parseStepRow(firstAfter), death: deadWorker()},
		final: parseStepRow(`done|{"users": 40010}`),
		facts: "40010\t40010\t123", state: state,
	}
	clean := midStepRun{final: parseStepRow(`done|{"users": 40010}`), facts: "40010\t40010\t123", state: cleanState}
	return drilled, clean
}

const (
	killedAtPage20 = `running|{"afterUserId":"gap1user0010000","users":10000}`
	resumedPage21  = `running|{"afterUserId":"gap1user0010500","users":10500}`
)

func TestMidStepVerdictPassesAResumeFromTheCheckpoint(t *testing.T) {
	drilled, clean := midStepFixture(killedAtPage20, resumedPage21)
	if got := midStepVerdict(defaultMidStep, drilled, clean); got.Result != "pass" {
		t.Fatalf("want pass: %s", got.Detail)
	}
}

func TestMidStepVerdictFailsARestartFromZero(t *testing.T) {
	drilled, clean := midStepFixture(killedAtPage20, `running|{"afterUserId":"gap1user0000500","users":500}`)
	if got := midStepVerdict(defaultMidStep, drilled, clean); got.Result != "fail" {
		t.Fatalf("a rerun from the first page must fail: %s", got.Detail)
	}
}

func TestMidStepVerdictFailsAKillAfterTheStepFinished(t *testing.T) {
	drilled, clean := midStepFixture(`done|{"users":40010}`, `done|{"users":40010}`)
	if got := midStepVerdict(defaultMidStep, drilled, clean); got.Result != "fail" || !strings.Contains(got.Detail, `killed while "done"`) {
		t.Fatalf("a kill after done must fail: %s", got.Detail)
	}
}

func TestMidStepVerdictFailsAWorkerThatKeptRunning(t *testing.T) {
	drilled, clean := midStepFixture(killedAtPage20, resumedPage21)
	drilled.kill.death = deathProof{killedAt: killedAt, killed: []int{100}, loggedPids: []int{44114}, linesAfter: 41000}
	if got := midStepVerdict(defaultMidStep, drilled, clean); got.Result != "fail" || !strings.Contains(got.Detail, "worker died false") {
		t.Fatalf("a worker that logged after the kill must fail: %s", got.Detail)
	}
}

func TestMidStepVerdictFailsATotalShortOfTheCleanRun(t *testing.T) {
	drilled, clean := midStepFixture(killedAtPage20, resumedPage21)
	drilled.final = parseStepRow(`done|{"users": 0}`)
	if got := midStepVerdict(defaultMidStep, drilled, clean); got.Result != "fail" {
		t.Fatalf("a report total short of the clean run's must fail: %s", got.Detail)
	}
}

func TestSplitDiffsIgnoresWorkerTimedTables(t *testing.T) {
	postgres, other := splitDiffs([]string{"postgres/ProcessManagerOutbox: count 126 vs 230", "postgres/SystemMigrationTenantState: count 1 vs 2", "postgres/User: count 1 vs 2", "clickhouse/shared/event_log: count 1 vs 2"})
	if len(postgres) != 1 || !strings.HasPrefix(postgres[0], "postgres/User") || len(other) != 1 {
		t.Fatalf("postgres %v other %v", postgres, other)
	}
}

func TestDeathProofNeedsEveryLoggedPidKilledAndNoLaterLine(t *testing.T) {
	text := `{"level":"info","time":"2026-10-12T02:44:59.900Z","pid":102,"msg":"page"}
not json from pnpm
{"level":"info","time":"2026-10-12T02:52:28.491Z","pid":102,"msg":"graceful shutdown complete"}
`
	pids, after := readWorkerLog(text, killedAt)
	if !slices.Equal(pids, []int{102}) || after != 1 {
		t.Fatalf("pids %v after %d", pids, after)
	}
	proof := deadWorker()
	if !proof.died() {
		t.Fatalf("a killed worker with no later line died: %s", proof)
	}
	proof.linesAfter = after
	if proof.died() {
		t.Fatalf("a line after the kill must disprove the death: %s", proof)
	}
	if survived := (deathProof{killed: []int{100, 102}, survivors: []int{102}, loggedPids: []int{102}}); survived.died() {
		t.Fatalf("a surviving pid must disprove the death")
	}
	if unsignaled := (deathProof{killed: []int{100}, loggedPids: []int{102}}); unsignaled.died() {
		t.Fatalf("a logged pid that was never signaled must disprove the death")
	}
}

func TestPlantUsersSQLPlantsTheCount(t *testing.T) {
	if sql := plantUsersSQL(40000); !strings.Contains(sql, "generate_series(1, 40000)") || !strings.Contains(sql, `mydb."User"`) {
		t.Fatal(sql)
	}
}

func TestATaskDrillNamesItsOwnStores(t *testing.T) {
	cell := Options{Deployment: "cloud", Tier: "S", Shape: "typical", Seed: 21}
	drill := cell
	drill.TaskDrill = TaskDrillKillMidStep
	if cell.Name() != "cloud_s_typical_21" || drill.Name() != "cloud_s_typical_21_kill_mid_step" {
		t.Fatalf("cell %q drill %q", cell.Name(), drill.Name())
	}
}

// TestKillReachesAChildInAGroupOfItsOwn: pnpm starts node in a group of its own, so a signal to the
// leader's group alone leaves node running.
func TestKillReachesAChildInAGroupOfItsOwn(t *testing.T) {
	proc, err := Start(ProcSpec{Name: "kill-test", Dir: t.TempDir(), Log: filepath.Join(t.TempDir(), "kill.log"),
		Args: []string{"sh", "-c", `perl -e 'setpgrp(0, 0); sleep 60' & wait`}, Env: []string{"PATH=/usr/bin:/bin"}})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for len(proc.descendants()) == 0 && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	killed := proc.Kill()
	if len(killed) < 2 {
		t.Fatalf("want the leader and its child signaled, got %v", killed)
	}
	for len(alive(killed)) > 0 && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if survivors := alive(killed); len(survivors) > 0 {
		t.Fatalf("still running after SIGKILL: %v", survivors)
	}
}
