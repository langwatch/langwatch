package dashboard

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/orbstore"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestOrbReadsAndResolveFromTheConsole(t *testing.T) {
	root := t.TempDir()
	logDir := func(slug string) string { return filepath.Join(root, slug) }
	store := orbstore.At(logDir("project"))
	item, err := store.Add(orbstore.Report{Note: "button is cut off", Page: orbstore.Page{
		Console: []orbstore.ConsoleEntry{{Level: "error", Text: "boom"}},
	}}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SavePage(orbstore.Page{Network: []orbstore.Request{{Method: "GET", URL: "/api/x", Status: 500, Failed: true}}}); err != nil {
		t.Fatal(err)
	}
	s := New(Config{
		LogDir:    logDir,
		Stacks:    func() []domain.Stack { return []domain.Stack{{Slug: "project"}} },
		SharedURL: func(string) string { return "" },
	})

	var feedback struct {
		Rows []orbstore.Feedback `json:"rows"`
	}
	if err := json.Unmarshal(getCLIRead(s, "/api/stacks/project/cli/feedback").Body.Bytes(), &feedback); err != nil {
		t.Fatal(err)
	}
	if len(feedback.Rows) != 1 || feedback.Rows[0].Note != "button is cut off" || !feedback.Rows[0].Open() {
		t.Fatalf("%+v", feedback)
	}
	if body := getCLIRead(s, "/api/stacks/project/cli/network").Body.String(); !json.Valid([]byte(body)) || len(body) < 20 {
		t.Fatalf("network read: %s", body)
	}

	resolve := func(site string) int {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/stacks/project/feedback/"+item.ID+"/resolve", nil)
		request.Header.Set("Sec-Fetch-Site", site)
		s.routes().ServeHTTP(recorder, request)
		return recorder.Code
	}
	if code := resolve("cross-site"); code != http.StatusForbidden {
		t.Fatalf("a cross-site resolve answered %d", code)
	}
	if code := resolve("same-origin"); code != http.StatusOK {
		t.Fatalf("resolve answered %d", code)
	}
	got, err := store.Get(item.ID)
	if err != nil || got.Open() {
		t.Fatalf("still open: %+v %v", got, err)
	}
}
