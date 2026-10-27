package dashboard

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

const waitAppPort = 9000

func waitServer(appUp bool) *Server {
	return New(Config{
		Naming: domain.DefaultNaming(""),
		Stacks: func() []domain.Stack {
			return []domain.Stack{{
				Slug: "feat-x", Branch: "feat/x", LauncherPID: 42, LocalAPIKey: "sk-secret-key",
				Services: []domain.Service{{Name: "app", Port: waitAppPort, URL: "https://app.feat-x.langwatch.localhost:1355"}},
			}}
		},
		SharedURL: func(service string) string {
			if service == "langwatch" {
				return "https://langwatch.localhost:1355"
			}
			return "https://" + service + ".langwatch.localhost:1355"
		},
		Probes: Probes{
			PortInUse:    func(port int) bool { return appUp && port == waitAppPort },
			ProcessAlive: func(pid int) bool { return pid == 42 },
		},
	})
}

func waitGet(s *Server, target, accept string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	rec := httptest.NewRecorder()
	s.serveWaiting(s.routes()).ServeHTTP(rec, req)
	return rec
}

// @scenario "the wait page names the stack, the service and its state"
func TestWaitPageNamesTheStackServiceAndState(t *testing.T) {
	rec := waitGet(waitServer(false), "https://app.feat-x.langwatch.localhost:1355/projects?tab=1", "text/html,*/*")
	body := rec.Body.String()
	if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("want 503 with Retry-After, got %d %q", rec.Code, rec.Header().Get("Retry-After"))
	}
	if got := rec.Header().Get(WaitHeader); got != "starting" {
		t.Errorf("%s = %q, want starting", WaitHeader, got)
	}
	for _, want := range []string{"feat-x", "<code>app</code>", ">starting<", `href="https://hub.langwatch.localhost:1355"`, `href="https://hub.langwatch.localhost:1355/logs/feat-x"`} {
		if !strings.Contains(body, want) {
			t.Errorf("page lacks %q", want)
		}
	}
	if strings.Contains(body, "sk-secret-key") {
		t.Error("the page leaks the stack's API key")
	}
}

// @scenario "the wait page polls and reloads the original address"
func TestWaitPagePollsItsOwnAddressAndReloads(t *testing.T) {
	body := waitGet(waitServer(false), "https://app.feat-x.langwatch.localhost:1355/p?q=1", "text/html").Body.String()
	for _, want := range []string{`fetch(location.href,{method:"HEAD"`, "location.reload()", "delay=1000", "Math.min(5000", `r.headers.get("` + WaitHeader + `")`} {
		if !strings.Contains(body, want) {
			t.Errorf("page script lacks %q", want)
		}
	}
}

// @scenario "a non-page request gets a plain 503"
func TestWaitAnswersScriptsWithAPlain503(t *testing.T) {
	rec := waitGet(waitServer(false), "https://api.feat-x.langwatch.localhost:1355/api/health", "application/json")
	if rec.Code != http.StatusServiceUnavailable || rec.Header().Get(WaitHeader) == "" {
		t.Fatalf("want a marked 503, got %d %q", rec.Code, rec.Header().Get(WaitHeader))
	}
	if strings.Contains(rec.Body.String(), "<html") {
		t.Error("a script must not be handed the HTML page")
	}
}

// @scenario "the daemon's own hosts are not wait pages"
func TestWaitLeavesTheDaemonsOwnHostsAlone(t *testing.T) {
	for _, target := range []string{"https://hub.langwatch.localhost:1355/", "https://feat-x.langwatch.localhost:1355/", "http://127.0.0.1:5000/healthz"} {
		if rec := waitGet(waitServer(false), target, "text/html"); rec.Header().Get(WaitHeader) != "" {
			t.Errorf("%s got the wait answer", target)
		}
	}
}

func TestWaitStateIsStoppedWithoutALiveLauncher(t *testing.T) {
	rec := waitGet(waitServer(false), "https://app.other.langwatch.localhost:1355/", "text/html")
	if got := rec.Header().Get(WaitHeader); got != "stopped" {
		t.Errorf("an unregistered stack's state = %q, want stopped", got)
	}
}
