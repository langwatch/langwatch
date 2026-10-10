package apidiff

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// rolesFake is an in-memory /api/roles with switches for the ways a real
// handler loses an effect.
type rolesFake struct {
	mu            sync.Mutex
	roles         map[string]map[string]any
	dropName      bool // stores the role without the name it was sent
	ignoreUpdate  bool // answers the update 200 and changes nothing
	keepOnDelete  bool // answers the delete 200 and keeps the role
	nextID        int
	createdPrefix string
}

func (fake *rolesFake) server(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/roles", func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(request.Body).Decode(&body)
		fake.mu.Lock()
		defer fake.mu.Unlock()
		fake.nextID++
		id := fake.createdPrefix + string(rune('0'+fake.nextID))
		role := map[string]any{"id": id, "permissions": body["permissions"], "createdAt": time.Now().String()}
		if !fake.dropName {
			role["name"] = body["name"]
		}
		fake.roles[id] = role
		writeRoundTripJSON(writer, 201, map[string]any{"role": role})
	})
	mux.HandleFunc("GET /api/roles", func(writer http.ResponseWriter, _ *http.Request) {
		fake.mu.Lock()
		defer fake.mu.Unlock()
		list := make([]any, 0, len(fake.roles))
		for _, role := range fake.roles {
			list = append(list, role)
		}
		writeRoundTripJSON(writer, 200, map[string]any{"data": list})
	})
	mux.HandleFunc("GET /api/roles/{id}", func(writer http.ResponseWriter, request *http.Request) {
		fake.mu.Lock()
		defer fake.mu.Unlock()
		role, ok := fake.roles[request.PathValue("id")]
		if !ok {
			writeRoundTripJSON(writer, 404, map[string]any{"error": "not found"})
			return
		}
		writeRoundTripJSON(writer, 200, role)
	})
	mux.HandleFunc("PATCH /api/roles/{id}", func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(request.Body).Decode(&body)
		fake.mu.Lock()
		defer fake.mu.Unlock()
		if !fake.ignoreUpdate {
			fake.roles[request.PathValue("id")]["name"] = body["name"]
		}
		writeRoundTripJSON(writer, 200, fake.roles[request.PathValue("id")])
	})
	mux.HandleFunc("DELETE /api/roles/{id}", func(writer http.ResponseWriter, request *http.Request) {
		fake.mu.Lock()
		defer fake.mu.Unlock()
		if !fake.keepOnDelete {
			delete(fake.roles, request.PathValue("id"))
		}
		writeRoundTripJSON(writer, 200, map[string]any{"success": true})
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func writeRoundTripJSON(writer http.ResponseWriter, status int, body any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(body)
}

func newRolesFake(prefix string) *rolesFake {
	return &rolesFake{roles: map[string]map[string]any{}, createdPrefix: prefix}
}

// walkRoles runs the roles round trip against two fakes.
func walkRoles(t *testing.T, candidate, base *rolesFake) ([]Effect, []Finding) {
	t.Helper()
	engine := &probeEngine{
		ctx: context.Background(), client: &http.Client{Timeout: 5 * time.Second},
		options:  ProbeOptions{A: candidate.server(t).URL, B: base.server(t).URL, SettleTimeout: 50 * time.Millisecond},
		symbolsA: NewSymbolTable(), symbolsB: NewSymbolTable(),
		credsA: sideCredentials{}, credsB: sideCredentials{},
	}
	operations := []Operation{
		{Method: http.MethodPost, Path: "/api/roles", InA: true, InB: true},
		{Method: http.MethodPatch, Path: "/api/roles/{id}", OperationID: "updateRole", InA: true, InB: true},
	}
	findings := engine.roundTripPass(operations)
	return engine.effects, findings
}

func effectOf(t *testing.T, effects []Effect, step string) Effect {
	t.Helper()
	for index := range effects {
		if effects[index].Resource == "/api/roles" && effects[index].Step == step {
			return effects[index]
		}
	}
	t.Fatalf("no %s effect in %+v", step, effects)
	return Effect{}
}

// @scenario "A round trip that works on both sides is recorded ok per step"
func TestRoundTripWorksOnBothSides(t *testing.T) {
	effects, findings := walkRoles(t, newRolesFake("ra"), newRolesFake("rb"))
	if len(findings) != 0 {
		t.Fatalf("findings = %+v, want none", findings)
	}
	for _, step := range roundTripSteps {
		effect := effectOf(t, effects, step)
		if effect.A.Effect != effectOK || effect.B.Effect != effectOK {
			t.Errorf("%s = %+v, want ok on both sides", step, effect)
		}
	}
}

// @scenario "A round trip's read-back differs on the branch"
func TestRoundTripReadBackDiffersOnTheBranch(t *testing.T) {
	candidate := newRolesFake("ra")
	candidate.dropName = true
	effects, findings := walkRoles(t, candidate, newRolesFake("rb"))
	read := effectOf(t, effects, stepRead)
	if read.A.Effect != effectBroken || !strings.Contains(read.A.Detail, "/name") {
		t.Fatalf("read = %+v, want broken naming /name", read)
	}
	if len(findings) == 0 || findings[0].Kind != FindingEffectBroken || findings[0].Case != "round-trip read" {
		t.Fatalf("findings = %+v, want effect_broken for the read", findings)
	}
}

// @scenario "An update the branch answers but never applies is broken"
func TestRoundTripUpdateNotVisible(t *testing.T) {
	candidate := newRolesFake("ra")
	candidate.ignoreUpdate = true
	effects, findings := walkRoles(t, candidate, newRolesFake("rb"))
	if update := effectOf(t, effects, stepUpdate); update.A.Effect != effectBroken || update.B.Effect != effectOK {
		t.Fatalf("update = %+v, want broken on the candidate only", update)
	}
	if len(findings) != 1 || findings[0].Path != "/api/roles/{id}" || findings[0].OperationID != "updateRole" {
		t.Fatalf("findings = %+v, want one attributed to PATCH /api/roles/{id}", findings)
	}
}

// @scenario "A delete that leaves the entity readable is broken on both sides alike"
func TestRoundTripDeleteKeptOnBothSidesIsNotAFinding(t *testing.T) {
	candidate, base := newRolesFake("ra"), newRolesFake("rb")
	candidate.keepOnDelete, base.keepOnDelete = true, true
	effects, findings := walkRoles(t, candidate, base)
	if gone := effectOf(t, effects, stepGone); gone.A.Effect != effectBroken || gone.B.Effect != effectBroken {
		t.Fatalf("gone = %+v, want broken on both", gone)
	}
	if len(findings) != 0 {
		t.Fatalf("findings = %+v, want none: broken on main too is not a regression", findings)
	}
	if verdict, _ := roundTripVerdict(effects); verdict != verdictBrokenBoth {
		t.Fatalf("verdict = %s, want broken-both", verdict)
	}
}

func TestSubsetDiff(t *testing.T) {
	cases := []struct {
		name      string
		sent, got string
		want      string
	}{
		{"extra fields read back", `{"name":"a"}`, `{"name":"a","extra":1}`, ""},
		{"volatile key masked", `{"name":"a","evaluatorId":"x"}`, `{"name":"a","evaluatorId":"y"}`, ""},
		{"number types agree", `{"n":3}`, `{"n":3.0}`, ""},
		{"array element found", `{"p":["a"]}`, `{"p":["b","a"]}`, ""},
		{"missing key", `{"name":"a"}`, `{}`, "/name: sent, not read back"},
		{"changed value", `{"c":{"k":"a"}}`, `{"c":{"k":"b"}}`, `/c/k: sent`},
		{"missing element", `{"p":["a"]}`, `{"p":["b"]}`, "/p/0: sent"},
	}
	for _, testCase := range cases {
		sent, _ := decodeJSONBody(testCase.sent)
		got, _ := decodeJSONBody(testCase.got)
		detail := subsetDiff("", sent, got)
		if (testCase.want == "") != (detail == "") || !strings.HasPrefix(detail, testCase.want) {
			t.Errorf("%s: subsetDiff = %q, want prefix %q", testCase.name, detail, testCase.want)
		}
	}
}

// @scenario "verdict.md opens with one line per round trip"
func TestWriteVerdict(t *testing.T) {
	effects := []Effect{
		{Resource: "/api/roles", Step: stepCreate, Method: "POST", Path: "/api/roles", A: EffectSide{Effect: effectOK}, B: EffectSide{Effect: effectOK}},
		{Resource: "/api/roles", Step: stepRead, Method: "GET", Path: "/api/roles/{id}",
			A: EffectSide{Effect: effectBroken, Detail: "/name: sent, not read back"}, B: EffectSide{Effect: effectOK}},
		{Resource: "/api/agents", Step: stepCreate, Method: "POST", Path: "/api/agents", A: EffectSide{Effect: effectOK}, B: EffectSide{Effect: effectOK}},
	}
	var output bytes.Buffer
	if err := WriteVerdict(&output, Report{Effects: effects, Differences: 1}, 2); err != nil {
		t.Fatal(err)
	}
	text := output.String()
	for _, want := range []string{
		"- broken /api/roles\n  first failure: read GET /api/roles/{id}; candidate broken (/name: sent, not read back); base ok\n",
		"- works /api/agents\n",
		"failing findings: 1",
		"new on the candidate: 2",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("verdict.md lacks %q:\n%s", want, text)
		}
	}
}

// @scenario "signatures.md lists new-on-candidate log signatures first"
func TestLogSignatures(t *testing.T) {
	dir := t.TempDir()
	branch := `{"level":50,"name":"api","msg":"refused 123 rows","err":{"message":"boom"}}
{"level":30,"msg":"fine"}
2026-09-29T14:41:38.337Z [worker] WARN queue lag 450ms
{"level":"warn","name":"api","msg":"shared warning"}
`
	main := `{"level":"warn","name":"api","msg":"shared warning"}
{"level":60,"name":"api","msg":"main only"}
`
	for name, content := range map[string]string{"branch.log": branch, "main-worker.log": main, "teardown.log": "ERROR ignored\n"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	signatures, err := ScanLogSignatures(dir)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	newCount, err := WriteSignatures(&output, signatures)
	if err != nil {
		t.Fatal(err)
	}
	text := output.String()
	if newCount != 2 {
		t.Errorf("new = %d, want 2:\n%s", newCount, text)
	}
	newSection, rest, _ := strings.Cut(text, "## Also on base")
	for _, want := range []string{"1/0 error branch.log:1 | api: refused # rows | boom", "1/0 warn branch.log:3 | WARN queue lag #"} {
		if !strings.Contains(newSection, want) {
			t.Errorf("new section lacks %q:\n%s", want, text)
		}
	}
	if !strings.Contains(rest, "1/1 warn") || !strings.Contains(rest, "0/1 fatal") || strings.Contains(text, "ignored") {
		t.Errorf("shared, base-only or teardown lines misfiled:\n%s", text)
	}
}
