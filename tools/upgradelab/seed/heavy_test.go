package seed

import (
	"context"
	"net/http"
	"net/http/httptest"
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
