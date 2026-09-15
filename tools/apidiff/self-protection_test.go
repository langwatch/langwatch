package apidiff

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
)

func deleteProjectByID() Operation {
	return Operation{
		Method: http.MethodDelete,
		Path:   "/api/projects/{id}",
		InA:    true, InB: true,
		Params: []Param{{Name: "id", In: "path", Required: true}},
	}
}

func resolvedPath(values map[string]string) resolvedParams {
	return resolvedParams{pathValues: values, query: url.Values{}}
}

func TestGuardSelfDestructionRetargetsTheCredentialsOwnProject(t *testing.T) {
	sideA := resolvedPath(map[string]string{"id": seededProjectID})
	sideB := resolvedPath(map[string]string{"id": seededProjectID})

	guard := GuardSelfDestruction(deleteProjectByID(), sideA, sideB)

	if guard.Blocked != "" {
		t.Fatalf("blocked = %q, want the probe to run against the sacrificial project", guard.Blocked)
	}
	for name, side := range map[string]resolvedParams{"candidate": sideA, "base": sideB} {
		if got := side.pathValues["id"]; got != fixtureDoomedProjectID {
			t.Errorf("%s id = %q, want the sacrificial project %q", name, got, fixtureDoomedProjectID)
		}
	}
	if len(guard.Retargets) != 1 || !strings.Contains(guard.Retargets[0], seededProjectID) {
		t.Errorf("retargets = %v, want one note naming %q", guard.Retargets, seededProjectID)
	}
}

func TestGuardSelfDestructionRetargetsACredentialRotation(t *testing.T) {
	rotate := Operation{
		Method: http.MethodPost,
		Path:   "/api/projects/{projectId}/regenerate-api-key",
		InA:    true, InB: true,
	}
	side := resolvedPath(map[string]string{"projectId": seededProjectID})

	guard := GuardSelfDestruction(rotate, side)

	if side.pathValues["projectId"] != fixtureDoomedProjectID {
		t.Fatalf("projectId = %q, want the sacrificial project; rotating the seeded project's key revokes the probe credential just as archiving it does",
			side.pathValues["projectId"])
	}
	if guard.Blocked != "" {
		t.Errorf("blocked = %q, want the probe to run", guard.Blocked)
	}
}

func TestGuardSelfDestructionNamesASkipItCannotSubstitute(t *testing.T) {
	deleteOrg := Operation{
		Method: http.MethodDelete,
		Path:   "/api/organization/{organizationId}",
		InA:    true, InB: true,
	}
	side := resolvedPath(map[string]string{"organizationId": seededOrganizationID})

	guard := GuardSelfDestruction(deleteOrg, side)

	if guard.Blocked == "" {
		t.Fatal("blocked = \"\", want a named skip: no sacrificial organization exists")
	}
	for _, want := range []string{seededOrganizationID, "no sacrificial organization"} {
		if !strings.Contains(guard.Blocked, want) {
			t.Errorf("skip reason %q missing %q", guard.Blocked, want)
		}
	}
	if side.pathValues["organizationId"] != seededOrganizationID {
		t.Errorf("a blocked operation must not be rewritten; got %q", side.pathValues["organizationId"])
	}
}

func TestSelfDestructiveSkipCarriesItsOwnRootCause(t *testing.T) {
	deleteOrg := Operation{Method: http.MethodDelete, Path: "/api/organization/{organizationId}", InA: true, InB: true}
	guard := GuardSelfDestruction(deleteOrg, resolvedPath(map[string]string{"organizationId": seededOrganizationID}))

	cause := RootCause(skippedFinding(deleteOrg, guard.Blocked))

	if cause != "self-destructive-target" {
		t.Fatalf("root cause = %q, want self-destructive-target; a coverage loss filed under unresolvable-parameter is invisible", cause)
	}
}

func TestGuardSelfDestructionLeavesReadsAlone(t *testing.T) {
	read := Operation{Method: http.MethodGet, Path: "/api/projects/{id}", InA: true, InB: true}
	side := resolvedPath(map[string]string{"id": seededProjectID})

	guard := GuardSelfDestruction(read, side)

	if side.pathValues["id"] != seededProjectID {
		t.Errorf("id = %q, want the read left pointed at %q", side.pathValues["id"], seededProjectID)
	}
	if guard.Blocked != "" || len(guard.Retargets) != 0 {
		t.Errorf("guard = %+v, want a read untouched", guard)
	}
}

// selfDestructSpec documents three project-key operations. The union sorts
// them by path, so the archive lands between the list that mints its target
// and the read that proves the credential survived it.
const selfDestructSpec = `{
  "openapi": "3.0.3",
  "components": {"securitySchemes": {"project_api_key": {"type": "apiKey", "in": "header", "name": "X-Auth-Token"}}},
  "paths": {
    "/api/projects": {
      "get": {"operationId": "listProjects", "security": [{"project_api_key": []}], "responses": {"200": {"description": "ok"}}}
    },
    "/api/projects/{id}": {
      "delete": {
        "operationId": "deleteProject",
        "security": [{"project_api_key": []}],
        "parameters": [{"name": "id", "in": "path", "required": true, "schema": {"type": "string"}}],
        "responses": {"200": {"description": "ok"}}
      }
    },
    "/api/zzz-after": {
      "get": {"operationId": "getAfter", "security": [{"project_api_key": []}], "responses": {"200": {"description": "ok"}}}
    }
  }
}`

// selfDestructInstance is an instance whose project credential is a column on
// a project row: archiving that project revokes the key, exactly as
// local-dev-project's apiKey does.
type selfDestructInstance struct {
	mu      sync.Mutex
	revoked bool
}

func (instance *selfDestructInstance) routes() map[string]http.HandlerFunc {
	return map[string]http.HandlerFunc{
		"GET /api/projects":           instance.guarded(instance.list),
		"DELETE /api/projects/{id}":   instance.guarded(instance.archive),
		"GET /api/zzz-after":          instance.guarded(instance.after),
		"GET /api/zzz-self-destruct/": instance.guarded(instance.selfDestruct),
	}
}

// guarded refuses every request once the credential has been revoked, the way
// a real instance refuses a key whose project is archived.
func (instance *selfDestructInstance) guarded(handler http.HandlerFunc) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		instance.mu.Lock()
		revoked := instance.revoked
		instance.mu.Unlock()
		if revoked {
			writeJSON(writer, http.StatusUnauthorized, `{"error": {"code": "invalid_credentials"}}`)
			return
		}
		handler(writer, request)
	}
}

func (instance *selfDestructInstance) list(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, 200, `{"projects": [{"id": "`+seededProjectID+`"}]}`)
}

func (instance *selfDestructInstance) archive(writer http.ResponseWriter, request *http.Request) {
	id := request.PathValue("id")
	if id == seededProjectID {
		instance.revoke()
	}
	writeJSON(writer, 200, `{"id": "`+id+`", "archived": true}`)
}

func (instance *selfDestructInstance) after(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, 200, `{"ok": true}`)
}

func (instance *selfDestructInstance) selfDestruct(writer http.ResponseWriter, _ *http.Request) {
	instance.revoke()
	writeJSON(writer, 200, `{"ok": true}`)
}

func (instance *selfDestructInstance) revoke() {
	instance.mu.Lock()
	instance.revoked = true
	instance.mu.Unlock()
}

// probeJSONReport runs the probe subcommand for JSON and returns the exit code
// with the decoded report.
func probeJSONReport(t *testing.T, args ...string) (int, Report) {
	t.Helper()
	code, stdout, stderr := runProbeCLI(t, append([]string{"probe", "-json"}, args...)...)
	var report Report
	if err := json.Unmarshal([]byte(stdout), &report); err != nil {
		t.Fatalf("decode report: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
	}
	return code, report
}

func transcriptFor(report Report, method, path, caseName string) (Transcript, bool) {
	for index := range report.Transcripts {
		transcript := &report.Transcripts[index]
		if transcript.Method == method && transcript.Path == path && transcript.Case == caseName {
			return *transcript, true
		}
	}
	return Transcript{}, false
}

func credentialCheckFor(report Report, label string) (CredentialCheck, bool) {
	for _, check := range report.CredentialChecks {
		if check.Label == label {
			return check, true
		}
	}
	return CredentialCheck{}, false
}

func TestDestructiveProbeLeavesTheRunsOwnCredentialWorking(t *testing.T) {
	candidate := newTestServer(t, selfDestructSpec, (&selfDestructInstance{}).routes())
	base := newTestServer(t, selfDestructSpec, (&selfDestructInstance{}).routes())

	code, report := probeJSONReport(t, "-a", candidate.URL, "-b", base.URL)

	archive, ok := transcriptFor(report, http.MethodDelete, "/api/projects/{id}", "delete")
	if !ok {
		t.Fatal("no delete transcript; the archive probe did not run")
	}
	if !strings.HasSuffix(archive.RequestPathA, fixtureDoomedProjectID) {
		t.Errorf("archive targeted %q, want the sacrificial project %q", archive.RequestPathA, fixtureDoomedProjectID)
	}
	if archive.A.Status != 200 || archive.B.Status != 200 {
		t.Errorf("archive statuses = [%d, %d], want the route still exercised on both sides", archive.B.Status, archive.A.Status)
	}

	after, ok := transcriptFor(report, http.MethodGet, "/api/zzz-after", "read")
	if !ok {
		t.Fatal("no transcript for the operation probed after the archive")
	}
	if after.A.Status != 200 || after.B.Status != 200 {
		t.Fatalf("statuses after the archive = [%d, %d], want [200, 200]; a 401 here is the credential the run destroyed",
			after.B.Status, after.A.Status)
	}

	check, ok := credentialCheckFor(report, "project key")
	if !ok {
		t.Fatal("no credential check for the project key")
	}
	if !check.Healthy() {
		t.Errorf("project key check = %+v, want healthy", check)
	}
	if code != exitEqual {
		t.Errorf("exit = %d, want %d", code, exitEqual)
	}
}

func TestLostCredentialFailsTheRunRatherThanReadingAsAgreement(t *testing.T) {
	spec := strings.Replace(selfDestructSpec,
		`"/api/zzz-after": {`,
		`"/api/zzz-self-destruct/": {"get": {"operationId": "selfDestruct", "security": [{"project_api_key": []}], "responses": {"200": {"description": "ok"}}}},
     "/api/zzz-after": {`, 1)
	candidate := newTestServer(t, spec, (&selfDestructInstance{}).routes())
	base := newTestServer(t, spec, (&selfDestructInstance{}).routes())

	code, report := probeJSONReport(t, "-a", candidate.URL, "-b", base.URL)

	// Both sides died identically, so every later probe agrees: without the
	// closing assertion this run reads as a clean, difference-free branch.
	if report.Differences != 0 {
		t.Fatalf("differences = %d, want 0 — the point of this test is that the numbers look perfect", report.Differences)
	}
	check, ok := credentialCheckFor(report, "project key")
	if !ok {
		t.Fatal("no credential check for the project key")
	}
	if !check.Lost {
		t.Fatalf("project key check = %+v, want Lost", check)
	}
	for _, want := range []string{"base", "candidate", "means nothing"} {
		if !strings.Contains(check.Note, want) {
			t.Errorf("note %q missing %q", check.Note, want)
		}
	}
	if len(report.LostCredentials()) != 1 {
		t.Errorf("lost credentials = %d, want 1", len(report.LostCredentials()))
	}
	if code != exitError {
		t.Fatalf("exit = %d, want %d: a run that lost its credential measured two refusals, not the branch", code, exitError)
	}
}

func TestCredentialCheckNamesWhatItCouldNotVerify(t *testing.T) {
	candidate := newTestServer(t, selfDestructSpec, (&selfDestructInstance{}).routes())
	base := newTestServer(t, selfDestructSpec, (&selfDestructInstance{}).routes())

	_, report := probeJSONReport(t, "-a", candidate.URL, "-b", base.URL)

	// This spec declares no bearer scheme, so nothing reads the organization
	// key. That must be said rather than assumed healthy.
	check, ok := credentialCheckFor(report, "organization key")
	if !ok {
		t.Fatal("no credential check for the organization key")
	}
	if !check.Unverifiable || check.Healthy() {
		t.Fatalf("organization key check = %+v, want unverifiable", check)
	}
	if !strings.Contains(check.Note, "cannot tell whether it survived") {
		t.Errorf("note %q does not say the run could not tell", check.Note)
	}
}
