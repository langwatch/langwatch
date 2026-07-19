package domain

import "testing"

func TestDeriveSlugIsTheWorktreeName(t *testing.T) {
	if got := DeriveSlug("/work/trees/portless", nil); got != "portless" {
		t.Fatalf("slug should be the worktree name: got %q, want portless", got)
	}
	a := DeriveSlug("/work/trees/portless", nil)
	if DeriveSlug("/work/trees/portless", nil) != a {
		t.Fatalf("same worktree must derive the same slug")
	}
	if !ValidSlug(a) {
		t.Fatalf("derived slug %q is not well-formed", a)
	}
	if DeriveSlug("/work/trees/other", nil) == a {
		t.Fatalf("different worktrees should not collide by default")
	}
}

func TestDeriveSlugSanitisesMessyNames(t *testing.T) {
	cases := map[string]string{
		"/x/adr-domain-errors": "adr-domain-errors",
		"/x/My_Feature Branch": "my-feature-branch",
		"/x/feat/nested":       "nested",
		"/x/__weird__.name__":  "weird-name",
	}
	for path, want := range cases {
		if got := DeriveSlug(path, nil); got != want {
			t.Errorf("DeriveSlug(%q) = %q, want %q", path, got, want)
		}
		if !ValidSlug(DeriveSlug(path, nil)) {
			t.Errorf("DeriveSlug(%q) = %q is not a valid slug", path, DeriveSlug(path, nil))
		}
	}
}

func TestDeriveSlugAppendsHashOnCollision(t *testing.T) {
	base := DeriveSlug("/work/trees/portless", nil)
	withCollision := DeriveSlug("/other/path/portless", map[string]bool{base: true})
	if withCollision == base {
		t.Fatalf("collision should append a hash suffix, got %q", withCollision)
	}
	if !ValidSlug(withCollision) {
		t.Fatalf("collision slug %q is not well-formed", withCollision)
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
	want := "http://default:langwatch@127.0.0.1:18123/lw_brave_otter"
	if got := valueOf(managed.OverlayEnv(), "CLICKHOUSE_URL"); got != want {
		t.Errorf("CLICKHOUSE_URL = %q, want %q", got, want)
	}
}

// The app collects ClickHouse backup-status gauges by default (an unset flag must
// not disarm the production alerts that read them), so haven's own container —
// which has no backups and therefore no system.backup_log — has to opt out, or
// every 15s stats tick fails on a missing table.
func TestOverlayOptsOutOfBackupMetricsWhenManagingClickHouse(t *testing.T) {
	base := Stack{Slug: "brave-otter", APIPort: 1, Services: []Service{
		{Name: "app", URL: "https://app.brave-otter.langwatch.localhost"},
	}}
	if hasKey(base.OverlayEnv(), "CLICKHOUSE_BACKUP_METRICS_ENABLED") {
		t.Fatalf("unmanaged stack must leave backup metrics to the worktree's own .env")
	}
	managed := base
	managed.ClickHouseHTTPPort = 18123
	managed.ClickHouseDatabase = "lw_brave_otter"
	if got := valueOf(managed.OverlayEnv(), "CLICKHOUSE_BACKUP_METRICS_ENABLED"); got != "false" {
		t.Errorf("CLICKHOUSE_BACKUP_METRICS_ENABLED = %q, want %q", got, "false")
	}
}

func TestOverlayEmitsPostgresURLOnlyWhenManaged(t *testing.T) {
	base := Stack{Slug: "brave-otter", APIPort: 1, Services: []Service{
		{Name: "app", URL: "https://app.brave-otter.langwatch.localhost"},
	}}
	if hasKey(base.OverlayEnv(), "DATABASE_URL") {
		t.Fatalf("unmanaged stack must not set DATABASE_URL")
	}
	managed := base
	managed.PostgresPort = 5432
	managed.PostgresDatabase = "lw_brave_otter"
	want := "postgresql://prisma:prisma@127.0.0.1:5432/lw_brave_otter"
	if got := valueOf(managed.OverlayEnv(), "DATABASE_URL"); got != want {
		t.Errorf("DATABASE_URL = %q, want %q", got, want)
	}
}

func TestOverlayEmitsRedisURLOnlyWhenManagedWithNoDatabaseSuffix(t *testing.T) {
	base := Stack{Slug: "brave-otter", APIPort: 1, Services: []Service{
		{Name: "app", URL: "https://app.brave-otter.langwatch.localhost"},
	}}
	if hasKey(base.OverlayEnv(), "REDIS_URL") {
		t.Fatalf("unmanaged stack must not set REDIS_URL")
	}
	managed := base
	managed.RedisPort = 6379
	want := "redis://127.0.0.1:6379"
	if got := valueOf(managed.OverlayEnv(), "REDIS_URL"); got != want {
		t.Errorf("REDIS_URL = %q, want %q (must have no /<db> suffix — REDIS_DB_INDEX carries that separately)", got, want)
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

func TestOverlayEmitsHavenSeedLangwatchAPIKey(t *testing.T) {
	st := Stack{Slug: "portless", APIPort: 1, Services: []Service{{Name: "app"}, {Name: "gateway"}, {Name: "nlp"}}}
	if valueOf(st.OverlayEnv(), "HAVEN_SEED_LANGWATCH_API_KEY") != "" {
		t.Fatalf("no key set → HAVEN_SEED_LANGWATCH_API_KEY must be absent")
	}
	st.LocalAPIKey = DefaultLocalAPIKey
	if got := valueOf(st.OverlayEnv(), "HAVEN_SEED_LANGWATCH_API_KEY"); got != DefaultLocalAPIKey {
		t.Errorf("HAVEN_SEED_LANGWATCH_API_KEY = %q, want the stable default %q", got, DefaultLocalAPIKey)
	}
}

// TestOverlayNeverEmitsLangwatchApiKey is the watertight guard: haven must NEVER put
// LANGWATCH_API_KEY (the langwatch SDK's own key contract) into a platform child's env.
// A platform process that saw it would self-instrument into its own trace ingest — a
// feedback loop. haven carries the stable local credential under HAVEN_SEED_LANGWATCH_API_KEY
// instead, and the TS + Go platform entry points panic if LANGWATCH_API_KEY is ever set.
// (LANGWATCH_ENDPOINT is a benign address and is intentionally still emitted — only the
// key triggers self-referencing.) If this test fails, that guarantee is broken.
func TestOverlayNeverEmitsLangwatchApiKey(t *testing.T) {
	// Fully-populated stack with the local API key set — the case that used to emit it.
	st := Stack{
		Slug: "portless", APIPort: 1, RedisDB: 3, WorkerMetricsPort: 2,
		LocalAPIKey: DefaultLocalAPIKey,
		Services:    []Service{{Name: "app"}, {Name: "gateway"}, {Name: "nlp"}, {Name: "langyagent"}},
	}
	if hasKey(st.OverlayEnv(), "LANGWATCH_API_KEY") {
		t.Fatalf("overlay emitted LANGWATCH_API_KEY — a platform must never receive the " +
			"langwatch SDK key contract (it self-references its own ingest). Use " +
			"HAVEN_SEED_LANGWATCH_API_KEY instead.")
	}
	// The renamed key MUST be present so client callers still authenticate, and the
	// benign endpoint stays exactly as it was.
	if !hasKey(st.OverlayEnv(), "HAVEN_SEED_LANGWATCH_API_KEY") {
		t.Errorf("overlay must emit HAVEN_SEED_LANGWATCH_API_KEY (the stable local credential)")
	}
	if !hasKey(st.OverlayEnv(), "LANGWATCH_ENDPOINT") {
		t.Errorf("overlay must still emit LANGWATCH_ENDPOINT (a benign address, unchanged)")
	}
}

func TestBaselinePortFallsBackToLiveBaselineOnly(t *testing.T) {
	alive := func(pid int) bool { return pid == 1 } // pid 1 live, others dead
	stacks := []Stack{
		{Slug: "feature", IsBaseline: false, LauncherPID: 1, Services: []Service{{Name: "gateway", Port: 5000}}},
		{Slug: "main", IsBaseline: true, LauncherPID: 1, Services: []Service{{Name: "gateway", Port: 6000}, {Name: "nlp", Port: 6001}}},
		{Slug: "dead-main", IsBaseline: true, LauncherPID: 2, Services: []Service{{Name: "gateway", Port: 7000}}},
	}
	if port, ok := BaselinePort(stacks, "gateway", alive); !ok || port != 6000 {
		t.Errorf("gateway baseline = %d,%v; want 6000,true (the live baseline)", port, ok)
	}
	if port, ok := BaselinePort(stacks, "nlp", alive); !ok || port != 6001 {
		t.Errorf("nlp baseline = %d,%v; want 6001,true", port, ok)
	}
	if _, ok := BaselinePort(stacks, "app", alive); ok {
		t.Errorf("no baseline runs app → must not resolve")
	}
	// A baseline whose own service is itself a fallback is not a valid source.
	fbOnly := []Stack{{IsBaseline: true, LauncherPID: 1, Services: []Service{{Name: "gateway", Port: 8000, IsFallback: true}}}}
	if _, ok := BaselinePort(fbOnly, "gateway", alive); ok {
		t.Errorf("a fallback service must not be offered as a baseline source")
	}
}

func TestTypecheckSlotsBoundsByMemoryAndCPU(t *testing.T) {
	gib := uint64(1) << 30
	if got := TypecheckSlots(0, 8, 3); got != 3 {
		t.Errorf("explicit override should win: got %d, want 3", got)
	}
	if got := TypecheckSlots(16*gib, 8, 0); got != 4 {
		t.Errorf("16GiB/4 = 4 slots: got %d", got)
	}
	if got := TypecheckSlots(64*gib, 4, 0); got != 4 {
		t.Errorf("capped at CPU count (4): got %d", got)
	}
	if got := TypecheckSlots(1*gib, 8, 0); got != 1 {
		t.Errorf("tiny RAM still gets 1 slot: got %d", got)
	}
}
