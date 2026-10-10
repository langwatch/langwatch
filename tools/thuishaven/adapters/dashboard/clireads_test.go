package dashboard

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func cliReadServer() *Server {
	return New(Config{
		Stacks:    func() []domain.Stack { return []domain.Stack{{Slug: "project"}} },
		SharedURL: func(string) string { return "https://hub.langwatch.localhost" },
		CLIReads: map[string]CLIRead{
			"sims":   func(slug string) (any, error) { return []map[string]any{{"name": "mail", "stack": slug}}, nil },
			"stores": func(string) (any, error) { return nil, errors.New("prometheus is down") },
		},
	})
}

func getCLIRead(s *Server, path string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	s.routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	return recorder
}

func TestCLIReadAnswersTheEnvelope(t *testing.T) {
	response := getCLIRead(cliReadServer(), "/api/stacks/project/cli/sims")
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %v", response.Code, response.Header())
	}
	var body struct {
		V     int              `json:"v"`
		Stack string           `json:"stack"`
		Rows  []map[string]any `json:"rows"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.V != 1 || body.Stack != "project" || len(body.Rows) != 1 || body.Rows[0]["stack"] != "project" {
		t.Fatalf("%+v", body)
	}
}

func TestCLIReadRefusesUnknownNamesAndStacks(t *testing.T) {
	s := cliReadServer()
	unknown := getCLIRead(s, "/api/stacks/project/cli/nope")
	var refusal cliReadErrorJSON
	if err := json.Unmarshal(unknown.Body.Bytes(), &refusal); err != nil {
		t.Fatal(err)
	}
	if unknown.Code != http.StatusNotFound || len(refusal.Valid) != 2 || refusal.Valid[0] != "sims" {
		t.Fatalf("%d %+v", unknown.Code, refusal)
	}
	if code := getCLIRead(s, "/api/stacks/other/cli/sims").Code; code != http.StatusNotFound {
		t.Fatalf("unknown stack answered %d", code)
	}
	if code := getCLIRead(s, "/api/stacks/project/cli/stores").Code; code != http.StatusBadGateway {
		t.Fatalf("a failed read answered %d", code)
	}
}
