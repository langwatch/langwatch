package apidiff

import (
	"bytes"
	"context"
	"net/http"
	"os/exec"
	"strings"
	"testing"
)

func TestLangyAgentStubAcceptsTheManagersRoutes(t *testing.T) {
	stub, err := startLangyAgentStub()
	if err != nil {
		t.Fatal(err)
	}
	defer stub.Close()

	cases := map[string]int{"/worker/probe": 200, "/warm": 200, "/worker/turn": 202, "/worker/cancel": 200}
	for route, want := range cases {
		for _, secret := range []string{throwawayLangyInternalSecret, "wrong"} {
			request, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, stub.URL("branch")+route, strings.NewReader(`{}`))
			request.Header.Set("Authorization", "Bearer "+secret)
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			expected := want
			if secret == "wrong" {
				expected = http.StatusUnauthorized
			}
			if response.StatusCode != expected {
				t.Errorf("%s with %s secret: %d, want %d", route, secret, response.StatusCode, expected)
			}
		}
	}
}

func TestInstanceEnvCarriesTheCollaboratorsAndDropsTheDevelopersOwn(t *testing.T) {
	env := instanceEnv([]string{"JEV_API_KEY=developer-key", "LANGY_AGENT_URL=http://developer"}, instanceEnvSpec{
		port: 6560, collaborators: collaboratorEnv("main", "http://127.0.0.1:9/main"),
	})
	joined := strings.Join(env, "\n")
	for _, leaked := range []string{"developer-key", "http://developer"} {
		if strings.Contains(joined, leaked) {
			t.Errorf("developer value %q reached the instance", leaked)
		}
	}
	for _, want := range []string{
		"JEV_API_KEY=" + throwawayJudgeKey, "LWQL_CLICKHOUSE_USER=apidiff_lwql_main", "LWQL_ACCESS_MODEL_MODE=sql",
		"LANGY_AGENT_URL=http://127.0.0.1:9/main", "LANGY_INTERNAL_SECRET=" + throwawayLangyInternalSecret,
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("instance env missing %q", want)
		}
	}
}

func TestProvisioningTargetsThePlaygroundAtTheWidgetProjectOnly(t *testing.T) {
	sql := provisioningSQL()
	if !strings.Contains(sql, `"FeatureFlag"`) || !strings.Contains(sql, `"projectId":"`+fixtureWidgetProjectID+`"`) {
		t.Fatalf("no widget-project flag rule in:\n%s", sql)
	}
	if strings.Contains(forcedFeatureFlags, customChartFlag) {
		t.Fatal("forcing the playground on turns saved charts off in every project")
	}
}

func TestComposeOverrideLetsTheRunCreateLwqlUsers(t *testing.T) {
	override := portsOverrideYAML(1, 2, 3)
	if !strings.Contains(override, "CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT") {
		t.Fatal("the default ClickHouse user cannot create the LangWatchQL identity")
	}
	if !strings.Contains(override, "<custom_settings_prefixes>custom_</custom_settings_prefixes>") {
		t.Fatal("the server refuses the LangWatchQL settings profile without the custom_ prefix")
	}
}

func TestRetiredOperationsAreNotProbed(t *testing.T) {
	operations := []Operation{{Method: http.MethodPut, Path: "/api/dataset/direct-upload/staging/{uploadId}", InA: true, InB: true}}
	result := ProbeAll(context.Background(), ProbeOptions{A: "http://127.0.0.1:1", B: "http://127.0.0.1:1"}, operations)
	if result.Probed != 0 {
		t.Fatalf("probed %d retired operations", result.Probed)
	}
	for _, finding := range result.Findings {
		if finding.Path == operations[0].Path {
			t.Fatalf("a retired operation produced a finding: %+v", finding)
		}
	}
}

func TestAWorkerThatDiesDuringBootIsStartedOnceMore(t *testing.T) {
	var log bytes.Buffer
	state := &bootState{stderr: &log, workRoot: t.TempDir()}
	command := exec.CommandContext(context.Background(), "false")
	if err := command.Start(); err != nil {
		t.Skip("no false binary")
	}
	state.respawnOnEarlyExit(context.Background(), command, instanceProcess{logName: "main-worker"})
	if !strings.Contains(log.String(), "main-worker exited during boot; starting it once more") {
		t.Fatalf("no respawn attempt logged:\n%s", log.String())
	}
}
