package cell

import (
	"strconv"
	"testing"

	"github.com/langwatch/langwatch/tools/upgradelab/seed"
)

func resultOf(verdicts []Verdict, id string) string {
	for _, verdict := range verdicts {
		if verdict.ID == id {
			return verdict.Result
		}
	}
	return "absent"
}

// @scenario "The guide rows fail when a guide command failed or deviated, or compose needed a step the guide omits"
func TestGuideRowsFailOnAFailedDeviatedOrOmittedStep(t *testing.T) {
	clean := []TranscriptStep{{Phase: "upgrade", Doc: "docker compose pull", Command: "docker compose pull"}}
	if got := resultOf(JudgeSelfHosted(SelfHostedRun{Path: "compose", Transcript: clean}), "U2"); got != "pass" {
		t.Errorf("clean U2 = %s", got)
	}
	failed := []TranscriptStep{{Phase: "upgrade", Doc: "docker compose up -d", Exit: 1}}
	if got := resultOf(JudgeSelfHosted(SelfHostedRun{Path: "compose", Transcript: failed}), "U2"); got != "fail" {
		t.Errorf("failed U2 = %s", got)
	}
	deviated := []TranscriptStep{{Phase: "upgrade", Doc: "helm repo update", Deviation: "not run"}}
	if got := resultOf(JudgeSelfHosted(SelfHostedRun{Path: "helm", Transcript: deviated}), "U2"); got != "fail" {
		t.Errorf("deviated U2 = %s", got)
	}
	omitted := []TranscriptStep{clean[0], {Phase: "upgrade", Command: "docker compose run workers migrate"}}
	if got := resultOf(JudgeSelfHosted(SelfHostedRun{Path: "compose", Transcript: omitted}), "U5"); got != "fail" {
		t.Errorf("omitted U5 = %s", got)
	}
}

// @scenario "U6 fails when the probe found the api down during helm upgrade"
func TestU6FailsWhenTheProbeFoundTheAPIDown(t *testing.T) {
	rolled := []PhaseChange{{"ready", 0}}
	if got := resultOf(JudgeSelfHosted(SelfHostedRun{Path: "helm", Phases: rolled}), "U6"); got != "pass" {
		t.Errorf("rolled U6 = %s", got)
	}
	if got := resultOf(JudgeSelfHosted(SelfHostedRun{Path: "helm", Phases: append(rolled, PhaseChange{"down", 900})}), "U6"); got != "fail" {
		t.Errorf("down U6 = %s", got)
	}
	if got := resultOf(JudgeSelfHosted(SelfHostedRun{Path: "compose", Phases: rolled}), "U6"); got != "absent" {
		t.Errorf("compose judged U6: %s", got)
	}
}

// @scenario "E5 passes only when the settled Ops > Upgrades page shows an upgrade state"
func TestE5NeedsAnUpgradeStateOnTheSettledPanel(t *testing.T) {
	shot := func(state string) []Shot {
		return []Shot{{Phase: "settled", File: "shots/settled-upgrades.png", State: state}}
	}
	for state, want := range map[string]string{"Up to date": "pass", "Access Restricted": "fail"} {
		if got := resultOf(JudgeSelfHosted(SelfHostedRun{Shots: shot(state)}), "E5"); got != want {
			t.Errorf("E5 on %q = %s, want %s", state, got, want)
		}
	}
	if got := resultOf(JudgeSelfHosted(SelfHostedRun{}), "E5"); got != "fail" {
		t.Errorf("E5 with no shot = %s", got)
	}
}

// @scenario "The ADMIN_EMAILS-unset variant boots with no ADMIN_EMAILS at all"
func TestNoAdminVariantHoldsNoAdminEmails(t *testing.T) {
	profile := Profiles["self-hosted-free"]
	profile.NoAdminEmails = true
	unset, err := OperatorEnv(profile, "http://localhost:1", "seed@x.test")
	if err != nil {
		t.Fatal(err)
	}
	if value, ok := unset["ADMIN_EMAILS"]; ok {
		t.Errorf("no-admin variant holds ADMIN_EMAILS=%q", value)
	}
	set, _ := OperatorEnv(Profiles["self-hosted-free"], "http://localhost:1", "seed@x.test")
	if set["ADMIN_EMAILS"] != "admin@snapshot.test,seed@x.test" {
		t.Errorf("free variant ADMIN_EMAILS=%q", set["ADMIN_EMAILS"])
	}
}

// @scenario "E1 fails when the licence copy step is missing or a licensed organisation lost its key"
func TestE1NeedsTheCopyStepAndEveryKey(t *testing.T) {
	ledger := []LedgerRow{{ID: "licensing:copy-organization-licenses", Status: "done"}}
	cases := []struct {
		ledger []LedgerRow
		lost   int
		want   string
	}{{ledger, 0, "pass"}, {ledger, 2, "fail"}, {nil, 0, "fail"}, {ledger, -1, "inconclusive"}}
	for _, each := range cases {
		if got := resultOf(JudgeSelfHosted(SelfHostedRun{Licensed: true, Ledger: each.ledger, LicenseLost: each.lost}), "E1"); got != each.want {
			t.Errorf("E1 ledger %v lost %d = %s, want %s", each.ledger, each.lost, got, each.want)
		}
	}
	if got := resultOf(JudgeSelfHosted(SelfHostedRun{}), "E1"); got != "absent" {
		t.Errorf("free shape judged E1: %s", got)
	}
}

// @scenario "A tier M cell carries its tier in its name, its stores and its cache key"
func TestTierMCellNamesCarryTheTier(t *testing.T) {
	options, err := parse([]string{"-tier", "M", "-release", "main@e683dd9ea5", "-run-dir", t.TempDir(), "-no-admin-emails"})
	if err != nil {
		t.Fatal(err)
	}
	if got := options.Name(); got != "cloud_m_typical_1" {
		t.Errorf("Name() = %q, want cloud_m_typical_1", got)
	}
	if !options.NoAdminEmails {
		t.Error("-no-admin-emails did not set Options.NoAdminEmails")
	}
	if !contains(Tiers, "M") {
		t.Errorf("Tiers %v lacks M", Tiers)
	}
	small := Options{Deployment: "cloud", Tier: "S", Shape: "typical", Seed: 1, Release: "main@e683dd9ea5"}
	if got, want := CacheKey(small), "cloud-S-typical-seed1-main-e683dd9ea5-r"+strconv.Itoa(seed.RecipeVersion); got != want {
		t.Errorf("CacheKey = %q, want %q", got, want)
	}
}

// @scenario "The self-hosted rows are named and mapped to their scenarios in the report"
func TestSelfHostedRowsAreInTheReportTables(t *testing.T) {
	for _, id := range []string{"E1", "E2", "E3", "E4", "E5", "U1", "U2", "U3", "U4", "U5", "U6"} {
		if invariantNames[id] == "" || len(scenarioIDs[id]) != 1 || scenarioIDs[id][0] != id {
			t.Errorf("%s: name %q scenarios %v", id, invariantNames[id], scenarioIDs[id])
		}
	}
}
