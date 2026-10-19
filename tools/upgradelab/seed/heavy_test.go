package seed

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

// @scenario "Tier M lays out seedgen's medium tenancy with the rare subscription states"
func TestTierMTenancyIsSeedgenMedium(t *testing.T) {
	tenancy := BuildTenancy(TenancyInput{Shape: "saas", Seed: 1, Anchor: time.Now(), Cloud: true, Volume: "M"})
	if len(tenancy.Organizations) != 12 || len(tenancy.Projects) != 48 || len(tenancy.Users) != 400 {
		t.Fatalf("got %d orgs, %d projects, %d users", len(tenancy.Organizations), len(tenancy.Projects), len(tenancy.Users))
	}
	seen := map[string]bool{}
	for _, sub := range tenancy.Subscriptions {
		seen[sub.Status] = true
	}
	for _, status := range []string{"ACTIVE", "PENDING", "FAILED", "CANCELLED"} {
		if !seen[status] {
			t.Errorf("no %s subscription", status)
		}
	}
	if small := BuildTenancy(TenancyInput{Shape: "saas", Seed: 1, Anchor: time.Now()}); len(small.Projects) != 12 {
		t.Errorf("tier S changed: %d projects", len(small.Projects))
	}
}

// @scenario "Tier M seeds through main's doors against a URL"
func TestHeavySeedsTelemetryAndEveryDoorKind(t *testing.T) {
	var mu sync.Mutex
	hits, refused := map[string]int{}, map[string]bool{"/api/trpc/dashboards.create": true}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		hits[r.URL.Path]++
		mu.Unlock()
		path := strings.TrimPrefix(r.URL.Path, "/api/trpc/")
		switch {
		case r.URL.Path == "/api/auth/sign-in/email":
			w.Header().Set("Set-Cookie", "better-auth.session_token=x")
		case refused[r.URL.Path]:
			http.Error(w, "no", http.StatusForbidden)
		case path == "organization.getAll":
			_, _ = w.Write([]byte(`{"result":{"data":{"json":[{"teams":[{"projects":[{"id":"p1","slug":"s"}]}]}]}}}`))
		case path == "project.getProjectAPIKey":
			_, _ = w.Write([]byte(`{"result":{"data":{"json":{"apiKey":"k"}}}}`))
		case strings.HasPrefix(r.URL.Path, "/api/trpc/"):
			_, _ = w.Write([]byte(`{"result":{"data":{"json":{"id":"x","projectSlug":"s"}}}}`))
		default:
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	defer server.Close()
	tenancy := BuildTenancy(TenancyInput{Shape: "saas", Seed: 1, Anchor: time.Now(), Cloud: true, Volume: "M"})
	result, err := Heavy(context.Background(), HeavyInput{App: server.URL, Email: "a@b.test", Password: "pw", Tenancy: tenancy, Seed: 1, Anchor: time.Now(), Spans: 400})
	if err == nil || !strings.Contains(err.Error(), "product.report") {
		t.Fatalf("a refused kind is not named: %v", err)
	}
	if hits["/api/otel/v1/traces"] == 0 {
		t.Error("no telemetry reached the OTLP door")
	}
	for _, kind := range []string{"product.org", "product.workflow", "product.slack", "product.suite", "rest.dataset.create", "rest.prompt.create"} {
		if result.Sent[kind] != 12 {
			t.Errorf("%s sent %d, want 12", kind, result.Sent[kind])
		}
	}
	if result.Refused["product.report"] != 12 {
		t.Errorf("report refused %d times", result.Refused["product.report"])
	}
}

func TestHeavyVolumesScaleByTier(t *testing.T) {
	if HeavySpans("M") != 30_000 || HeavySpans("L") != 30_000 || HeavySpans("XL") != 300_000 {
		t.Fatalf("tier volumes: M %d, L %d", HeavySpans("M"), HeavySpans("L"))
	}
}

func TestPaceVerdict(t *testing.T) {
	boom := errors.New("redis down")
	for name, c := range map[string]struct {
		depth  int
		err    error
		waited time.Duration
		want   paceState
	}{
		"below goes":        {10_000, nil, 0, paceGo},
		"at the line goes":  {50_000, nil, 0, paceGo},
		"above waits":       {50_001, nil, time.Minute, paceWait},
		"above too long":    {90_000, nil, time.Hour, paceExpired},
		"unread never held": {0, boom, time.Hour, paceGo},
	} {
		if got := paceVerdict(c.depth, c.err, 50_000, c.waited, 30*time.Minute); got != c.want {
			t.Errorf("%s: got %d, want %d", name, got, c.want)
		}
	}
}

func heavyDoorServer(t *testing.T, onHit func(path string) bool) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/trpc/")
		switch {
		case !onHit(r.URL.Path):
			http.Error(w, "access change still processing", http.StatusForbidden)
		case r.URL.Path == "/api/auth/sign-in/email":
			w.Header().Set("Set-Cookie", "better-auth.session_token=x")
		case path == "organization.getAll":
			_, _ = w.Write([]byte(`{"result":{"data":{"json":[{"teams":[{"projects":[{"id":"p1","slug":"s"}]}]}]}}}`))
		case path == "project.getProjectAPIKey":
			_, _ = w.Write([]byte(`{"result":{"data":{"json":{"apiKey":"k"}}}}`))
		case strings.HasPrefix(r.URL.Path, "/api/trpc/"):
			_, _ = w.Write([]byte(`{"result":{"data":{"json":{"id":"x","projectSlug":"s"}}}}`))
		default:
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	t.Cleanup(server.Close)
	return server
}

// @scenario "Tier M makes its organizations before any telemetry and sends the telemetry in waves"
func TestHeavyMakesOrganizationsBeforeTelemetryAndPaces(t *testing.T) {
	var mu sync.Mutex
	var order []string
	server := heavyDoorServer(t, func(path string) bool {
		mu.Lock()
		defer mu.Unlock()
		switch path {
		case "/api/trpc/onboarding.initializeOrganization":
			order = append(order, "org")
		case "/api/otel/v1/traces":
			order = append(order, "otel")
		}
		return true
	})
	reads := 0
	pace := &Pace{Above: 100, WaveChunks: 1, Poll: time.Millisecond, Within: time.Minute,
		Depth: func(context.Context) (int, error) {
			reads++
			return map[bool]int{true: 500, false: 0}[reads%2 == 1], nil
		}}
	var log strings.Builder
	tenancy := BuildTenancy(TenancyInput{Shape: "saas", Seed: 1, Anchor: time.Now(), Cloud: true, Volume: "M"})
	_, err := Heavy(context.Background(), HeavyInput{App: server.URL, Email: "a@b.test", Password: "pw", Tenancy: tenancy, Seed: 1,
		Anchor: time.Now(), Spans: 30000, Workers: 1, Pace: pace, Log: &log})
	if err != nil {
		t.Fatal(err)
	}
	firstOtel := slices.Index(order, "otel")
	if firstOtel < 0 || slices.Contains(order[:firstOtel], "otel") || slices.Contains(order[firstOtel:], "org") {
		t.Fatalf("organizations must all come before telemetry: %v", order)
	}
	if reads < 2 || !strings.Contains(log.String(), "waiting") || !strings.Contains(log.String(), "next wave goes") {
		t.Errorf("pacing not logged (%d depth reads): %q", reads, log.String())
	}
}

func TestHeavyRefusedOrganizationStopsBeforeTelemetry(t *testing.T) {
	orgBackoff, orgBackoffMax = time.Millisecond, time.Millisecond
	t.Cleanup(func() { orgBackoff, orgBackoffMax = 2*time.Second, 30*time.Second })
	var mu sync.Mutex
	otel := 0
	server := heavyDoorServer(t, func(path string) bool {
		mu.Lock()
		defer mu.Unlock()
		if path == "/api/otel/v1/traces" {
			otel++
		}
		return path != "/api/trpc/onboarding.initializeOrganization"
	})
	tenancy := BuildTenancy(TenancyInput{Shape: "saas", Seed: 1, Anchor: time.Now(), Cloud: true, Volume: "M"})
	_, err := Heavy(context.Background(), HeavyInput{App: server.URL, Email: "a@b.test", Password: "pw", Tenancy: tenancy, Seed: 1, Anchor: time.Now(), Spans: 400})
	if !errors.Is(err, ErrOrganizationsRefused) || otel != 0 {
		t.Fatalf("err %v, %d telemetry requests", err, otel)
	}
}
