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
		if env["LOG_LEVEL"] != "info" {
			t.Errorf("%s: releases log at %q, want info as cloud runs them", name, env["LOG_LEVEL"])
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

// @scenario "A starting api's 503 is waited out per Retry-After on every deployment"
func TestStartingAnswerIsWaitedOutOnEveryDeployment(t *testing.T) {
	for _, stopStart := range []bool{true, false} {
		var answered atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			if answered.Add(1) == 1 {
				w.Header().Set("Retry-After", "1")
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte("langwatch-api is starting"))
				return
			}
			w.WriteHeader(http.StatusOK)
		}))
		traffic := &Traffic{Client: Client{URL: server.URL}, Hold: 5 * time.Second, Origin: time.Now(), http: server.Client(), RetryUnanswered: stopStart}
		call := traffic.one(context.Background(), Kind{Name: "rest-read", Do: restRead}, 0)
		server.Close()
		if call.Status != http.StatusOK || call.Gap != 1 || call.NonOK != 0 || call.Retries != 1 {
			t.Errorf("stopStart=%v: call = %+v, want 200 after waiting out the start, no non-2xx", stopStart, call)
		}
	}
}

// @scenario "The api-early drill holds client requests long enough for the worker delay and the upgrade"
func TestAPIEarlyDrillRaisesTheClientHold(t *testing.T) {
	options := Options{Hold: 60 * time.Second, WorkerDelay: 60 * time.Second, FromDir: ".", HeadDir: ".", Release: "r", RunDir: t.TempDir()}
	got, err := withDrills(options, "", DrillAPIEarly)
	if err != nil {
		t.Fatal(err)
	}
	if got.Hold != 180*time.Second {
		t.Errorf("hold = %s, want 3m0s", got.Hold)
	}
	got, _ = withDrills(options, "", DrillRetry)
	if got.Hold != 60*time.Second {
		t.Errorf("hold = %s without api-early, want 1m0s", got.Hold)
	}
}

// @scenario "Traffic is seeded and judged per kind and per api phase"
func TestQueueKindsGroupWaitingJobs(t *testing.T) {
	out := "{event-sourcing/jobs}:gq:group:p1/fold/traceSummary/reactor/deferredOriginResolution/trace:a:jobs 1 1000 1000\n" +
		"{event-sourcing/jobs}:gq:group:p2/fold/traceSummary/reactor/deferredOriginResolution/trace:b:jobs 2 3000 61000\n" +
		"{event-sourcing/jobs}:gq:group:p1/command/recordDataPoint/metric:metric:3:jobs 12 0 0\n"
	got := groupQueueKinds(out, 1000)
	want := "command/recordDataPoint: 12 jobs in 1 groups, due -1 s to -1 s\nfold/traceSummary/reactor/deferredOriginResolution: 3 jobs in 2 groups, due +0 s to +60 s"
	if got != want {
		t.Errorf("got\n%s\nwant\n%s", got, want)
	}
}

func TestRunSeedGivesEachRunItsOwnIDs(t *testing.T) {
	start := time.Unix(1_700_000_000, 5)
	same, again, later := RunSeed(1, start), RunSeed(1, start), RunSeed(1, start.Add(time.Second))
	if same != again || SeededID(same, "dataset", 3) != SeededID(again, "dataset", 3) {
		t.Fatal("ids differ within one run")
	}
	if SeededID(same, "dataset", 3) == SeededID(later, "dataset", 3) || SeededID(1, "dataset", 3) == SeededID(same, "dataset", 3) {
		t.Fatal("a later run, or the unsalted seed, replays the same ids")
	}
}

func TestInDownWindowLeavesOnlyUnavailableLinesInsideTheWindowToH8(t *testing.T) {
	origin := time.Date(2026, 10, 11, 18, 44, 32, 0, time.UTC)
	inside := `{"level":"error","time":"2026-10-11T18:46:47.693Z","error":{"type":"ClickHouseUnavailableError"}}`
	after := `{"level":"error","time":"2026-10-11T18:47:30.000Z","error":{"type":"ClickHouseUnavailableError"}}`
	unknown := `{"level":"error","time":"2026-10-11T18:46:47.693Z","error":{"type":"UNKNOWN_TABLE"}}`
	reopening := `{"level":"error","time":"2026-10-11T18:46:58.300Z","error":{"type":"ClickHouseUnavailableError"}}`
	if !inDownWindow(inside, 95_000, 146_000, origin) || !inDownWindow(reopening, 95_000, 146_000, origin) {
		t.Fatal("an unavailable line inside the window, or just as the gate reopens, must go to H8")
	}
	if inDownWindow(after, 95_000, 146_000, origin) || inDownWindow(unknown, 95_000, 146_000, origin) || inDownWindow(inside, 0, 0, origin) {
		t.Fatal("only unavailable lines inside a real window go to H8")
	}
	preflight := `{"level":"error","time":"2026-10-11T18:46:47.693Z","phase":"preflight","msg":"Cannot connect to ClickHouse at http://127.0.0.1:1/ after waiting 5s"}`
	client := `[2026-10-11T18:46:47.788Z][ERROR][@clickhouse/client][Connection] Query: HTTP request error.`
	if !inDownWindow(preflight, 95_000, 146_000, origin) || !inDownWindow(client, 95_000, 146_000, origin) {
		t.Fatal("the migration preflight and the client's own line meeting the closed gate go to H8")
	}
}
