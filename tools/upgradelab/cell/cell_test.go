package cell

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// @scenario "A cell refuses a store it does not own"
func TestCellRefusesAStoreItDoesNotOwn(t *testing.T) {
	for _, name := range []string{"lw_feat_strict_feature_layout_v0", "upgradelab_", "postgres"} {
		err := CheckDedicated(name)
		if err == nil || !strings.Contains(err.Error(), DedicatedPrefix) {
			t.Errorf("CheckDedicated(%q) = %v, want a refusal naming %s", name, err, DedicatedPrefix)
		}
	}
	if err := CheckDedicated("upgradelab_cloud_s_typical_1"); err != nil {
		t.Errorf("a dedicated name was refused: %v", err)
	}
}

// @scenario "A cell refuses a checkout that holds a .env"
func TestCellRefusesACheckoutHoldingADotenv(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := CheckSourceDir(dir); err != nil {
		t.Fatalf("a clean checkout was refused: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("X=1"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := CheckSourceDir(dir); err == nil || !strings.Contains(err.Error(), ".env") {
		t.Errorf("CheckSourceDir with a .env = %v, want a refusal naming .env", err)
	}
}

// @scenario "Every deployment profile routes to the cell's own stores"
func TestEveryProfileRoutesToTheCellsOwnStores(t *testing.T) {
	stores := Stores{PostgresBase: "postgresql://u:p@127.0.0.1:5432", ClickHouseBase: "http://d:p@127.0.0.1:8123", Name: "upgradelab_x", RedisPort: "7001", Private: []string{"snap"}}
	for name, profile := range Profiles {
		env, err := BuildEnv(EnvInput{Profile: profile, Stores: stores, APIPort: 7100, Admin: "seed+1@snapshot.test"})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		for key, value := range env {
			if strings.Contains(value, "clickhouse-private:") || strings.Contains(value, "storagesim:") {
				t.Errorf("%s: compose-network value survived in %s", name, key)
			}
		}
		if env["DATABASE_URL"] != stores.DatabaseURL() || env["CLICKHOUSE_URL"] != stores.ClickHouseURL("") || env["REDIS_URL"] != "redis://127.0.0.1:7001" {
			t.Errorf("%s: store URLs not the cell's: %s %s %s", name, env["DATABASE_URL"], env["CLICKHOUSE_URL"], env["REDIS_URL"])
		}
		if !strings.Contains(env["ADMIN_EMAILS"], "seed+1@snapshot.test") {
			t.Errorf("%s: the seed account is no platform operator: %q", name, env["ADMIN_EMAILS"])
		}
	}
	hybrid, _ := BuildEnv(EnvInput{Profile: Profiles["hybrid"], Stores: stores, APIPort: 7100})
	if got := hybrid["CLICKHOUSE_URL__snap__snap_hybrid_org_4"]; got != "http://d:p@127.0.0.1:8123/upgradelab_x_p_snap" {
		t.Errorf("hybrid private target = %q", got)
	}
	stores.S3 = map[string]int{"": 7201, "snap": 7202}
	hybrid, _ = BuildEnv(EnvInput{Profile: Profiles["hybrid"], Stores: stores, APIPort: 7100})
	if got := hybrid["DATAPLANE_S3__snap__snap_hybrid_org_4"]; !strings.Contains(got, `"endpoint":"http://127.0.0.1:7202"`) || hybrid["S3_ENDPOINT"] != "http://127.0.0.1:7201" {
		t.Errorf("hybrid object stores not the cell's: private %q shared %q", got, hybrid["S3_ENDPOINT"])
	}
}

// @scenario "Traffic is seeded and judged per kind and per api phase"
func TestTrafficIsSeededAndJudgedPerKindAndPhase(t *testing.T) {
	first, again, other := SeededID(1, "otlp-trace", 7), SeededID(1, "otlp-trace", 7), SeededID(2, "otlp-trace", 7)
	if first != again || first == other {
		t.Fatal("seeded ids are not a function of (seed, kind, n)")
	}
	timeline := []PhaseChange{{Phase: "down", AtMs: 100}, {Phase: "holding:schema", AtMs: 200}, {Phase: "ready", AtMs: 300}}
	calls := []Call{
		{Kind: "otlp-trace", AtMs: 50, Status: 200, Write: true, ID: "a"},
		{Kind: "otlp-trace", AtMs: 150, Status: 0, Write: true, ID: "b"},
		{Kind: "otlp-trace", AtMs: 250, Status: 503, Write: true, ID: "c"},
		{Kind: "otlp-trace", AtMs: 350, Status: 202, Write: true, ID: "d"},
	}
	summaries, phases := Summarize(calls, timeline, map[string]bool{"otlp-trace/a": true})
	got := summaries[0]
	if got.Sent != 4 || got.OK != 2 || got.Failed != 2 || got.Visible != 1 || got.Lost != 1 {
		t.Errorf("summary = %+v, want sent 4, ok 2, failed 2, visible 1, lost 1", got)
	}
	want := map[string]string{"main": "200", "down": "no-answer", "holding:schema": "503", "ready": "202"}
	for _, phase := range phases {
		if phase.Statuses[want[phase.Phase]] != 1 {
			t.Errorf("phase %s statuses %v, want one %s", phase.Phase, phase.Statuses, want[phase.Phase])
		}
	}
	if PhaseOf(0, "", false) != "down" || PhaseOf(200, "", true) != "ready" || PhaseOf(503, "Phase: <strong>upgrading</strong>", true) != "holding:upgrading" {
		t.Error("PhaseOf misreads a probe")
	}
}

// @scenario "Traffic is seeded and judged per kind and per api phase"
func TestUpgradeInProgressIsRetriedAfterRetryAfter(t *testing.T) {
	var answered atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if answered.Add(1) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"code":"upgrade_in_progress"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	traffic := &Traffic{Client: Client{URL: server.URL}, Hold: 5 * time.Second, Origin: time.Now(), http: server.Client()}
	call := traffic.one(context.Background(), Kind{Name: "rest-read", Do: restRead}, 0)
	if call.Status != http.StatusOK || call.Retries != 1 || call.UpgradeInProgress != 1 || call.NonOK != 1 || call.RetryWindowMs < 900 {
		t.Errorf("call = %+v, want 200 after one retry about a second later", call)
	}
}
