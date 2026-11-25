package httpapi

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// The engine runs workflow nodes, including user-authored Python, for whichever
// project the request body names, and authenticates no project itself. These
// tests pin the one thing that keeps that safe at the application level: a
// request without the secret shared with the LangWatch app never reaches the
// engine at all.
//
// countingExecutor is what makes the refusal provable rather than inferred. A
// status assertion alone would still pass if the middleware ran the workflow
// and then wrote a 401 over the result.
type countingExecutor struct {
	calls       int
	streamCalls int
}

func (c *countingExecutor) Execute(context.Context, app.WorkflowRequest) (*app.WorkflowResult, error) {
	c.calls++
	return &app.WorkflowResult{}, nil
}

func (c *countingExecutor) ExecuteStream(context.Context, app.WorkflowRequest, app.WorkflowStreamOptions) (<-chan app.WorkflowStreamEvent, error) {
	c.streamCalls++
	events := make(chan app.WorkflowStreamEvent)
	close(events)
	return events, nil
}

func newGuardedRouter(secret string) (http.Handler, *countingExecutor) {
	exec := &countingExecutor{}
	return NewRouter(RouterDeps{
		App:            app.New(app.WithWorkflowExecutor(exec)),
		Health:         health.New("test"),
		Version:        "test",
		InternalSecret: secret,
	}), exec
}

// executeSyncBody is the smallest payload the sync handler parses. The point of
// these tests is which requests reach the engine, so the payload only has to
// get past decoding.
const executeSyncBody = `{"type":"execute_flow","payload":{"trace_id":"t","workflow":{"nodes":[],"edges":[]},"inputs":[{}]}}`

func postExecuteSync(t *testing.T, router http.Handler, header, value string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/go/studio/execute_sync", bytes.NewBufferString(executeSyncBody))
	req.Header.Set("Content-Type", "application/json")
	if header != "" {
		req.Header.Set(header, value)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// @scenario "a request with no secret header is refused"
func TestRequireInternalSecret_RefusesRequestWithNoHeader(t *testing.T) {
	router, exec := newGuardedRouter("s3cret")

	rec := postExecuteSync(t, router, "", "")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d; want 401 for a caller presenting no secret, body: %q", rec.Code, rec.Body.String())
	}
	if exec.calls != 0 {
		t.Errorf("the workflow executed %d time(s); a refused request must not reach the engine", exec.calls)
	}
}

// @scenario "a request with the wrong secret is refused"
func TestRequireInternalSecret_RefusesRequestWithWrongSecret(t *testing.T) {
	router, exec := newGuardedRouter("s3cret")

	rec := postExecuteSync(t, router, InternalSecretHeader, "not-the-secret")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d; want 401 for a wrong secret, body: %q", rec.Code, rec.Body.String())
	}
	if exec.calls != 0 {
		t.Errorf("the workflow executed %d time(s); a refused request must not reach the engine", exec.calls)
	}
}

// @scenario "a request carrying the configured secret is served"
func TestRequireInternalSecret_ServesRequestCarryingTheSecret(t *testing.T) {
	router, exec := newGuardedRouter("s3cret")

	rec := postExecuteSync(t, router, InternalSecretHeader, "s3cret")

	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("status = 401 for the configured secret; body: %q", rec.Body.String())
	}
	if exec.calls != 1 {
		t.Errorf("the workflow executed %d time(s); want exactly 1", exec.calls)
	}
}

// @scenario "the streaming execution route is guarded too"
func TestRequireInternalSecret_GuardsTheStreamingRoute(t *testing.T) {
	router, exec := newGuardedRouter("s3cret")

	req := httptest.NewRequest(http.MethodPost, "/go/studio/execute", bytes.NewBufferString(executeSyncBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d; want 401, body: %q", rec.Code, rec.Body.String())
	}
	if exec.streamCalls != 0 {
		t.Errorf("the stream started %d time(s); a refused request must not reach the engine", exec.streamCalls)
	}
}

// @scenario "the playground proxy route is guarded too"
func TestRequireInternalSecret_GuardsTheProxyAndVersionRoutes(t *testing.T) {
	router, _ := newGuardedRouter("s3cret")

	for _, route := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/go/proxy/v1/chat/completions"},
		{http.MethodPost, "/go/proxy/v1beta/models"},
		{http.MethodGet, "/go/version"},
	} {
		req := httptest.NewRequest(route.method, route.path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s = %d; want 401 so no /go route is reachable without the secret",
				route.method, route.path, rec.Code)
		}
	}
}

// @scenario "a probe reaches the engine without the secret"
func TestRequireInternalSecret_LeavesHealthRoutesOpen(t *testing.T) {
	// Kubernetes probes and the compose healthcheck present no secret, and
	// they report liveness only. Guarding them would make a configured
	// install look unhealthy and get its pods restarted forever.
	router, _ := newGuardedRouter("s3cret")

	for _, path := range []string{"/healthz", "/readyz", "/startupz"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code == http.StatusUnauthorized {
			t.Errorf("%s = 401; health routes must stay reachable for probes", path)
		}
	}
}

// @scenario "an unconfigured engine serves a request with no secret header"
func TestRequireInternalSecret_UnconfiguredEngineKeepsServing(t *testing.T) {
	// An install whose configuration predates this variable must keep
	// working across the upgrade rather than lose its NLP service.
	router, exec := newGuardedRouter("")

	rec := postExecuteSync(t, router, "", "")

	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("status = 401 with no secret configured; body: %q", rec.Body.String())
	}
	if exec.calls != 1 {
		t.Errorf("the workflow executed %d time(s); want exactly 1", exec.calls)
	}
}

// @scenario "a request with no secret header is refused"
func TestRequireInternalSecret_RefusalNamesTheHeaderAndNothingElse(t *testing.T) {
	router, _ := newGuardedRouter("s3cret-value-abc")

	rec := postExecuteSync(t, router, "", "")
	body := rec.Body.String()

	if !strings.Contains(body, InternalSecretHeader) {
		t.Errorf("refusal body does not name the header the caller is missing: %q", body)
	}
	if strings.Contains(body, "s3cret-value-abc") {
		t.Errorf("refusal body echoes the configured secret: %q", body)
	}
}
