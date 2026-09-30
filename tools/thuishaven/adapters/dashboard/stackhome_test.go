package dashboard

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

const testKey = "sk-lw-local-development-key"

// homeFixture is a daemon with one registered stack, feat-x, whose launcher
// lives; the app, api and idp ports answer, the worker port does not yet, and
// langyagent and the two developer tools are not selected. A second worktree,
// parked, has a slug but no stack.
type homeFixture struct {
	server *Server
	logDir string
	up     map[int]bool
	alive  map[int]bool
}

func newHomeFixture(t *testing.T) *homeFixture {
	t.Helper()
	f := &homeFixture{logDir: t.TempDir(), up: map[int]bool{5001: true, 5100: true, 5005: true, 5432: true}, alive: map[int]bool{42: true}}
	naming := domain.DefaultNaming("")
	stack := domain.Stack{
		Slug: "feat-x", WorktreeDir: "/repos/wt/feat-x", Branch: "feat/x", LauncherPID: 42, RedisDB: 3,
		APIPort: 5100, WorkerMetricsPort: 5101, PostgresPort: 5432, PostgresDatabase: "lw_feat_x",
		ClickHouseHTTPPort: 8123, ClickHouseDatabase: "lw_feat_x", RedisPort: 6379, LocalAPIKey: testKey,
		UpdatedAt: time.Date(2026, 9, 28, 10, 0, 0, 0, time.UTC),
		Services: []domain.Service{
			{Name: "app", Hostname: "app.feat-x.langwatch.localhost", URL: "https://app.feat-x.langwatch.localhost", Port: 5001},
			{Name: "gateway", Hostname: "gateway.feat-x.langwatch.localhost", URL: "https://gateway.feat-x.langwatch.localhost", Port: 5002},
			{Name: "nlp", Hostname: "nlp.feat-x.langwatch.localhost", URL: "https://nlp.feat-x.langwatch.localhost", Port: 5003},
			{Name: "langyagent", Hostname: "langyagent.feat-x.langwatch.localhost", URL: "https://langyagent.feat-x.langwatch.localhost"},
			{Name: "idp", Hostname: "idp.feat-x.langwatch.localhost", URL: "https://idp.feat-x.langwatch.localhost", Port: 5005},
			{Name: "mail", Hostname: "mail.feat-x.langwatch.localhost", URL: "https://mail.feat-x.langwatch.localhost", Port: 5006},
			{Name: "design-system", Hostname: "design-system.feat-x.langwatch.localhost", URL: "https://design-system.feat-x.langwatch.localhost"},
			{Name: "mail-room", Hostname: "mail-room.feat-x.langwatch.localhost", URL: "https://mail-room.feat-x.langwatch.localhost"},
			{Name: "api", Hostname: "api.feat-x.langwatch.localhost", URL: "https://api.feat-x.langwatch.localhost", Port: 5100},
		},
	}
	f.server = New(Config{
		LogDir: func(slug string) string { return filepath.Join(f.logDir, slug) },
		Stacks: func() []domain.Stack { return []domain.Stack{stack} },
		SharedURL: func(svc string) string {
			return naming.URL(svc, "", "https", 443)
		},
		StackURL: func(svc, slug string) string { return naming.URL(svc, slug, "https", 443) },
		Naming:   naming,
		Probes: Probes{
			PortInUse:    func(port int) bool { return f.up[port] },
			ProcessAlive: func(pid int) bool { return f.alive[pid] },
		},
		Extras: func() Extras {
			return Extras{
				Summary:     SummaryView{TotalRAM: 64 << 30, StacksRSS: 3 << 30, Pressure: "green"},
				Worktrees:   []WorktreeView{{Slug: "parked", Branch: "feat/parked", Dir: "/repos/wt/parked"}},
				Events:      []EventView{{At: time.Date(2026, 9, 28, 9, 0, 0, 0, time.UTC), Kind: "stack", Target: "old", Reason: "launcher died"}},
				StackRSS:    map[int]uint64{42: 2 << 30},
				StackUptime: map[int]time.Duration{42: 90 * time.Minute},
			}
		},
		IdPTenants: func(_ context.Context, port int) []IdPTenant {
			if port != 5005 {
				return nil
			}
			return []IdPTenant{{ID: "1", Domain: "acme1.test", URL: "https://idp.feat-x.langwatch.localhost/t/1"}}
		},
		Actions: Actions{Restart: func(string, string) (string, error) { return "", nil }, Start: func(string) error { return nil }},
		Console: fstest.MapFS{"index.html": {Data: []byte("<!doctype html><div id=root>haven-web</div>")}},
	})
	return f
}

func (f *homeFixture) get(host, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Host = host
	rec := httptest.NewRecorder()
	f.server.guardHost(f.server.routes()).ServeHTTP(rec, req)
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body, err)
	}
	return out
}

// keysOf is an object's field names, sorted, for pinning the JSON contract.
func keysOf(t *testing.T, value any) []string {
	t.Helper()
	object, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%v is not a JSON object", value)
	}
	keys := make([]string, 0, len(object))
	for k := range object {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func pinKeys(t *testing.T, what string, value any, want ...string) {
	t.Helper()
	sort.Strings(want)
	if got := keysOf(t, value); !reflect.DeepEqual(got, want) {
		t.Errorf("%s fields = %v, want %v (apps/haven-web parses these names)", what, got, want)
	}
}

// @scenario "The bare stack hostname routes to the stack home"
func TestStackHostServesTheConsole(t *testing.T) {
	f := newHomeFixture(t)
	for _, path := range []string{"/", "/some/client/route"} {
		rec := f.get("feat-x.langwatch.localhost", path)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "haven-web") {
			t.Errorf("GET feat-x.langwatch.localhost%s = %d %q, want the console bundle", path, rec.Code, rec.Body)
		}
	}
	if rec := f.get("hub.langwatch.localhost", "/"); !strings.Contains(rec.Body.String(), "haven-web") {
		t.Errorf("the hub's root must serve the console too, got %d %q", rec.Code, rec.Body)
	}
	if rec := f.get("hub.langwatch.localhost", "/logs/feat-x/api"); !strings.Contains(rec.Body.String(), "haven-web") {
		t.Errorf("the hub's client routes must reach the console, got %d %q", rec.Code, rec.Body)
	}
}

// @scenario "The stack home's data comes from one endpoint"
func TestStackHomeCarriesFactsSurfacesErrorsAndCredentials(t *testing.T) {
	f := newHomeFixture(t)
	if err := os.Mkdir(filepath.Join(f.logDir, "feat-x"), 0o700); err != nil {
		t.Fatal(err)
	}
	var api strings.Builder
	start := time.Date(2026, 9, 28, 9, 0, 0, 0, time.UTC)
	for i := range 30 {
		fmt.Fprintf(&api, "%s {\"level\":\"error\",\"msg\":\"boom %d\"}\n", start.Add(time.Duration(i)*time.Second).Format(time.RFC3339Nano), i)
	}
	fmt.Fprintf(&api, "%s {\"level\":\"info\",\"msg\":\"fine\"}\n", start.Add(time.Hour).Format(time.RFC3339Nano))
	writeLog(t, filepath.Join(f.logDir, "feat-x", "api.log"), api.String())
	writeLog(t, filepath.Join(f.logDir, "feat-x", "ui.log"), start.Format(time.RFC3339Nano)+" {\"level\":\"info\",\"msg\":\"ready\"}\n")

	rec := f.get("feat-x.langwatch.localhost", "/api/stacks/feat-x")
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("GET /api/stacks/feat-x = %d %v %s", rec.Code, rec.Header(), rec.Body)
	}
	if strings.Contains(rec.Body.String(), testKey) {
		t.Fatal("the stack home printed the API key; it must only ever be masked here")
	}
	home := decode[stackHomeJSON](t, rec)

	t.Run("facts", func(t *testing.T) {
		facts := home.Facts
		if facts.Branch != "feat/x" || facts.WorktreeDir != "/repos/wt/feat-x" || facts.Layout != "modular" ||
			facts.UptimeSeconds != 5400 || facts.RSSBytes != 2<<30 || facts.HeartbeatAt == nil {
			t.Errorf("facts = %+v", facts)
		}
		db := facts.Databases
		if db.Postgres != (databaseJSON{"lw_feat_x", 5432}) || db.ClickHouse != (databaseJSON{"lw_feat_x", 8123}) ||
			db.Redis.DB == nil || *db.Redis.DB != 3 || db.Redis.Port != 6379 {
			t.Errorf("databases = %+v", db)
		}
	})

	t.Run("every surface, with its status", func(t *testing.T) {
		want := map[string]string{
			"app": statusLive, "api": statusLive, "worker": statusStarting, "gateway": statusStarting,
			"nlp": statusStarting, "langyagent": statusNotSelected, "idp": statusLive, "mail": statusStarting,
			"design-system": statusNotSelected, "mail-room": statusNotSelected, "langevals": statusNotSelected, "storage": statusNotSelected, "voice": statusNotSelected, "llm": statusNotSelected, "observability": statusDown,
		}
		got := map[string]string{}
		var order []string
		for _, sf := range home.Surfaces {
			got[sf.Name] = sf.Status
			order = append(order, sf.Name)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("statuses = %v, want %v", got, want)
		}
		if strings.Join(order[:3], ",") != "app,api,worker" {
			t.Errorf("the api and worker belong right under the app, got %v", order)
		}
		for _, sf := range home.Surfaces {
			switch sf.Name {
			case "langyagent":
				if sf.Hint != "haven up +langy" {
					t.Errorf("langyagent hint = %q, want the selector spelling", sf.Hint)
				}
			case "idp":
				if sf.URL != "https://idp.feat-x.langwatch.localhost" || sf.Port != 5005 || sf.Hostname != "idp.feat-x.langwatch.localhost" {
					t.Errorf("idp surface = %+v", sf)
				}
			}
		}
	})

	t.Run("recent errors per lane, newest first and capped", func(t *testing.T) {
		if len(home.Errors) != 1 || home.Errors[0].Lane != "api" {
			t.Fatalf("errors = %+v, want the api lane alone (ui logged none)", home.Errors)
		}
		lines := home.Errors[0].Lines
		if len(lines) != recentErrorsPerLane || lines[0].Text != `{"level":"error","msg":"boom 29"}` {
			t.Errorf("got %d lines starting %+v, want 20 newest first", len(lines), lines[0])
		}
		if home.Errors[0].LogsURL != "https://hub.langwatch.localhost/logs/feat-x/api" {
			t.Errorf("logsUrl = %q", home.Errors[0].LogsURL)
		}
	})

	t.Run("credentials", func(t *testing.T) {
		c := home.Credentials
		if c.Login.Email != domain.DefaultAdminEmail || c.MailAddress != "dev@feat-x.mail.langwatch.localhost" {
			t.Errorf("credentials = %+v", c)
		}
		if len(c.IdPTenants) != 1 || c.IdPTenants[0].Domain != "acme1.test" {
			t.Errorf("idp tenants = %+v", c.IdPTenants)
		}
		if c.APIKey == nil || c.APIKey.Masked != "sk-lw-••••••••-key" || c.APIKey.RevealPath != "/api/stacks/feat-x/api-key" {
			t.Errorf("api key = %+v", c.APIKey)
		}
	})

	if !home.Registered || !home.Live || home.HomeURL != "https://feat-x.langwatch.localhost" || !home.Actions.CanRestart || home.Actions.CanStart {
		t.Errorf("home = registered %v live %v url %q actions %+v", home.Registered, home.Live, home.HomeURL, home.Actions)
	}
}

func TestStackHomeJSONFieldNames(t *testing.T) {
	f := newHomeFixture(t)
	body := decode[map[string]any](t, f.get("feat-x.langwatch.localhost", "/api/stacks/feat-x"))
	pinKeys(t, "stack home", body, "slug", "registered", "live", "hubUrl", "homeUrl", "facts", "surfaces", "errors", "credentials", "actions")
	facts := body["facts"].(map[string]any)
	pinKeys(t, "facts", facts, "branch", "worktreeDir", "layout", "baseline", "uptimeSeconds", "rssBytes", "heartbeatAt", "databases")
	databases := facts["databases"].(map[string]any)
	pinKeys(t, "databases", databases, "postgres", "clickhouse", "redis")
	pinKeys(t, "postgres", databases["postgres"], "name", "port")
	pinKeys(t, "redis", databases["redis"], "db", "port")
	pinKeys(t, "surface", body["surfaces"].([]any)[0], "name", "role", "hostname", "url", "port", "status", "hint", "fallback")
	credentials := body["credentials"].(map[string]any)
	pinKeys(t, "credentials", credentials, "login", "mailAddress", "idpTenants", "apiKey")
	pinKeys(t, "login", credentials["login"], "email")
	pinKeys(t, "apiKey", credentials["apiKey"], "masked", "revealPath")
	pinKeys(t, "idp tenant", credentials["idpTenants"].([]any)[0], "id", "domain", "url")
	pinKeys(t, "actions", body["actions"], "canRestart", "canStart", "startDir")
	if errs, ok := body["errors"].([]any); !ok || errs == nil {
		t.Errorf("errors must be an array even when empty, got %v", body["errors"])
	}
}

func TestStackHomeAnswersForAStoppedStack(t *testing.T) {
	f := newHomeFixture(t)
	home := decode[stackHomeJSON](t, f.get("parked.langwatch.localhost", "/api/stacks/parked"))
	if home.Registered || home.Live || !home.Actions.CanStart || home.Actions.StartDir != "/repos/wt/parked" {
		t.Errorf("a stopped stack's home = %+v, want unregistered, not live, startable", home)
	}
	for _, sf := range home.Surfaces {
		if sf.Status != statusDown {
			t.Errorf("surface %s = %s, want down while the stack is stopped", sf.Name, sf.Status)
		}
	}
	if home.Facts.Databases.Postgres.Name != "lw_parked" || home.Facts.Databases.Redis.DB != nil || home.Credentials.APIKey != nil {
		t.Errorf("facts %+v credentials %+v", home.Facts, home.Credentials)
	}
}

// @scenario "An unknown slug is a not-found, not a blank page"
func TestUnknownStackIsANotFoundThatLinksToTheHub(t *testing.T) {
	f := newHomeFixture(t)
	if rec := f.get("nope.langwatch.localhost", "/"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "haven-web") {
		t.Errorf("the console must load for an unknown slug so it can say so, got %d", rec.Code)
	}
	rec := f.get("nope.langwatch.localhost", "/api/stacks/nope")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	body := decode[notFoundJSON](t, rec)
	if body.Error != `no stack is registered for "nope"` || body.Slug != "nope" || body.HubURL != "https://hub.langwatch.localhost" {
		t.Errorf("not-found body = %+v", body)
	}
	pinKeys(t, "not found", decode[map[string]any](t, rec), "error", "slug", "hubUrl")
}

// @scenario "A Go build without the bundle still answers"
func TestStackHostWithoutTheBundleNamesTheBuild(t *testing.T) {
	s := New(Config{
		Stacks:    func() []domain.Stack { return nil },
		SharedURL: func(svc string) string { return "https://" + svc + ".langwatch.localhost" },
		Naming:    domain.DefaultNaming(""),
		Console:   fstest.MapFS{".gitkeep": {}},
	})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Host = "feat-x.langwatch.localhost"
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), consoleBuildCommand) {
		t.Errorf("GET / = %d %q, want a page naming %s", rec.Code, rec.Body, consoleBuildCommand)
	}
}

func TestRevealingTheAPIKey(t *testing.T) {
	f := newHomeFixture(t)
	t.Run("from the page itself", func(t *testing.T) {
		rec := post(f.server, "/api/stacks/feat-x/api-key", "")
		if rec.Code != http.StatusOK || decode[map[string]string](t, rec)["apiKey"] != testKey {
			t.Errorf("reveal = %d %s", rec.Code, rec.Body)
		}
		if rec.Header().Get("Cache-Control") != "no-store" {
			t.Error("a revealed key must not be cached")
		}
	})
	t.Run("from another origin", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/stacks/feat-x/api-key", nil)
		req.Header.Set("Sec-Fetch-Site", "cross-site")
		rec := httptest.NewRecorder()
		f.server.routes().ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden || strings.Contains(rec.Body.String(), testKey) {
			t.Errorf("cross-site reveal = %d %s, want 403 without the key", rec.Code, rec.Body)
		}
	})
	t.Run("for a stack with no key", func(t *testing.T) {
		if rec := post(f.server, "/api/stacks/parked/api-key", ""); rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", rec.Code)
		}
	})
}

func TestMaskKey(t *testing.T) {
	if got := maskKey("short-key"); got != "••••••••" {
		t.Errorf("maskKey(short) = %q, want it masked whole", got)
	}
}
