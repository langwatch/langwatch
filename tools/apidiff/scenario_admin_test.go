package apidiff

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
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
