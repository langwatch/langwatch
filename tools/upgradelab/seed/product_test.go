package seed

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
)

const testLabel = "upgradelab-saas-1"

// oldApp stands in for the old release: its sign-in, tRPC and collector doors, recording each call.
type oldApp struct {
	mu       sync.Mutex
	calls    []string
	headers  map[string]http.Header
	refuse   map[string]bool
	noCookie bool
	answers  map[string]any
}

func newOldApp() *oldApp {
	return &oldApp{headers: map[string]http.Header{}, refuse: map[string]bool{}, answers: map[string]any{
		"onboarding.initializeOrganization": map[string]string{"organizationId": "org_1", "projectSlug": "rehearsal-slug"},
		"organization.getAll": []any{map[string]any{"teams": []any{map[string]any{"projects": []any{
			map[string]string{"id": "project_other", "slug": "other"}, map[string]string{"id": "project_1", "slug": "rehearsal-slug"},
		}}}}},
		"project.getProjectAPIKey": map[string]string{"apiKey": "sk-test-key"},
		"dataPrivacy.getSnapshot":  map[string]string{"projectId": "project_1"},
		"dataRetention.getRules":   []any{map[string]string{"projectId": "project_1"}},
		"annotation.getByTraceId":  []any{map[string]string{"comment": "rehearsal " + testLabel}},
		"workflow.getAll":          []any{map[string]string{"name": "rehearsal workflow " + testLabel}, map[string]string{"name": "someone else's"}},
		"slackIntegration.list":    []any{map[string]string{"name": "rehearsal slack " + testLabel}},
		"dashboards.getAll":        []any{map[string]string{"name": "rehearsal report " + testLabel}},
		"scenarios.create":         map[string]string{"id": "scenario_1"},
		"suites.getAll":            []any{map[string]string{"name": "rehearsal suite " + testLabel}},
	}}
}

func (app *oldApp) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	name := strings.TrimPrefix(request.URL.Path, "/api/trpc/")
	app.mu.Lock()
	app.calls, app.headers[name] = append(app.calls, name), request.Header.Clone()
	refused, answer := app.refuse[name], app.answers[name]
	app.mu.Unlock()
	switch {
	case refused:
		writer.WriteHeader(http.StatusUnauthorized)
		_, _ = writer.Write([]byte(`{"error":{"message":"refused"}}`))
	case name == "/api/auth/sign-in/email":
		if !app.noCookie {
			writer.Header().Add("Set-Cookie", "better-auth.session_token=session-1; Path=/; HttpOnly")
		}
		_, _ = writer.Write([]byte(`{"user":{}}`))
	case name == "/api/collector":
		_, _ = writer.Write([]byte(`{"message":"Trace received successfully."}`))
	default:
		_ = json.NewEncoder(writer).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": answer}}})
	}
}

func (app *oldApp) called() []string {
	app.mu.Lock()
	defer app.mu.Unlock()
	return slices.Clone(app.calls)
}

func seederFor(t *testing.T, app *oldApp) *Seeder {
	t.Helper()
	server := httptest.NewServer(app)
	t.Cleanup(server.Close)
	return NewSeeder(ProductInput{AppURL: server.URL, Email: "seed+1@snapshot.test", Password: "pw", Label: testLabel, Client: server.Client()})
}

// @scenario "each product kind is created through the old release's doors"
func TestSeedCreatesEachKindThroughTheOldDoors(t *testing.T) {
	app := newOldApp()
	seeder := seederFor(t, app)
	if err := seeder.Seed(context.Background()); err != nil {
		t.Fatal(err)
	}
	want := []string{"/api/auth/sign-in/email", "onboarding.initializeOrganization", "organization.getAll", "project.getProjectAPIKey", "/api/collector",
		"dataPrivacy.setForScope", "dataRetention.setForScope", "annotation.create", "workflow.create", "slackIntegration.create", "dashboards.create", "scenarios.create", "suites.create"}
	if got := app.called(); !slices.Equal(got, want) {
		t.Fatalf("calls\n got %v\nwant %v", got, want)
	}
	if seeder.Context.OrganizationID != "org_1" || seeder.Context.ProjectID != "project_1" || !strings.HasPrefix(seeder.Context.TraceID, "rehearsal-") {
		t.Errorf("context %+v", seeder.Context)
	}
	if app.headers["suites.create"].Get("Cookie") != "better-auth.session_token=session-1" || app.headers["suites.create"].Get("Origin") == "" {
		t.Errorf("tRPC call lacks the session: %v", app.headers["suites.create"])
	}
	if app.headers["/api/collector"].Get("X-Auth-Token") != "sk-test-key" {
		t.Errorf("collector call lacks the project key: %v", app.headers["/api/collector"])
	}
	for _, kind := range ProductKinds {
		if _, seeded := productDoors[kind.Kind]; !seeded && kind.Unseedable == "" {
			t.Errorf("kind %s has no door and no reason", kind.Kind)
		}
	}
}

// @scenario "a product kind the old app refuses fails the step naming the kind"
func TestSeedNamesARefusedKindAndCreatesTheRest(t *testing.T) {
	app := newOldApp()
	app.refuse["workflow.create"] = true
	err := seederFor(t, app).Seed(context.Background())
	if err == nil || !strings.Contains(err.Error(), "kind workflow") || !strings.Contains(err.Error(), "answered 401") {
		t.Fatalf("err %v, want kind workflow named with the answer", err)
	}
	if !slices.Contains(app.called(), "suites.create") {
		t.Errorf("a refused kind stopped the later ones: %v", app.called())
	}
}

// @scenario "a failed sign-in stops the run naming the step"
func TestSeedStopsAtARefusedSignIn(t *testing.T) {
	app := newOldApp()
	app.refuse["/api/auth/sign-in/email"] = true
	err := seederFor(t, app).Seed(context.Background())
	if err == nil || !strings.HasPrefix(err.Error(), "sign in: POST /api/auth/sign-in/email answered 401") {
		t.Fatalf("err %v, want the sign-in refusal", err)
	}
	if got := app.called(); len(got) != 1 {
		t.Errorf("calls after a refused sign-in: %v", got)
	}
}

// @scenario "a sign-in that sets no session cookie is refused"
func TestSeedRefusesASignInWithoutACookie(t *testing.T) {
	app := newOldApp()
	app.noCookie = true
	err := seederFor(t, app).Seed(context.Background())
	if err == nil || !strings.Contains(err.Error(), "no better-auth session cookie") {
		t.Fatalf("err %v, want the missing cookie named", err)
	}
}
