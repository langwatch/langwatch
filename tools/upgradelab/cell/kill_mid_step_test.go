package cell

import (
	"strings"
	"testing"

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

func midStepFixture(rerun int, atKill string) (midStepRun, midStepRun) {
	state := upgraded{fingerprint: snapshot.Fingerprint{"postgres": {"User": {Count: 40010, Hash: "a"}}}, steps: map[string]string{"user:record-created-facts": "done"}}
	cleanState := upgraded{fingerprint: snapshot.Fingerprint{"postgres": {"User": {Count: 40010, Hash: "b"}}}, steps: map[string]string{"user:record-created-facts": "done"}}
	drilled := midStepRun{
		kill:  killMoment{at: parseStepRow(atKill), after: parseStepRow(atKill)},
		final: parseStepRow(`done|{"users": ` + itoa(rerun) + `}`),
		facts: "40010\t40010\t123", state: state,
	}
	clean := midStepRun{final: parseStepRow(`done|{"users": 40010}`), facts: "40010\t40010\t123", state: cleanState}
	return drilled, clean
}

func TestMidStepVerdictPassesAResumeFromTheCheckpoint(t *testing.T) {
	drilled, clean := midStepFixture(30010, `running|{"afterUserId":"gap1user0010000","users":10000}`)
	if got := midStepVerdict(defaultMidStep, drilled, clean); got.Result != "pass" {
		t.Fatalf("want pass: %s", got.Detail)
	}
}

func TestMidStepVerdictFailsARestartFromZero(t *testing.T) {
	drilled, clean := midStepFixture(40010, `running|{"afterUserId":"gap1user0010000","users":10000}`)
	if got := midStepVerdict(defaultMidStep, drilled, clean); got.Result != "fail" {
		t.Fatalf("a rerun of every row must fail: %s", got.Detail)
	}
}

func TestMidStepVerdictFailsAKillAfterTheStepFinished(t *testing.T) {
	drilled, clean := midStepFixture(30010, `done|{"users":40010}`)
	if got := midStepVerdict(defaultMidStep, drilled, clean); got.Result != "fail" || !strings.Contains(got.Detail, `killed while "done"`) {
		t.Fatalf("a kill after done must fail: %s", got.Detail)
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
