package dashboard

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestHubJSONCarriesTheWholeMachine(t *testing.T) {
	f := newHomeFixture(t)
	rec := f.get("hub.langwatch.localhost", "/api/hub")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/hub = %d %s", rec.Code, rec.Body)
	}
	hub := decode[hubJSON](t, rec)
	if hub.Shared.HubURL != "https://hub.langwatch.localhost" || hub.Machine.TotalRAMBytes != 64<<30 || hub.Machine.Pressure != "green" {
		t.Errorf("shared %+v machine %+v", hub.Shared, hub.Machine)
	}
	if len(hub.Stacks) != 1 || hub.Stacks[0].HomeURL != "https://feat-x.langwatch.localhost" || !hub.Stacks[0].Live || len(hub.Stacks[0].Surfaces) != 16 {
		t.Errorf("stacks = %+v", hub.Stacks)
	}
	if len(hub.Worktrees) != 1 || hub.Worktrees[0].Name != "parked" || hub.Worktrees[0].HomeURL != "https://parked.langwatch.localhost" || !hub.Worktrees[0].CanStart {
		t.Errorf("worktrees = %+v", hub.Worktrees)
	}
	if len(hub.Events) != 1 || hub.Events[0].At == nil || !hub.Actions.CanRestart || !hub.Actions.CanStart {
		t.Errorf("events %+v actions %+v", hub.Events, hub.Actions)
	}
}

func TestHubJSONFieldNames(t *testing.T) {
	f := newHomeFixture(t)
	body := decode[map[string]any](t, f.get("hub.langwatch.localhost", "/api/hub"))
	pinKeys(t, "hub", body, "shared", "machine", "stacks", "worktrees", "events", "actions")
	pinKeys(t, "shared", body["shared"], "hubUrl", "observabilityUrl", "telemetryUrl")
	pinKeys(t, "machine", body["machine"], "totalRamBytes", "devRssBytes", "stacksRssBytes", "serverRssBytes",
		"agentRssBytes", "agentCount", "toolingRssBytes", "otherRssBytes", "pressure")
	pinKeys(t, "hub stack", body["stacks"].([]any)[0], "slug", "live", "homeUrl", "appUrl", "facts", "surfaces", "canRestart", "canDown", "canDestroy")
	pinKeys(t, "worktree", body["worktrees"].([]any)[0], "name", "slug", "branch", "dir", "isPrimary", "isCurrent", "homeUrl", "canStart")
	pinKeys(t, "event", body["events"].([]any)[0], "at", "kind", "target", "reason")
	pinKeys(t, "actions", body["actions"], "canRestart", "canStart")
}

func TestHubStacksKeepTheirOrder(t *testing.T) {
	f := newHomeFixture(t)
	f.server.config.Stacks = func() []domain.Stack {
		return []domain.Stack{{Slug: "zeta"}, {Slug: "alpha"}, {Slug: "mid"}} // newest first, as the registry gives them
	}
	hub := decode[hubJSON](t, f.get("hub.langwatch.localhost", "/api/hub"))
	var got []string
	for _, s := range hub.Stacks {
		got = append(got, s.Slug)
	}
	if !slices.Equal(got, []string{"alpha", "mid", "zeta"}) {
		t.Errorf("stacks in %v, want by name", got)
	}
}

func TestHubStackCarriesItsAnalyticsActivity(t *testing.T) {
	sim := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/_sim/api/status" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"stack":"feat-x","records":3,"activity":{"total":3,"lastFiveMinutes":2,"distinctIds":1,"lastReceivedAt":"2026-10-02T10:00:00Z","lastName":"$pageview"}}`))
	}))
	t.Cleanup(sim.Close)
	u, err := url.Parse(sim.URL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatal(err)
	}
	f := newHomeFixture(t)
	withSim := f.server.config.Stacks()[0]
	withSim.Services = append(slices.Clone(withSim.Services), domain.Service{Name: domain.AnalyticsService, Port: port})
	silent := domain.Stack{Slug: "no-sim", LauncherPID: 42}
	f.server.config.Stacks = func() []domain.Stack { return []domain.Stack{withSim, silent} }
	hub := decode[hubJSON](t, f.get("hub.langwatch.localhost", "/api/hub"))
	got := hub.Stacks[0].Analytics
	if hub.Stacks[0].Slug != "feat-x" || got == nil || got.LastFiveMinutes != 2 || got.DistinctIDs != 1 || got.LastName != "$pageview" ||
		got.LastReceivedAt == nil || !got.LastReceivedAt.Equal(time.Date(2026, 10, 2, 10, 0, 0, 0, time.UTC)) {
		t.Errorf("feat-x analytics = %+v", got)
	}
	if hub.Stacks[1].Analytics != nil {
		t.Errorf("a stack without a sim carries analytics %+v", hub.Stacks[1].Analytics)
	}
}
