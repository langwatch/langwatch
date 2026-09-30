package dashboard

import (
	"net/http"
	"testing"
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
	if len(hub.Stacks) != 1 || hub.Stacks[0].HomeURL != "https://feat-x.langwatch.localhost" || !hub.Stacks[0].Live || len(hub.Stacks[0].Surfaces) != 15 {
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
	pinKeys(t, "hub stack", body["stacks"].([]any)[0], "slug", "live", "homeUrl", "appUrl", "facts", "surfaces", "canRestart")
	pinKeys(t, "worktree", body["worktrees"].([]any)[0], "name", "slug", "branch", "dir", "isPrimary", "isCurrent", "homeUrl", "canStart")
	pinKeys(t, "event", body["events"].([]any)[0], "at", "kind", "target", "reason")
	pinKeys(t, "actions", body["actions"], "canRestart", "canStart")
}
