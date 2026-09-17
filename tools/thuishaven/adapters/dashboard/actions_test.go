package dashboard

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// actionServer is a Server over one live stack, with whichever actions the test
// wants wired.
func actionServer(actions Actions) *Server {
	return New(Config{
		Stacks: func() []domain.Stack {
			return []domain.Stack{{Slug: "portless", WorktreeDir: "/repos/wt/portless", LauncherPID: 42}}
		},
		SharedURL: func(svc string) string { return "https://" + svc + ".langwatch.localhost" },
		Actions:   actions,
	})
}

// post issues one action request, with the headers a browser on this page sends.
func post(s *Server, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, req)
	return rec
}

// @scenario "A running stack can be restarted from the dashboard"
func TestRestartFromTheBrowser(t *testing.T) {
	t.Run("given a live stack and a wired restart", func(t *testing.T) {
		var got [2]string
		s := actionServer(Actions{Restart: func(slug, service string) (string, error) {
			got = [2]string{slug, service}
			return "app bounced", nil
		}})

		t.Run("when the button posts", func(t *testing.T) {
			rec := post(s, "/api/stacks/portless/restart", "")
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
			}
			if got[0] != "portless" {
				t.Errorf("restarted %q, want portless", got[0])
			}
			if !strings.Contains(rec.Body.String(), "app bounced") {
				t.Errorf("the answer should carry what happened, got %s", rec.Body)
			}
		})

		t.Run("when a stack nobody registered is named", func(t *testing.T) {
			if rec := post(s, "/api/stacks/nosuch/restart", ""); rec.Code != http.StatusNotFound {
				t.Errorf("status = %d, want 404", rec.Code)
			}
		})
	})

	t.Run("given a haven built without the action", func(t *testing.T) {
		if rec := post(actionServer(Actions{}), "/api/stacks/portless/restart", ""); rec.Code != http.StatusNotImplemented {
			t.Errorf("status = %d, want 501", rec.Code)
		}
	})
}

// @scenario "A worktree with nothing running can be started from the dashboard"
func TestStartFromTheBrowser(t *testing.T) {
	t.Run("given a wired start", func(t *testing.T) {
		var asked string
		s := actionServer(Actions{Start: func(dir string) error { asked = dir; return nil }})

		t.Run("when a worktree is started", func(t *testing.T) {
			rec := post(s, "/api/worktrees/start", `{"dir":"/repos/wt/other"}`)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
			}
			if asked != "/repos/wt/other" {
				t.Errorf("started %q", asked)
			}
		})

		t.Run("when no directory is named", func(t *testing.T) {
			if rec := post(s, "/api/worktrees/start", `{}`); rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", rec.Code)
			}
		})
	})
}

// @scenario "Only the dashboard's own page may take a lifecycle action"
func TestActionsRefuseAnotherOrigin(t *testing.T) {
	s := actionServer(Actions{
		Restart: func(string, string) (string, error) { t.Fatal("must not run"); return "", nil },
		Start:   func(string) error { t.Fatal("must not run"); return nil },
	})

	t.Run("given a request from a page on another site", func(t *testing.T) {
		for _, path := range []string{"/api/stacks/portless/restart", "/api/worktrees/start"} {
			req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"dir":"/x"}`))
			req.Header.Set("Sec-Fetch-Site", "cross-site")
			req.Header.Set("Origin", "https://evil.example")
			rec := httptest.NewRecorder()
			s.routes().ServeHTTP(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Errorf("%s: status = %d, want 403", path, rec.Code)
			}
		}
	})

	t.Run("given a request that says nothing about where it came from", func(t *testing.T) {
		// Refused rather than trusted: a bare cross-origin POST from a page
		// carries no Origin for a simple request, and "no header" is exactly
		// what an attacker's request looks like.
		req := httptest.NewRequest(http.MethodPost, "/api/worktrees/start", strings.NewReader(`{"dir":"/x"}`))
		rec := httptest.NewRecorder()
		s.routes().ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
	})

	t.Run("given a GET", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/stacks/portless/restart", nil)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		rec := httptest.NewRecorder()
		s.routes().ServeHTTP(rec, req)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("status = %d, want 405", rec.Code)
		}
	})
}

// @scenario "A running stack can be restarted from the dashboard"
func TestButtonsAppearOnlyWhenWired(t *testing.T) {
	stacks := []domain.Stack{{Slug: "portless", WorktreeDir: "/repos/wt/portless", LauncherPID: 42}}
	in := renderInputs{
		sharedURL: func(svc string) string { return "https://" + svc + ".langwatch.localhost" },
		probes:    Probes{ProcessAlive: func(int) bool { return true }},
		extras:    Extras{Worktrees: []WorktreeView{{Slug: "idle", Dir: "/repos/wt/idle", Branch: "main"}}},
	}

	t.Run("given a haven with no actions wired", func(t *testing.T) {
		page := renderHTML(stacks, in)
		// The attribute with a value is a rendered button; the bare word also
		// appears in the page's own script, which is always present.
		for _, marker := range []string{`data-restart="`, `data-start="`} {
			if strings.Contains(page, marker) {
				t.Errorf("a button nothing is wired to would answer every press with a refusal: %s", marker)
			}
		}
	})

	t.Run("given both actions wired", func(t *testing.T) {
		wired := in
		wired.canRestart, wired.canStart = true, true
		page := renderHTML(stacks, wired)
		if !strings.Contains(page, `data-restart="portless"`) {
			t.Error("a live stack offers restart")
		}
		if !strings.Contains(page, `data-start="/repos/wt/idle"`) {
			t.Error("an idle worktree offers start")
		}
	})

	t.Run("given a stack whose launcher is gone", func(t *testing.T) {
		stale := in
		stale.canRestart = true
		stale.probes = Probes{ProcessAlive: func(int) bool { return false }}
		if strings.Contains(renderHTML(stacks, stale), `data-restart="`) {
			t.Error("bouncing a stack with no launcher would find nothing to signal — that one is started, not restarted")
		}
	})
}
