package domain

import "testing"

func TestDeriveSlugIsDeterministicPerWorktree(t *testing.T) {
	a := DeriveSlug("/work/trees/portless", nil)
	b := DeriveSlug("/work/trees/portless", nil)
	if a != b {
		t.Fatalf("same worktree must derive the same slug: %q vs %q", a, b)
	}
	if !ValidSlug(a) {
		t.Fatalf("derived slug %q is not well-formed", a)
	}
	if DeriveSlug("/work/trees/other", nil) == a {
		t.Fatalf("different worktrees should not collide by default")
	}
}

func TestDeriveSlugAppendsPlaceOnCollision(t *testing.T) {
	base := DeriveSlug("/work/trees/portless", nil)
	withCollision := DeriveSlug("/work/trees/portless", map[string]bool{base: true})
	if withCollision == base {
		t.Fatalf("collision should append a place word, got %q", withCollision)
	}
	if !ValidSlug(withCollision) {
		t.Fatalf("collision slug %q is not well-formed (want 2-3 words)", withCollision)
	}
}

func TestHostnameScheme(t *testing.T) {
	n := DefaultNaming("localhost")
	cases := map[string]string{
		n.Hostname("app", "happy-tiger"): "app.happy-tiger.langwatch.localhost",
		n.Hostname("api", "happy-tiger"): "api.happy-tiger.langwatch.localhost",
		n.Hostname("langwatch", ""):      "langwatch.localhost",
		n.Hostname("observability", ""):  "observability.langwatch.localhost",
		n.Hostname("telemetry", ""):      "telemetry.langwatch.localhost",
	}
	for got, want := range cases {
		if got != want {
			t.Errorf("hostname = %q, want %q", got, want)
		}
	}
}

func TestRouteNameStripsTLD(t *testing.T) {
	n := DefaultNaming("localhost")
	if got := n.RouteName("app", "happy-tiger"); got != "app.happy-tiger.langwatch" {
		t.Errorf("routeName = %q, want app.happy-tiger.langwatch", got)
	}
	if got := n.RouteName("langwatch", ""); got != "langwatch" {
		t.Errorf("routeName = %q, want langwatch", got)
	}
}

func TestURLOmitsDefaultPortAddsCustom(t *testing.T) {
	n := DefaultNaming("localhost")
	if got := n.URL("app", "happy-tiger", "https", 443); got != "https://app.happy-tiger.langwatch.localhost" {
		t.Errorf("default 443 URL = %q", got)
	}
	if got := n.URL("app", "happy-tiger", "https", 8443); got != "https://app.happy-tiger.langwatch.localhost:8443" {
		t.Errorf("custom-port URL = %q", got)
	}
}

func TestRedisDBInRange(t *testing.T) {
	for _, slug := range []string{"happy-tiger", "brave-otter", "zesty-yak-cove"} {
		if db := RedisDBForSlug(slug); db < 0 || db > 15 {
			t.Errorf("redis db for %q = %d, out of 0-15", slug, db)
		}
	}
}

func TestOverlayCollapsesApiIntoAppOrigin(t *testing.T) {
	n := DefaultNaming("localhost")
	st := Stack{
		Slug: "happy-tiger", RedisDB: 3, APIPort: 41001, WorkerMetricsPort: 41002,
	}
	for _, r := range PerWorktreeServices {
		st.Services = append(st.Services, Service{
			Name: r.Name, Role: r.Role, Port: 40000,
			Hostname: n.Hostname(r.Name, st.Slug),
			URL:      n.URL(r.Name, st.Slug, "https", 443),
		})
	}
	env := map[string]string{}
	for _, line := range st.OverlayEnv() {
		if i := indexByte(line, '='); i >= 0 {
			env[line[:i]] = line[i+1:]
		}
	}
	// The app is the single public origin; the API is same-origin at /api, so no
	// api.<slug> hostname is advertised and internal callers use the loopback port.
	if got := env["LANGWATCH_ENDPOINT"]; got != "https://app.happy-tiger.langwatch.localhost" {
		t.Errorf("LANGWATCH_ENDPOINT = %q, want the app origin", got)
	}
	wantAPI := "http://127.0.0.1:41001"
	if got := env["LANGWATCH_API_URL"]; got != wantAPI {
		t.Errorf("LANGWATCH_API_URL = %q, want loopback %q", got, wantAPI)
	}
	if got := env["GATEWAY_CONTROL_PLANE_URL"]; got != wantAPI {
		t.Errorf("GATEWAY_CONTROL_PLANE_URL = %q, want loopback %q", got, wantAPI)
	}
	if got := env["LANGWATCH_API_PORT"]; got != "41001" {
		t.Errorf("LANGWATCH_API_PORT = %q, want 41001 (the APIPort)", got)
	}
	for _, r := range PerWorktreeServices {
		if r.Name == "api" {
			t.Fatalf("api must not be a routed service — it shares app's origin")
		}
	}
}

func TestOverlayEmitsClickHouseURLOnlyWhenManaged(t *testing.T) {
	base := Stack{Slug: "brave-otter", APIPort: 1, Services: []Service{
		{Name: "app", URL: "https://app.brave-otter.langwatch.localhost"},
		{Name: "gateway", URL: "https://gateway.brave-otter.langwatch.localhost"},
		{Name: "nlp", URL: "https://nlp.brave-otter.langwatch.localhost"},
	}}
	if hasKey(base.OverlayEnv(), "CLICKHOUSE_URL") {
		t.Fatalf("unmanaged stack must not set CLICKHOUSE_URL")
	}
	managed := base
	managed.ClickHouseHTTPPort = 18123
	managed.ClickHouseDatabase = "lw_brave_otter"
	want := "http://127.0.0.1:18123/lw_brave_otter"
	if got := valueOf(managed.OverlayEnv(), "CLICKHOUSE_URL"); got != want {
		t.Errorf("CLICKHOUSE_URL = %q, want %q", got, want)
	}
}

func TestDatabaseForSlugIsAValidIdentifier(t *testing.T) {
	cases := map[string]string{
		"happy-tiger":    "lw_happy_tiger",
		"zesty-yak-cove": "lw_zesty_yak_cove",
		"brave-otter":    "lw_brave_otter",
	}
	for slug, want := range cases {
		if got := DatabaseForSlug(slug); got != want {
			t.Errorf("DatabaseForSlug(%q) = %q, want %q", slug, got, want)
		}
		if !validCHIdentifier(DatabaseForSlug(slug)) {
			t.Errorf("DatabaseForSlug(%q) = %q is not a valid ClickHouse identifier", slug, DatabaseForSlug(slug))
		}
	}
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

func hasKey(lines []string, key string) bool {
	return valueOf(lines, key) != "" || keyPresent(lines, key)
}

func keyPresent(lines []string, key string) bool {
	for _, l := range lines {
		if len(l) > len(key) && l[:len(key)] == key && l[len(key)] == '=' {
			return true
		}
	}
	return false
}

func valueOf(lines []string, key string) string {
	for _, l := range lines {
		if len(l) > len(key) && l[:len(key)] == key && l[len(key)] == '=' {
			return l[len(key)+1:]
		}
	}
	return ""
}

func validCHIdentifier(s string) bool {
	if s == "" {
		return false
	}
	for i, c := range s {
		isLetter := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_'
		isDigit := c >= '0' && c <= '9'
		if i == 0 && !isLetter {
			return false
		}
		if !isLetter && !isDigit {
			return false
		}
	}
	return true
}
