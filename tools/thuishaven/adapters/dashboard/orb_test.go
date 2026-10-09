package dashboard

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/orbstore"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

const orbAppOrigin = "https://app.feat-x.langwatch.localhost:1355"

func orbServer(t *testing.T) (*Server, orbstore.Store) {
	t.Helper()
	logDir := t.TempDir()
	server := New(Config{
		LogDir: func(string) string { return logDir },
		Stacks: func() []domain.Stack {
			return []domain.Stack{{
				Slug: "feat-x", Branch: "feat/x",
				Services: []domain.Service{{Name: "mail", URL: "https://mail.feat-x.langwatch.localhost:1355"}},
			}}
		},
		SharedURL: func(service string) string {
			if service == "langwatch" {
				return "https://langwatch.localhost:1355"
			}
			return "https://" + service + ".langwatch.localhost:1355"
		},
	})
	return server, orbstore.At(logDir)
}

type orbCall struct {
	method, path, origin, body string
}

func (c orbCall) on(s *Server) *httptest.ResponseRecorder {
	req := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
	req.Header.Set("Content-Type", "application/json")
	if c.origin != "" {
		req.Header.Set("Origin", c.origin)
	}
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, req)
	return rec
}

const pickedFeedback = `{"note":"button sits off-center","url":"` + orbAppOrigin + `/p","route":"/p",
"viewport":{"width":1280,"height":800},
"target":{"selector":"main > button","tag":"button","box":{"x":1,"y":2,"width":3,"height":4}},
"console":[{"level":"error","text":"boom","at":"2026-10-09T10:00:00Z"}],"network":[]}`

// @scenario "feedback on a picked element reaches haven"
func TestOrbFeedbackFromTheAppOriginIsStored(t *testing.T) {
	server, store := orbServer(t)
	rec := orbCall{http.MethodPost, "/api/stacks/feat-x/orb/feedback", orbAppOrigin, pickedFeedback}.on(server)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != orbAppOrigin {
		t.Fatalf("allowed origin %q", got)
	}
	items, err := store.List()
	if err != nil || len(items) != 1 || items[0].Target == nil {
		t.Fatalf("stored %+v, %v", items, err)
	}
	if items[0].Target.Selector != "main > button" || items[0].Console[0].Text != "boom" || items[0].Viewport.Width != 1280 {
		t.Fatalf("stored %+v", items[0])
	}
}

// @scenario "haven refuses orb posts from another origin"
func TestOrbFeedbackFromAnotherOriginIsRefused(t *testing.T) {
	server, store := orbServer(t)
	origins := []string{"", "https://evil.example", "https://app.other.langwatch.localhost:1355", "https://feat-x.langwatch.localhost:1355"}
	for _, origin := range origins {
		rec := orbCall{http.MethodPost, "/api/stacks/feat-x/orb/feedback", origin, pickedFeedback}.on(server)
		if rec.Code != http.StatusForbidden || rec.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("origin %q: status %d", origin, rec.Code)
		}
	}
	if items, _ := store.List(); len(items) != 0 {
		t.Fatalf("stored %d items from foreign origins", len(items))
	}
}

func TestOrbPreflightAnswersOnlyTheAppOrigin(t *testing.T) {
	server, _ := orbServer(t)
	for _, path := range []string{"/api/stacks/feat-x/orb/page", "/api/stacks/feat-x/orb"} {
		if rec := (orbCall{http.MethodOptions, path, orbAppOrigin, ""}).on(server); rec.Code != http.StatusNoContent {
			t.Fatalf("app origin preflight %s: %d", path, rec.Code)
		}
	}
	if rec := (orbCall{http.MethodOptions, "/api/stacks/feat-x/orb/page", "https://evil.example", ""}).on(server); rec.Code != http.StatusForbidden {
		t.Fatalf("foreign preflight: %d", rec.Code)
	}
}

func TestOrbPageKeepsOnlyTheFieldsItsShapeHolds(t *testing.T) {
	server, store := orbServer(t)
	body := `{"url":"/p","console":[],"network":[{"method":"POST","url":"/api/x","status":500,"failed":true,"headers":{"authorization":"Bearer t"},"body":"secret"}]}`
	if rec := (orbCall{http.MethodPost, "/api/stacks/feat-x/orb/page", orbAppOrigin, body}).on(server); rec.Code != http.StatusNoContent {
		t.Fatalf("status %d", rec.Code)
	}
	page, err := store.Page()
	if err != nil || len(page.Network) != 1 || page.Network[0].Status != 500 {
		t.Fatalf("page %+v, %v", page, err)
	}
}

// @scenario "the panel lists the stack's facts and consoles"
func TestOrbFactsLinkTheHubAndTheStackLogs(t *testing.T) {
	server, _ := orbServer(t)
	rec := orbCall{http.MethodGet, "/api/stacks/feat-x/orb", orbAppOrigin, ""}.on(server)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"https://hub.langwatch.localhost:1355/logs/feat-x"`) {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), `"https://mail.feat-x.langwatch.localhost:1355"`) || !strings.Contains(rec.Body.String(), `"branch":"feat/x"`) {
		t.Fatalf("facts miss the mail console or branch: %s", rec.Body)
	}
}
