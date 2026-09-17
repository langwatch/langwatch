package dashboard

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func logServer(t *testing.T) (*Server, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "project"), 0700); err != nil {
		t.Fatal(err)
	}
	return New(Config{LogDir: root, Stacks: func() []domain.Stack { return []domain.Stack{{Slug: "project"}} }}), root
}
func writeLog(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
}
func requestLogs(s *Server, query string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	s.handleLogs(recorder, httptest.NewRequest(http.MethodGet, "/api/logs?"+query, nil))
	return recorder
}

// @scenario "The web dashboard reads bounded captured logs for a registered stack"
func TestWebLogTail(t *testing.T) {
	s, root := logServer(t)
	var body strings.Builder
	start := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	for i := range 1200 {
		fmt.Fprintf(&body, "%s {\"level\":\"error\",\"msg\":\"message %d\"}\n", start.Add(time.Duration(i)*time.Second).Format(time.RFC3339Nano), i)
	}
	writeLog(t, filepath.Join(root, "project", "api.log"), body.String()+"2026-09-15T11:00:00Z incomplete")
	writeLog(t, filepath.Join(root, "project", "mail.log"), "2026-09-15T10:15:00Z mail accepted\n")
	response := requestLogs(s, "stack=project")
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %v", response.Code, response.Header())
	}
	var data struct {
		Lines    []logLine `json:"lines"`
		Services []string  `json:"services"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Lines) != 1000 || len(data.Services) != 2 {
		t.Fatalf("%d lines, %v services", len(data.Lines), data.Services)
	}
	for i, line := range data.Lines {
		if strings.Contains(line.Text, "incomplete") {
			t.Fatal("partial line returned")
		}
		if i > 0 && line.At.Before(data.Lines[i-1].At) {
			t.Fatal("not ordered")
		}
	}
	response = requestLogs(s, "stack=project&service=mail")
	if err := json.Unmarshal(response.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Lines) != 1 || data.Lines[0].Text != "mail accepted" {
		t.Fatal(data.Lines)
	}
}

// @scenario "Web log requests cannot read outside registered captures"
func TestWebLogBoundaries(t *testing.T) {
	s, root := logServer(t)
	outside := filepath.Join(t.TempDir(), "secret.log")
	writeLog(t, outside, "2026-09-15T10:00:00Z private file\n")
	if err := os.Symlink(outside, filepath.Join(root, "project", "escape.log")); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{"stack=missing", "stack=..%2Foutside", "stack=project&service=..%2Fsecret", "stack=project&service=escape"} {
		response := requestLogs(s, query)
		if strings.Contains(response.Body.String(), "private file") {
			t.Fatalf("leak for %s", query)
		}
		if !strings.HasPrefix(query, "stack=project") && response.Code != http.StatusNotFound {
			t.Fatal(response.Code)
		}
	}
	if err := os.Remove(filepath.Join(root, "project", "escape.log")); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(root, "project")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Dir(outside), filepath.Join(root, "project")); err != nil {
		t.Fatal(err)
	}
	if response := requestLogs(s, "stack=project"); response.Code != http.StatusBadRequest {
		t.Fatalf("symlink dir accepted: %d", response.Code)
	}
}
