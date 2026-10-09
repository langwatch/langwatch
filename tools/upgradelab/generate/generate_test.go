package generate

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/seed"
)

var anchor = time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)

func mustBuild(t *testing.T, shape, release string, seedValue int64) Plan {
	t.Helper()
	plan, err := Build(Request{Shape: shape, Release: release, Volume: "S", Seed: seedValue, Anchor: anchor})
	if err != nil {
		t.Fatal(err)
	}
	return plan
}

// @scenario "a plan names every door in order"
func TestPlanNamesEveryDoorInOrder(t *testing.T) {
	var names []string
	for _, step := range mustBuild(t, "sh-free", "3.20.1", 1).Steps {
		names = append(names, step.Name)
	}
	want := "stores-up,old-release-up,tenancy-sql,product-seeds,traffic,pause-worker,traffic-at-cut,capture"
	if got := strings.Join(names, ","); got != want {
		t.Fatalf("steps %s, want %s", got, want)
	}
}

// @scenario "one seed gives one logical plan"
func TestOneSeedGivesOneLogicalPlan(t *testing.T) {
	first, second := mustBuild(t, "saas", "main@abc1234", 7), mustBuild(t, "saas", "main@abc1234", 7)
	if first.Digest() != second.Digest() {
		t.Fatal("same seed, different digests")
	}
	if first.Digest() == mustBuild(t, "saas", "main@abc1234", 8).Digest() {
		t.Fatal("seed 8 gave seed 7's digest")
	}
}

// @scenario "tenancy ids come from the cell, kind and index"
func TestTenancyIDsAndTier(t *testing.T) {
	tenancy := mustBuild(t, "hybrid", "main@abc1234", 1).Tenancy
	if len(tenancy.Organizations) != 4 || len(tenancy.Teams) != 6 || len(tenancy.Projects) != 12 || len(tenancy.Users) != 40 {
		t.Fatalf("tier %d/%d/%d/%d", len(tenancy.Organizations), len(tenancy.Teams), len(tenancy.Projects), len(tenancy.Users))
	}
	pattern := regexp.MustCompile(`^snap_hybrid_(org|team|project|user)_\d+$`)
	states := map[string]bool{}
	check := func(id string, at time.Time) {
		if !pattern.MatchString(id) {
			t.Errorf("id %s", id)
		}
		if at.Before(anchor.AddDate(0, -1, 0)) || !at.Before(anchor.AddDate(0, 1, 0)) {
			t.Errorf("%s at %s outside the window", id, at)
		}
	}
	for _, org := range tenancy.Organizations {
		check(org.ID, org.CreatedAt)
	}
	for _, team := range tenancy.Teams {
		check(team.ID, team.CreatedAt)
	}
	for _, project := range tenancy.Projects {
		check(project.ID, project.CreatedAt)
	}
	for _, user := range tenancy.Users {
		check(user.ID, user.CreatedAt)
		states[user.State] = true
	}
	if len(states) != 4 {
		t.Fatalf("user states %v", states)
	}
}

// @scenario "the saas shapes seed active subscriptions by SQL"
func TestSaasSeedsSubscriptions(t *testing.T) {
	sql := mustBuild(t, "saas", "main@abc1234", 1).TenancyS
	if got := strings.Count(sql, `INSERT INTO "Subscription"`); got != 3 || !strings.Contains(sql, "'ACTIVE'") || strings.Contains(sql, "stripeSubscriptionId") {
		t.Fatalf("subscriptions %d in\n%s", got, sql)
	}
	if strings.Contains(mustBuild(t, "sh-licensed", "3.20.1", 1).TenancyS, "Subscription") {
		t.Fatal("self-hosted wrote a subscription")
	}
}

// @scenario "the hybrid shape routes one organization to a private ClickHouse and S3"
func TestHybridRoutesPrivateOrganization(t *testing.T) {
	env, err := seed.LoadShapeEnv("hybrid")
	if err != nil {
		t.Fatal(err)
	}
	private := mustBuild(t, "hybrid", "main@abc1234", 1).Tenancy.Organizations[3].ID
	for _, key := range []string{"CLICKHOUSE_URL__snap__" + private, "DATAPLANE_S3__snap__" + private} {
		if _, ok := env.Secrets[key]; !ok {
			t.Errorf("hybrid env misses %s", key)
		}
	}
}

// @scenario "shape env files hold test values and name their secrets"
func TestShapeEnvNamesSecrets(t *testing.T) {
	for _, shape := range seed.Shapes {
		env, err := seed.LoadShapeEnv(shape)
		if err != nil {
			t.Fatal(err)
		}
		for key, value := range env.Values {
			if strings.Contains(key, "SECRET") || strings.HasPrefix(value, "sk-") {
				t.Errorf("%s: %s is a manifest value", shape, key)
			}
		}
		if len(env.SecretNames) == 0 {
			t.Errorf("%s names no secrets", shape)
		}
	}
}

// @scenario "every declared migration step is covered"
func TestEveryDeclaredStepIsCovered(t *testing.T) {
	coverage, err := seed.LoadCoverage()
	if err != nil {
		t.Fatal(err)
	}
	declared := regexp.MustCompile(`define(?:MigrationStep|ProjectionReplayStep)\(\{\s*id: "([^"]+)"`)
	found := 0
	for _, glob := range []string{"../../../modules/*/process/src/*.module.ts", "../../../enterprise/modules/*/process/src/*.module.ts"} {
		paths, _ := filepath.Glob(glob)
		for _, path := range paths {
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			for _, match := range declared.FindAllStringSubmatch(string(data), -1) {
				found++
				entry, ok := coverage.Steps[match[1]]
				if !ok || (entry.Status != "unheld" && entry.Seed == "") || (entry.Status == "unheld" && entry.Note == "") {
					t.Errorf("%s (%s): no seed and no reason in coverage.json", match[1], path)
				}
			}
		}
	}
	if found < 15 {
		t.Fatalf("found %d declared steps; the declaration pattern drifted", found)
	}
}

// @scenario "an unknown shape is refused"
// @scenario "a release below the floor is refused"
// @scenario "a saas shape from a release tag is refused"
// @scenario "a self-hosted shape from main is refused"
// @scenario "volumes other than S are refused here"
func TestRefusals(t *testing.T) {
	cases := []struct{ scenario, shape, release, volume, want string }{
		{"an unknown shape is refused", "cloud", "3.20.1", "S", "sh-free"},
		{"a release below the floor is refused", "sh-free", "3.19.4", "S", "floor 3.20.1"},
		{"a saas shape from a release tag is refused", "saas", "3.20.1", "S", "main@<sha>"},
		{"a self-hosted shape from main is refused", "sh-licensed", "main@abc1234", "S", "release tag"},
		{"volumes other than S are refused here", "sh-free", "3.20.1", "L", "scale generator"},
	}
	for _, c := range cases {
		_, err := Build(Request{Shape: c.shape, Release: c.release, Volume: c.volume, Seed: 1, Anchor: anchor})
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: got %v, want %q", c.scenario, err, c.want)
		}
	}
}

type fakeDoors struct {
	failAt string
	ran    []string
}

func (doors *fakeDoors) Run(_ context.Context, _ Plan, step Step) error {
	doors.ran = append(doors.ran, step.Name)
	if step.Name == doors.failAt {
		return errors.New("door refused")
	}
	return nil
}

// @scenario "a failing door stops the run and names the step"
func TestFailingDoorStopsTheRun(t *testing.T) {
	doors := &fakeDoors{failAt: "product-seeds"}
	err := Execute(context.Background(), mustBuild(t, "sh-free", "3.20.1", 1), doors)
	if err == nil || !strings.Contains(err.Error(), "product-seeds") {
		t.Fatalf("error %v", err)
	}
	if doors.ran[len(doors.ran)-1] != "product-seeds" {
		t.Fatalf("ran past the failure: %v", doors.ran)
	}
}
