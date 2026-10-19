package cell

import (
	"context"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

func TestHybridEnvRoutesAPrivateTargetThroughItsGate(t *testing.T) {
	stores := Stores{PostgresBase: "postgresql://u:p@127.0.0.1:5432", ClickHouseBase: "http://d:p@127.0.0.1:8123", Name: "upgradelab_x", RedisPort: "7001",
		Private: []string{"snap"}, Gates: map[string]int{"snap": 9911}}
	env, _ := BuildEnv(EnvInput{Profile: Profiles["hybrid"], Stores: stores, APIPort: 7100})
	if got := env["CLICKHOUSE_URL__snap__snap_hybrid_org_4"]; got != "http://d:p@127.0.0.1:9911/upgradelab_x_p_snap" {
		t.Errorf("gated private target = %q", got)
	}
	if env["CLICKHOUSE_URL"] != stores.ClickHouseURL("") {
		t.Errorf("the shared target went through a gate: %q", env["CLICKHOUSE_URL"])
	}
}

func TestGateForwardsUntilDownAndAgainWhenBack(t *testing.T) {
	upstream, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = upstream.Close() }()
	go func() {
		for {
			conn, err := upstream.Accept()
			if err != nil {
				return
			}
			go func() { _, _ = io.Copy(conn, conn) }()
		}
	}()
	gate, err := StartGate(upstream.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer gate.Close()
	echo := func() error {
		conn, err := net.DialTimeout("tcp", "127.0.0.1:"+itoa(gate.Port()), time.Second)
		if err != nil {
			return err
		}
		defer func() { _ = conn.Close() }()
		_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
		if _, err := conn.Write([]byte("ping")); err != nil {
			return err
		}
		reply := make([]byte, 4)
		_, err = io.ReadFull(conn, reply)
		return err
	}
	if err := echo(); err != nil {
		t.Fatalf("gate up: %v", err)
	}
	gate.SetDown(true)
	if err := echo(); err == nil {
		t.Fatal("gate down still forwarded")
	}
	gate.SetDown(false)
	if err := echo(); err != nil {
		t.Fatalf("gate back up: %v", err)
	}
}

func TestParseTargetStatesReadsEachTarget(t *testing.T) {
	states := ParseTargetStates("private:snap_hybrid_org_4|2|6|done,failed\nshared|0|6|done\n")
	if got := states["private:snap_hybrid_org_4"]; got.Open != 2 || got.Total != 6 || got.Statuses != "done,failed" {
		t.Errorf("private = %+v", got)
	}
	if got := states["shared"]; got.Open != 0 || got.Total != 6 {
		t.Errorf("shared = %+v", got)
	}
}

func TestMisplacedRowsNamesTableAndTenantOffTheirHome(t *testing.T) {
	home := map[string]string{"org_p": "snap", "project_p": "snap"}
	shared := TenantRows{"log_records": {"project_s": 3, "project_p": 2}, "stored_spans": {"project_s": 9}}
	misplaced := MisplacedRows(home, "", shared)
	if len(misplaced) != 1 || !strings.Contains(misplaced[0], "log_records project_p x2") {
		t.Errorf("shared target: %v", misplaced)
	}
	private := TenantRows{"event_log": {"org_p": 4, "project_s": 1}}
	misplaced = MisplacedRows(home, "snap", private)
	if len(misplaced) != 1 || !strings.Contains(misplaced[0], "event_log project_s x1") {
		t.Errorf("private target: %v", misplaced)
	}
}

func TestPrivateKindCountsListsEveryKindEvenWhenEmpty(t *testing.T) {
	counts := PrivateKindCounts(TenantRows{"stored_spans": {"project_p": 5, "project_s": 7}}, map[string]bool{"project_p": true})
	if counts["stored_spans"] != 5 {
		t.Errorf("spans = %d, want 5 (the shared project's rows excluded)", counts["stored_spans"])
	}
	if count, listed := counts["evaluation_runs"]; !listed || count != 0 {
		t.Errorf("evaluation_runs = %d listed %t, want 0 listed", count, listed)
	}
}

func TestRefusedClearlyTellsARefusalFromAFallback(t *testing.T) {
	cases := []struct {
		probe routeProbe
		want  bool
	}{
		{routeProbe{Booted: false}, true},
		{routeProbe{Booted: true, Answers: map[string]int{"trace": 503, "search": 503}, Codes: map[string]string{"trace": "private_dataplane_unavailable", "search": "private_dataplane_unavailable"}}, true},
		{routeProbe{Booted: true, Answers: map[string]int{"trace": 503, "search": 500}}, false}, // a bare 500 is not a clear refusal (T7-F3)
		{routeProbe{Booted: true, Answers: map[string]int{"trace": 503, "search": 503}, Codes: map[string]string{"trace": "upgrade_in_progress", "search": "private_dataplane_unavailable"}}, false},
		{routeProbe{Booted: true, Answers: map[string]int{"trace": 404, "search": 200}}, false},
		{routeProbe{Booted: true, Answers: map[string]int{"trace": 500, "search": 200}}, false},
		{routeProbe{Booted: true, Answers: map[string]int{}}, false},
	}
	for _, each := range cases {
		if got := RefusedClearly(each.probe); got != each.want {
			t.Errorf("RefusedClearly(%+v) = %t, want %t", each.probe, got, each.want)
		}
	}
}

func TestCollectorEvalLogsAnEvaluationWithItsTrace(t *testing.T) {
	request, id, err := collectorEval(context.Background(), Client{URL: "http://127.0.0.1:1", APIKey: "k", Seed: 3}, 1)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(request.Body)
	if request.URL.Path != "/api/collector" || !strings.Contains(string(body), `"evaluations":[{`) || !strings.Contains(string(body), evaluationName) || !strings.Contains(string(body), id) {
		t.Errorf("collector-eval %s body %s", request.URL.Path, body)
	}
}

func TestPrivateMixCarriesEveryKindItsChecksRead(t *testing.T) {
	names := map[string]bool{}
	for _, kind := range PrivateMix(time.Second) {
		names[kind.Name] = true
	}
	for _, want := range []string{"otlp-trace", "dataset", "otlp-log", "otlp-metric", "collector-eval"} {
		if !names[privatePrefix+want] {
			t.Errorf("private mix lacks %s", want)
		}
		if want != "dataset" && storedTable[want] == "" {
			t.Errorf("no stored table for %s, so N3 cannot see it", want)
		}
	}
}

func TestBrokenRouteEnvDropsOrBreaksOnlyThePrivateRoute(t *testing.T) {
	base := map[string]string{"CLICKHOUSE_URL": "http://shared", "CLICKHOUSE_URL__snap__org": "http://private"}
	missing := brokenRouteEnv(base, "missing", "CLICKHOUSE_URL__snap__org")
	if _, kept := missing["CLICKHOUSE_URL__snap__org"]; kept || missing["CLICKHOUSE_URL"] != "http://shared" {
		t.Errorf("missing = %v", missing)
	}
	malformed := brokenRouteEnv(base, "malformed", "CLICKHOUSE_URL__snap__org")
	if strings.HasPrefix(malformed["CLICKHOUSE_URL__snap__org"], "http") || base["CLICKHOUSE_URL__snap__org"] != "http://private" {
		t.Errorf("malformed = %v, base %v", malformed, base)
	}
}

func TestCallsInWindowSplitsSharedFailuresFromPrivateAnswers(t *testing.T) {
	calls := []Call{{Kind: "otlp-trace", AtMs: 5, Status: 500}, {Kind: "otlp-trace", AtMs: 50, Status: 500},
		{Kind: privatePrefix + "otlp-trace", AtMs: 6, Status: 503}, {Kind: "rest-read", AtMs: 7, Status: 200}}
	failed, private := callsInWindow(calls, 1, 10)
	if len(failed) != 1 || len(private) != 1 || private[0] != "503" {
		t.Errorf("failed %v private %v", failed, private)
	}
}

func TestPrivateTargetsForAddsASecondTargetAtTierM(t *testing.T) {
	shape := map[string]string{"snap": "snap_hybrid_org_4"}
	if got := PrivateTargetsFor(shape, "S", false); len(got) != 1 {
		t.Errorf("S = %v", got)
	}
	if got := PrivateTargetsFor(shape, "M", false); len(got) != 2 || got["snap2"] != "snap_hybrid_org_3" {
		t.Errorf("live M targets = %v, want snap2 on organization 3, which a live cell seeds", got)
	}
	if got := PrivateTargetsFor(shape, "M", true); len(got) != 2 || got["snap2"] != "snap_hybrid_org_5" || len(shape) != 1 {
		t.Errorf("M = %v (shape %v)", got, shape)
	}
	if got := PrivateTargetsFor(map[string]string{}, "M", false); len(got) != 0 {
		t.Errorf("a shape with no private target gained one at M: %v", got)
	}
}

func TestOnlyRefusalsTellsA503FromABare500(t *testing.T) {
	if !OnlyRefusals([]string{"200", "201", "503"}) {
		t.Error("2xx and 503 answers are refusals, want true")
	}
	if OnlyRefusals([]string{"200", "500"}) {
		t.Error("a bare 500 while the target is down is not a clear refusal, want false")
	}
}
