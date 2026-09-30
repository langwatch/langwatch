package apidiff

import (
	"bytes"
	"context"
	"flag"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/havenrun"
)

const adminMixYAML = `- id: reads-dataset
  endpoint: GET /api/dataset
  request: { path: /api/dataset }
  expect: { status: 200 }
- id: needs-admin-key
  endpoint: GET /api/organizations
  auth: admin
  request: { path: /api/organizations }
  expect: { status: 200 }
- id: needs-own-org
  endpoint: GET /api/dataset
  shard: org
  request: { path: /api/dataset }
  expect: { status: 200 }
`

// adminStack answers the instance-admin probe with adminStatus and the
// dataset read with 200.
func adminStack(t *testing.T, adminStatus int) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/api/organizations" {
			writer.WriteHeader(adminStatus)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{}`))
	}))
	t.Cleanup(server.Close)
	return server.URL
}

func runAdminMix(t *testing.T, baseURL string) (int, string) {
	t.Helper()
	var report bytes.Buffer
	options := scenarioOptions{
		Progress: &report, A: baseURL, Timeout: 2 * time.Second, Concurrency: 1, Shards: 1, RunDir: t.TempDir(),
		Glob: writeScenarioYAML(t, adminMixYAML), Keys: Keys{ProjectKey: "key", OrgKey: "org", AdminKey: "admin"},
	}
	code := runScenarioPhase(context.Background(), options, &report, &report)
	return code, report.String()
}

func TestAdminRoutesAbsentUnderSaaSDeferTheScenariosThatNeedThem(t *testing.T) {
	code, report := runAdminMix(t, adminStack(t, http.StatusNotFound))
	if code != exitEqual || !strings.Contains(report, "0 ERROR") {
		t.Fatalf("code %d:\n%s", code, report)
	}
	for _, want := range []string{"answer 404 on stack (SaaS)", "scenarios: 1 run: 1 PASS", "2 deferred: self-hosted pass", "needs-admin-key, needs-own-org"} {
		if !strings.Contains(report, want) {
			t.Errorf("report lacks %q:\n%s", want, report)
		}
	}
	if strings.Count(report, "answer 404") != 1 {
		t.Errorf("the fallback must be logged once:\n%s", report)
	}
}

// @scenario "The self-hosted pass runs exactly the scenarios the SaaS run deferred"
func TestTheDeferredListRoundTripsThroughScenarioID(t *testing.T) {
	runDir, glob := t.TempDir(), writeScenarioYAML(t, adminMixYAML)
	var report bytes.Buffer
	options := scenarioOptions{
		Progress: &report, A: adminStack(t, http.StatusNotFound), Timeout: 2 * time.Second, Concurrency: 1, Shards: 1,
		RunDir: runDir, Glob: glob, Keys: Keys{ProjectKey: "key", OrgKey: "org", AdminKey: "admin"},
	}
	runScenarioPhase(context.Background(), options, &report, &report)
	listed := filepath.Join(runDir, deferredFile)
	if !strings.Contains(report.String(), "deferred list: "+listed) {
		t.Fatalf("the run must name its deferred list:\n%s", report.String())
	}
	flags := flag.NewFlagSet("scenarios", flag.ContinueOnError)
	scenarios := &scenarioFlags{}
	registerScenarioFlags(flags, scenarios)
	if err := flags.Parse([]string{"-scenario-id", "@" + listed, "-scenario-id", "reads-*"}); err != nil {
		t.Fatal(err)
	}
	loaded, err := loadScenarios(glob)
	if err != nil {
		t.Fatal(err)
	}
	var selected []string
	for _, item := range selectScenarios(loaded, scenarios.ids) {
		selected = append(selected, item.ID)
	}
	if got := strings.Join(selected, ","); got != "reads-dataset,needs-admin-key,needs-own-org" {
		t.Fatalf("selected %s", got)
	}
}

func TestAnEmptyOrMissingDeferredListIsRefused(t *testing.T) {
	empty := filepath.Join(t.TempDir(), deferredFile)
	if err := os.WriteFile(empty, []byte("\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"@" + empty, "@" + empty + ".missing"} {
		flags := flag.NewFlagSet("scenarios", flag.ContinueOnError)
		flags.SetOutput(io.Discard)
		registerScenarioFlags(flags, &scenarioFlags{})
		if err := flags.Parse([]string{"-scenario-id", value}); err == nil {
			t.Errorf("%s: want an error, since no id would select every scenario", value)
		}
	}
}

func TestAnAdminKeyTheStackRefusesIsNotTakenForSaaS(t *testing.T) {
	_, report := runAdminMix(t, adminStack(t, http.StatusUnauthorized))
	if strings.Contains(report, "deferred") || strings.Contains(report, "SaaS") {
		t.Fatalf("a refused key is not the SaaS fallback:\n%s", report)
	}
}

func TestServicePortsFindTheStackBehindTheUIPort(t *testing.T) {
	status := []byte(`{"stacks":[{"slug":"check","apiPort":51069,"services":[{"name":"app","url":"https://app.check.langwatch.localhost","port":51061}]}]}`)
	parsed, err := havenrun.ParseStatus(status)
	if err != nil {
		t.Fatal(err)
	}
	stack, ok := stackServing(parsed, "http://127.0.0.1:51061")
	if !ok || stack.Slug != "check" {
		t.Fatalf("stackServing = %q, %v", stack.Slug, ok)
	}
	if _, ok := stackServing(parsed, "http://127.0.0.1:9"); ok {
		t.Fatal("an unserved port must match nothing")
	}
}

// selfHostedYAML adds a scenario the SaaS deployment does not serve.
const selfHostedYAML = adminMixYAML + `- id: self-hosted-only
  endpoint: GET /api/checkup
  selfHosted: true
  request: { path: /api/checkup }
  expect: { status: 200 }
`

// sessionStack is a SaaS stack: the admin routes 404, the seeded admin signs
// in, and an organization is made and keyed through tRPC.
func sessionStack(t *testing.T) string {
	t.Helper()
	reply := map[string]string{
		"/api/trpc/organization.createAndAssign": `{"result":{"data":{"organization":{"id":"org-1"},"team":{"id":"team-1"}}}}`,
		"/api/trpc/apiKey.create":                `{"result":{"data":{"token":"org-token"}}}`,
		"/api/projects":                          `{"id":"project-1","serviceApiKey":"project-token"}`,
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch body, known := reply[request.URL.Path]; {
		case request.URL.Path == "/api/organizations":
			writer.WriteHeader(http.StatusNotFound)
		case request.URL.Path == "/api/auth/sign-in/email":
			http.SetCookie(writer, &http.Cookie{Name: "session", Value: "admin"})
		case known && request.Method == http.MethodPost:
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(body))
		default:
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{}`))
		}
	}))
	t.Cleanup(server.Close)
	return server.URL
}

func TestSaaSSeedsSecondOrganizationsThroughTheAdminSession(t *testing.T) {
	var report bytes.Buffer
	options := scenarioOptions{
		Progress: &report, A: sessionStack(t), Timeout: 2 * time.Second, Concurrency: 1, Shards: 1, RunDir: t.TempDir(),
		Glob: writeScenarioYAML(t, selfHostedYAML), Keys: Keys{ProjectKey: "key", OrgKey: "org", AdminKey: "admin"},
	}
	code := runScenarioPhase(context.Background(), options, &report, &report)
	if code != exitEqual {
		t.Fatalf("code %d:\n%s", code, report.String())
	}
	for _, want := range []string{"through the seeded admin's session", "scenarios: 2 run: 2 PASS", "2 deferred: self-hosted pass", "needs-admin-key, self-hosted-only"} {
		if !strings.Contains(report.String(), want) {
			t.Errorf("report lacks %q:\n%s", want, report.String())
		}
	}
}
