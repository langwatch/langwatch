package cell

import (
	"errors"
	"net/http"
	"strings"
	"testing"
)

func settledOddities(heldOrg string) (oddFacts, oddFacts) {
	before := oddFacts{KeysForm: "object", DatasetRows: 3, UntaggedTags: 0}
	after := oddFacts{KeysForm: "string", DatasetRows: 3, UntaggedTags: 2, HeldStates: []string{"migrated"},
		ProvidersRead: http.StatusOK, ProvidersBody: `{"openai":{"customKeys":{"OPENAI_API_KEY":"upg...ey-1"}}}`,
		DatasetRead: http.StatusOK, DatasetBody: strings.Join(oddDatasetMarkers, ","), PromptRead: http.StatusOK,
		OpsText: "Organizations " + heldOrg + " Held", HomeText: actionNeededCard}
	return before, after
}

func TestJudgeOdditiesPassesWhenEveryOddityIsHandled(t *testing.T) {
	before, after := settledOddities("org_held")
	for _, v := range judgeOddities("org_held", before, after) {
		if v.Result != "pass" {
			t.Errorf("%s: %s %s", v.ID, v.Result, v.Detail)
		}
	}
}

func TestJudgeOdditiesFailsEachOddityOnItsOwn(t *testing.T) {
	cases := map[string]func(after *oddFacts){
		"A1": func(after *oddFacts) { after.OpsErr = errors.New("no Organizations tab") },
		"A2": func(after *oddFacts) { after.ProvidersBody += oddPlaintextKey },
		"A3": func(after *oddFacts) { after.DatasetRows = 0 },
		"A4": func(after *oddFacts) { after.UntaggedTags = 0 },
	}
	for id, spoil := range cases {
		before, after := settledOddities("org_held")
		spoil(&after)
		for _, v := range judgeOddities("org_held", before, after) {
			if want := map[bool]string{true: "fail", false: "pass"}[v.ID == id]; v.Result != want {
				t.Errorf("spoiling %s: %s is %s, want %s (%s)", id, v.ID, v.Result, want, v.Detail)
			}
		}
	}
}

func TestJudgeOdditiesWantsTheHeldOrganizationAlone(t *testing.T) {
	before, after := settledOddities("org_held")
	after.OtherHeld = []string{"identity-d04-connection-grandfather:org_other:parked"}
	if v := judgeOddities("org_held", before, after)[0]; v.Result != "fail" {
		t.Fatalf("A1 with a second held organization: %s", v.Detail)
	}
	after.OtherHeld, after.HeldStates = nil, []string{"finalized"}
	if v := judgeOddities("org_held", before, after)[0]; v.Result != "fail" {
		t.Fatalf("A1 with the organization finalized: %s", v.Detail)
	}
}

func TestTenantOdditiesOverlayNeedsAnSSODeployment(t *testing.T) {
	_, err := prepare(Options{Deployment: "cloud", Tier: "S", Shape: "typical", Overlays: []string{OverlayTenantOddities}})
	if err == nil || !strings.Contains(err.Error(), "SSO deployment") {
		t.Fatalf("cloud with tenant-oddities: %v", err)
	}
}

func TestWithoutOrganizationsDropsOnlyTheOverlaysMemberships(t *testing.T) {
	got := withoutOrganizations(map[string][]string{"seed": {"org_seed:ADMIN", "org_held:ADMIN"}, "other": {"org_held:MEMBER"}}, []string{"org_held"})
	if len(got["seed"]) != 1 || got["seed"][0] != "org_seed:ADMIN" || len(got["other"]) != 0 {
		t.Fatalf("got %v", got)
	}
}
