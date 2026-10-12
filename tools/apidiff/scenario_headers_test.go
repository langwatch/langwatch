package apidiff

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckExpectHeaders(t *testing.T) {
	result := SideResult{Status: 200, Body: "{}", Headers: http.Header{
		"Deprecation": {"true"},
		"Link":        {`</api/grants>; rel="successor-version"`},
	}}
	held := scenarioExpect{Status: intList{200}, Headers: map[string]string{"deprecation": "true", "Link": "/api/grants"}}
	if detail := checkExpect(held, result); detail != "" {
		t.Fatalf("headers that hold failed: %s", detail)
	}
	missing := scenarioExpect{Status: intList{200}, Headers: map[string]string{"X-Idempotent-Replay": "true"}}
	if detail := checkExpect(missing, result); !strings.Contains(detail, "X-Idempotent-Replay") {
		t.Fatalf("a missing header held: %q", detail)
	}
	if missing.empty() {
		t.Fatal("an expect with only headers reads as empty")
	}
}

func TestLoadScenarioFileReadsExpectHeaders(t *testing.T) {
	path := filepath.Join(t.TempDir(), "headers.yaml")
	body := "- id: h\n  endpoint: GET /api/x\n  request: {path: /api/x}\n  expect: {status: 200, headers: {Deprecation: \"true\"}}\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := loadScenarioFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := loaded[0].Expect.Headers["Deprecation"]; got != "true" {
		t.Fatalf("headers not read: %q", got)
	}
}
