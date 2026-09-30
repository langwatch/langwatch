package apidiff

import (
	"bytes"
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func singleOptions(t *testing.T, server string) scenarioOptions {
	t.Helper()
	root := t.TempDir()
	return scenarioOptions{
		A: server, Keys: Keys{ProjectKey: "key", OrgKey: "org"}, Timeout: 5 * time.Second,
		Concurrency: 4, Shards: 2, Repeat: 1, Glob: writeScenarioYAML(t, strings.Replace(fakeScenarios, "  serial-note: unused\n", "", 1)),
		RunDir: filepath.Join(root, ".apidiff", "run-1"), SeedDir: filepath.Join(root, ".apidiff"), DoneRoot: root,
	}
}

func runSingle(options scenarioOptions) (int, string) {
	var report bytes.Buffer
	code := runScenarioPhase(context.Background(), options, &report, &report)
	return code, report.String()
}

func TestSingleSidedRunJudgesPassOrFail(t *testing.T) {
	stack := newFake()
	server := httptest.NewServer(stack.handler())
	t.Cleanup(server.Close)
	code, report := runSingle(singleOptions(t, server.URL))
	if code != exitEqual || !strings.Contains(report, "3 PASS, 0 FAIL, 0 ERROR") {
		t.Fatalf("code %d:\n%s", code, report)
	}
	stack.badCode = 200
	code, report = runSingle(singleOptions(t, server.URL))
	if code != exitDifferences || !strings.Contains(report, "FAIL  ") || strings.Contains(report, "FAIL-branch") {
		t.Errorf("code %d:\n%s", code, report)
	}
}

func TestSharedSeedIsReusedByASecondLane(t *testing.T) {
	stack := newFake()
	server := httptest.NewServer(stack.handler())
	t.Cleanup(server.Close)
	options := singleOptions(t, server.URL)
	runSingle(options)
	runSingle(options)
	if stack.projects != 1 {
		t.Errorf("%d projects seeded across two runs, want the one the record holds", stack.projects)
	}
	if _, err := os.Stat(filepath.Join(options.SeedDir, sharedSeedFile)); err != nil {
		t.Errorf("no seed record: %v", err)
	}
}

func TestDoneScenariosAreSkippedUnlessFinal(t *testing.T) {
	server := httptest.NewServer(newFake().handler())
	t.Cleanup(server.Close)
	options := singleOptions(t, server.URL)
	runSingle(options)
	if _, err := markScenarioDone(options.DoneRoot, "run-1", "create-is-readable", "held", false, time.Now()); err != nil {
		t.Fatal(err)
	}
	options.RunDir = filepath.Join(options.DoneRoot, ".apidiff", "run-2")
	if _, report := runSingle(options); !strings.Contains(report, "2 PASS") || !strings.Contains(report, "1 signed off") {
		t.Errorf("the signed-off scenario ran:\n%s", report)
	}
	options.Final = true
	if _, report := runSingle(options); !strings.Contains(report, "3 PASS") {
		t.Errorf("-final skipped it:\n%s", report)
	}
	if err := undoScenarioDone(options.DoneRoot, "create-is-readable"); err != nil {
		t.Error(err)
	}
	if _, err := markScenarioDone(options.DoneRoot, "run-1", "nope", "x", false, time.Now()); err == nil {
		t.Error("signed off a scenario the run never had")
	}
}

func TestDoneRefusesAScenarioThatFailed(t *testing.T) {
	stack := newFake()
	stack.badCode = 200
	server := httptest.NewServer(stack.handler())
	t.Cleanup(server.Close)
	options := singleOptions(t, server.URL)
	runSingle(options)
	if _, err := markScenarioDone(options.DoneRoot, "run-1", "create-is-readable", "x", false, time.Now()); err == nil {
		t.Error("signed off a failing scenario")
	}
	if _, err := markScenarioDone(options.DoneRoot, "run-1", "create-is-readable", "", true, time.Now()); err == nil {
		t.Error("signed off without a note")
	}
}

func TestPlaceholdersCarryTimeAndHexIDs(t *testing.T) {
	before := time.Now().UnixMilli()
	got, err := expandText("{nowMs-3600000}", nil)
	millis, _ := strconv.ParseInt(got, 10, 64)
	if err != nil || millis > before-3600000+5000 || millis < before-3600000-5000 {
		t.Errorf("{nowMs-3600000} = %q, %v", got, err)
	}
	if _, err := expandText("{uid-1}", map[string]string{"uid": "a"}); err == nil {
		t.Error("an offset on a variable was accepted")
	}
	runner := newScenarioRunner(context.Background(), scenarioOptions{A: "http://x", Concurrency: 1})
	vars := runner.varsFor(runner.sides[0], sharedShard(Keys{}), &scenarioResult{order: 7})
	if len(vars["uidHex16"]) != 16 || len(vars["uidHex32"]) != 32 || vars["UID"] != strings.ToUpper(vars["uid"]) || vars["userId"] == "" {
		t.Errorf("vars %v", vars)
	}
}

func TestBodyMatchCanRequireAKeyAbsent(t *testing.T) {
	want := map[string]any{"secret": scenarioAbsent}
	if detail := matchBody(want, map[string]any{"id": 1}, ""); detail != "" {
		t.Errorf("absent key refused: %s", detail)
	}
	if detail := matchBody(want, map[string]any{"secret": "x"}, ""); !strings.Contains(detail, "absent") {
		t.Errorf("present key accepted: %q", detail)
	}
}

func TestDryRunOnlyValidates(t *testing.T) {
	options := singleOptions(t, "")
	options.DryRun = true
	code, report := runSingle(options)
	if code != exitEqual || !strings.Contains(report, "3 valid") {
		t.Errorf("code %d:\n%s", code, report)
	}
}

func TestAdminKeyProvisionsTheToolOrganizationOnce(t *testing.T) {
	stack := newFake()
	server := httptest.NewServer(stack.handler())
	t.Cleanup(server.Close)
	options := singleOptions(t, server.URL)
	options.Keys.AdminKey = "admin"
	runSingle(options)
	runSingle(options)
	if stack.orgs != 1 {
		t.Errorf("%d organizations made across two runs, want the one apidiff owns", stack.orgs)
	}
	record := loadSharedRecord(filepath.Join(options.SeedDir, sharedSeedFile)).Stacks[server.URL]
	if record.Shared == nil || record.Shared.OrgKey != "ok1" {
		t.Errorf("record %+v lacks the apidiff organization", record)
	}
}

const siblingScenarios = `
- id: other-project-b
  endpoint: GET /api/dataset
  auth: project-b
  request: { path: /api/dataset }
  expect: { status: 200 }
- id: other-project-c
  endpoint: GET /api/dataset
  auth: project-c
  request: { path: /api/dataset }
  expect: { status: 200 }
`

func TestProjectBIsASeededSiblingAndProjectCNamesTheAdminKey(t *testing.T) {
	server := httptest.NewServer(newFake().handler())
	t.Cleanup(server.Close)
	options := singleOptions(t, server.URL)
	options.Glob = writeScenarioYAML(t, siblingScenarios)
	code, report := runSingle(options)
	if code != exitError || !strings.Contains(report, "1 PASS, 0 FAIL, 1 ERROR") {
		t.Fatalf("code %d:\n%s", code, report)
	}
	if !strings.Contains(report, "-admin-key") || !strings.Contains(report, "LANGWATCH_INSTANCE_ADMIN_API_KEY") {
		t.Errorf("the project-c refusal does not name the unblocker:\n%s", report)
	}
}

const foreignScenarios = `
- id: foreign-project-key
  endpoint: GET /api/echo
  auth: org-c
  request: { path: /api/echo }
  expect: { status: 200, body: { token: "{projectKeyC}" } }
- id: foreign-org-key
  endpoint: GET /api/echo
  auth: org-c-org
  request: { path: "/api/echo" }
  expect: { status: 200, body: { bearer: "Bearer {orgKeyC}" } }
`

func TestOrgCIsASecondOrganizationSeededOnceAndNamesTheAdminKey(t *testing.T) {
	stack := newFake()
	server := httptest.NewServer(stack.handler())
	t.Cleanup(server.Close)
	options := singleOptions(t, server.URL)
	options.Glob = writeScenarioYAML(t, foreignScenarios)
	code, report := runSingle(options)
	if code != exitError || !strings.Contains(report, "0 PASS, 0 FAIL, 2 ERROR") || !strings.Contains(report, "-admin-key") {
		t.Fatalf("without the admin key, code %d:\n%s", code, report)
	}
	options.Keys.AdminKey = "admin"
	runSingle(options)
	code, report = runSingle(options)
	if code != exitEqual || !strings.Contains(report, "2 PASS, 0 FAIL, 0 ERROR") {
		t.Fatalf("code %d:\n%s", code, report)
	}
	record := loadSharedRecord(filepath.Join(options.SeedDir, sharedSeedFile)).Stacks[server.URL]
	if stack.orgs != 2 || record.Foreign == nil || record.Foreign.OrgKey == record.Shared.OrgKey || record.Foreign.ProjectKey == record.Shared.ProjectKey {
		t.Errorf("%d organizations made, record %+v: want the tool's and one other, reused", stack.orgs, record)
	}
}
