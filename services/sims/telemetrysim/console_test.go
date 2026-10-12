package telemetrysim

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type consoleTestSender func(d delivery) int

func (f consoleTestSender) send(_ context.Context, d delivery) (answer, error) {
	return answer{status: f(d)}, nil
}

func consoleRequest(t *testing.T, s *Server, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
	return rec
}

func TestRunWithoutEndpointUsesTheConfiguredDoorAndIsRemembered(t *testing.T) {
	s := NewServer(Config{Stack: "feat-x", Endpoint: "http://door.test/api/otel", APIKey: "sk-test"})
	var got delivery
	s.sender = consoleTestSender(func(d delivery) int { got = d; return http.StatusOK })

	for range 2 {
		rec := consoleRequest(t, s, http.MethodPost, "/_sim/api/runs", `{"mode":"send","preset":"llm-trace","seed":7}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("send answered %d: %s", rec.Code, rec.Body.String())
		}
	}
	if got.url != "http://door.test/api/otel/v1/traces" || got.apiKey != "sk-test" {
		t.Fatalf("sent to %q with key %q", got.url, got.apiKey)
	}

	rec := consoleRequest(t, s, http.MethodGet, "/_sim/api/status", "")
	if strings.Contains(rec.Body.String(), "sk-test") {
		t.Fatal("the status leaks the configured key")
	}
	var st Status
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st.Run == nil || len(st.Recent) != 1 || st.Recent[0].Seed != 7 || st.Endpoint != "http://door.test/api/otel" {
		t.Fatalf("status = %+v", st)
	}
}

func TestConsoleServesEveryPathTheAPIDoesNotTake(t *testing.T) {
	rec := consoleRequest(t, NewServer(Config{}), http.MethodGet, "/", "")
	if rec.Code == http.StatusNotFound || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("GET / answered %d with headers %v", rec.Code, rec.Header())
	}
}
