package apidiff

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func newCredentialEngine(a, b string) *probeEngine {
	return &probeEngine{
		ctx: context.Background(), client: http.DefaultClient,
		options: ProbeOptions{A: a, B: b, Keys: Keys{
			ProjectKey: "project-key", WidgetProjectKey: WidgetProjectKey,
			LangyInternalSecret: "langy-secret", GatewayInternalSecret: "gateway-secret",
		}},
		symbolsA: NewSymbolTable(), symbolsB: NewSymbolTable(),
		credsA: sideCredentials{}, credsB: sideCredentials{},
	}
}

func TestSideHeadersSendEachSideItsOwnMintedCredential(t *testing.T) {
	engine := newCredentialEngine("http://127.0.0.1:1", "http://127.0.0.1:2")
	engine.credsA[credCLIToken], engine.credsB[credCLIToken] = "token-a", "token-b"
	engine.credsA[credLangySession], engine.credsB[credLangySession] = "session-a", "session-b"
	engine.credsA[credLangyInstance] = "instance-a"
	engine.credsA[credSessionCookie] = "better-auth.session_token=a"
	shared := map[string]string{"X-Auth-Token": "project-key"}

	cases := []struct {
		path         string
		header, a, b string
	}{
		{"/api/auth/cli/governance/status", "Authorization", "Bearer token-a", "Bearer token-b"},
		{"/api/langy/control/connect/register", "Authorization", "Bearer session-a", "Bearer session-b"},
		{"/api/langy/control/connect/poll", instanceTokenHeader, "instance-a", ""},
		{"/api/internal/langy/turn/{turnId}/result", "Authorization", "Bearer langy-secret", "Bearer langy-secret"},
		{"/api/projects/{projectId}/analytics/dashboard-widgets", "X-Auth-Token", WidgetProjectKey, WidgetProjectKey},
		{"/api/auth/cli/approve", "Cookie", "better-auth.session_token=a", ""},
		{"/api/auth/cli/device-code", "X-Auth-Token", "project-key", "project-key"},
	}
	for _, testCase := range cases {
		headersA, headersB := engine.sideHeaders(Operation{Method: http.MethodGet, Path: testCase.path}, shared)
		if headersA[testCase.header] != testCase.a || headersB[testCase.header] != testCase.b {
			t.Errorf("%s: %s = %q / %q, want %q / %q", testCase.path, testCase.header,
				headersA[testCase.header], headersB[testCase.header], testCase.a, testCase.b)
		}
	}
	if origin := sessionHeaders(engine.credsA, "http://127.0.0.1:4000", nil)["Origin"]; origin != "http://localhost:4000" {
		t.Errorf("session origin = %q, want the BASE_HOST form", origin)
	}
}

func TestWidgetRoutesAreRetargetedAtTheWidgetProject(t *testing.T) {
	engine := newCredentialEngine("", "")
	params := resolvedParams{pathValues: map[string]string{"projectId": seededProjectID, "widgetId": "w1"}}
	engine.retargetWidgetProject(Operation{Path: "/api/projects/{projectId}/analytics/dashboard-widgets/{widgetId}"}, &params)
	if params.pathValues["projectId"] != fixtureWidgetProjectID || params.pathValues["widgetId"] != "w1" {
		t.Fatalf("path values = %v", params.pathValues)
	}
	other := resolvedParams{pathValues: map[string]string{"projectId": seededProjectID}}
	engine.retargetWidgetProject(Operation{Path: "/api/projects/{projectId}/analytics/charts"}, &other)
	if other.pathValues["projectId"] != seededProjectID {
		t.Fatalf("a saved-chart route must stay in the seeded project: %v", other.pathValues)
	}
}

func TestMintCLISessionWalksTheDeviceFlowPerSide(t *testing.T) {
	var approvedWith, exchangedLabel string
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/sign-in/email", func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(request.Body).Decode(&body)
		if body["email"] != "admin@haven.localhost" || request.Header.Get("Origin") == "" {
			writeJSON(writer, http.StatusUnauthorized, `{}`)
			return
		}
		http.SetCookie(writer, &http.Cookie{Name: "better-auth.session_token", Value: "signed", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode})
		writeJSON(writer, http.StatusOK, `{}`)
	})
	mux.HandleFunc("/api/auth/cli/device-code", func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(writer, http.StatusOK, `{"device_code":"dc","user_code":"UC"}`)
	})
	mux.HandleFunc("/api/auth/cli/approve", func(writer http.ResponseWriter, request *http.Request) {
		approvedWith = request.Header.Get("Cookie")
		writeJSON(writer, http.StatusOK, `{}`)
	})
	mux.HandleFunc("/api/auth/cli/exchange", func(writer http.ResponseWriter, request *http.Request) {
		var body struct {
			ClientInfo struct {
				DeviceLabel string `json:"device_label"`
			} `json:"client_info"`
		}
		_ = json.NewDecoder(request.Body).Decode(&body)
		exchangedLabel = body.ClientInfo.DeviceLabel
		writeJSON(writer, http.StatusOK, `{"access_token":"minted"}`)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	engine := newCredentialEngine(server.URL, server.URL)
	engine.mintCLISession(server.URL, engine.credsA)
	if engine.credsA[credCLIToken] != "minted" || approvedWith != "better-auth.session_token=signed" {
		t.Fatalf("credentials = %v, approved with %q", engine.credsA, approvedWith)
	}
	if exchangedLabel != "apidiff-fixture" {
		t.Errorf("exchange device_label = %q, want the fixture label", exchangedLabel)
	}
}

func TestGatewaySpendIsSignedTheWayTheGatewaySignsIt(t *testing.T) {
	var verified bool
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		bodyHash := sha256.Sum256(body)
		canonical := request.Method + "\n" + request.URL.Path + "\n" + request.Header.Get("X-LangWatch-Gateway-Timestamp") + "\n" + hex.EncodeToString(bodyHash[:])
		mac := hmac.New(sha256.New, []byte("gateway-secret"))
		mac.Write([]byte(canonical))
		verified = hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(request.Header.Get("X-LangWatch-Gateway-Signature"))) &&
			strings.Contains(string(body), `"admitSpend"`) && strings.Contains(string(body), `"confirmSpend"`)
		writeJSON(writer, http.StatusOK, `{"accepted":2,"rejected":0}`)
	}))
	defer server.Close()

	engine := newCredentialEngine(server.URL, server.URL)
	engine.emitGatewaySpend()
	if !verified {
		t.Fatal("the spend batch was not signed over its own bytes")
	}
}

func TestCuratedCreateFilesTheCredentialsItsAnswerCarries(t *testing.T) {
	engine := newCredentialEngine("", "")
	create, ok := curatedFor(Operation{Method: http.MethodPost, Path: "/api/langy/control/requests/{requestId}/approve"})
	if !ok {
		t.Fatal("the approve create is curated")
	}
	engine.afterCurated(probeCase{curated: &create}, Transcript{
		A: SideResult{Status: 200, Body: `{"sessionKey":"key-a"}`},
		B: SideResult{Status: 404, Body: `{"sessionKey":"not-minted"}`},
	})
	if engine.credsA[credLangySession] != "key-a" || engine.credsB[credLangySession] != "" {
		t.Fatalf("credentials = %v / %v", engine.credsA, engine.credsB)
	}
}

func TestPinCreatedHonoursTheCreatesBucketAndField(t *testing.T) {
	symbols := NewSymbolTable()
	create := curatedCreate{bucket: "requestid", idField: "request.id"}
	create.pin(symbols, "/api/langy/control/requests", SideResult{Status: 201,
		Body: `{"command":"x","request":{"conversationId":"conv","id":"req"}}`})
	if got, _ := symbols.latest("requestid"); got != "req" {
		t.Fatalf("requestid = %q, want the nested request id", got)
	}
}

func TestSettleReadWaitsForAProjectionToFill(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) <= 2 {
			writeJSON(writer, http.StatusOK, `{"runs":[],"hasMore":false}`)
			return
		}
		writeJSON(writer, http.StatusOK, `{"runs":[{"scenarioRunId":"r"}],"hasMore":false}`)
	}))
	defer server.Close()
	previous := settledReadWait
	settledReadWait = 20 * time.Second
	defer func() { settledReadWait = previous }()

	engine := newCredentialEngine(server.URL, server.URL)
	operation := Operation{Method: http.MethodGet, Path: "/api/simulation-runs", InA: true, InB: true}
	target := probeTarget{pathA: "/api/simulation-runs", pathB: "/api/simulation-runs"}
	first := engine.runCase(operation, probeCase{name: "read"}, target)
	settled := engine.settleRead(operation, target, first)
	if unsettled(settled) {
		t.Fatalf("read never settled: %+v", settled)
	}
}

func TestEmptyListBodyIsATopLevelListOnly(t *testing.T) {
	cases := map[string]bool{
		`{"runs":[],"hasMore":false}`:              true,
		`{"facets":[],"pending":true}`:             true,
		`[]`:                                       true,
		`{"userId":"u","teams":[]}`:                false,
		`{"id":"s","criteria":[],"labels":[]}`:     false,
		`{"version":1,"snapshot":{"criteria":[]}}`: false,
		`{"data":[{"id":"x"}],"next_cursor":null}`: false,
		`{"events":[],"nextCursor":null}`:          true,
	}
	for body, want := range cases {
		if got := emptyListBody(body); got != want {
			t.Errorf("emptyListBody(%s) = %t, want %t", body, got, want)
		}
	}
}

func TestVersionIDResolvesWithinItsOwnFamily(t *testing.T) {
	symbols := NewSymbolTable()
	symbols.file("workflows/versionid", "workflow-version")
	symbols.file("versionid", "workflow-version")
	symbols.Capture("/api/prompts/{id}/versions", map[string]any{"versionId": "prompt-version"})
	if got, _ := symbols.Lookup("versionId", "/api/workflows/{workflowId}/versions/{versionId}/run"); got != "workflow-version" {
		t.Errorf("workflow route resolved %q", got)
	}
	if got, _ := symbols.Lookup("versionId", "/api/prompts/{id}/versions/{versionId}"); got != "prompt-version" {
		t.Errorf("prompt route resolved %q", got)
	}
}

func TestRunWindowCoversTheRun(t *testing.T) {
	now := time.Date(2026, 9, 27, 15, 0, 0, 0, time.UTC)
	from, to := runWindow(now)
	fromMs, _ := strconv.ParseInt(from, 10, 64)
	toMs, _ := strconv.ParseInt(to, 10, 64)
	if fromMs > now.UnixMilli() || toMs < now.Add(24*time.Hour).UnixMilli() {
		t.Fatalf("window [%s, %s) does not cover the run", from, to)
	}
}
