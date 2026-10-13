package outboundsim

import (
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
)

func tokenHeader(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}

func (g *rig) get(path string, header map[string]string) answer {
	g.t.Helper()
	return g.do(http.MethodGet, path, header, "")
}

// @scenario "A Genie workspace lists its spaces, conversations and messages to a good token"
func TestDatabricksSeededWorkspaceServesTheSweep(t *testing.T) {
	g := newRig(t, Config{})
	var spaces struct {
		Spaces []dbxSpace `json:"spaces"`
		Next   *string    `json:"next_page_token"`
	}
	decode(t, g.get("/api/2.0/genie/spaces?page_size=100", tokenHeader("dapi-good")).body, &spaces)
	if len(spaces.Spaces) != 3 || spaces.Next != nil {
		t.Fatalf("spaces = %+v, want 3 on one page", spaces)
	}
	var convs struct {
		Conversations []map[string]any `json:"conversations"`
	}
	decode(t, g.get("/api/2.0/genie/spaces/01simspacesales/conversations?include_all=true", tokenHeader("dapi-good")).body, &convs)
	if len(convs.Conversations) != 2 {
		t.Fatalf("conversations = %d, want 2", len(convs.Conversations))
	}
	var msgs struct {
		Messages []map[string]any `json:"messages"`
	}
	path := "/api/2.0/genie/spaces/01simspacesales/conversations/01simspacesales-conv1/messages"
	decode(t, g.get(path, tokenHeader("dapi-good")).body, &msgs)
	if len(msgs.Messages) != 1 || msgs.Messages[0]["status"] != "COMPLETED" {
		t.Fatalf("messages = %+v, want one completed message", msgs.Messages)
	}
	again := g.get(path, tokenHeader("dapi-good")).body
	if !strings.Contains(again, msgs.Messages[0]["message_id"].(string)) {
		t.Fatal("a second read must report the same message")
	}
	rec := g.records("channel=databricks")
	if len(rec) != 4 || strings.Contains(rec[0].Headers["Authorization"], "dapi-good") {
		t.Fatalf("records = %d, want 4 with the token redacted", len(rec))
	}
}

// @scenario "Each refusal a pull source names has a credential that triggers it"
func TestDatabricksTenantWordsRefuseByCause(t *testing.T) {
	g := newRig(t, Config{})
	for token, want := range map[string]int{
		"": 401, "dapi-revoked": 401, "dapi-noscope": 403, "dapi-ratelimited": 429, "dapi-down": 503,
	} {
		header := tokenHeader(token)
		if token == "" {
			header = nil
		}
		expect(t, "spaces as "+token, g.get("/api/2.0/genie/spaces", header).status, want)
	}
	malformed := g.get("/api/2.0/genie/spaces", tokenHeader("dapi-malformed"))
	expect(t, "malformed status", malformed.status, 200)
	if !strings.HasPrefix(malformed.body, "<html>") {
		t.Fatalf("malformed body = %q, want a sign-in page", malformed.body)
	}
	if got := g.get("/api/2.0/genie/spaces", tokenHeader("dapi-empty")).body; !strings.Contains(got, `"spaces":[]`) {
		t.Fatalf("empty tenant = %s", got)
	}
	cycled := g.get("/api/2.0/genie/spaces?page_size=1", tokenHeader("dapi-cycle")).body
	if !strings.Contains(cycled, `"next_page_token":"0"`) {
		t.Fatalf("cycle tenant = %s, want a repeating page token", cycled)
	}
}

// @scenario "A scripted fault overrides a good token on one Databricks path"
func TestDatabricksFaultOverridesGoodToken(t *testing.T) {
	g := newRig(t, Config{})
	expect(t, "add fault", g.addFault(`{"channel":"databricks","target":"/api/2.0/genie/spaces","status":403,"times":1}`).status, 201)
	expect(t, "faulted", g.get("/api/2.0/genie/spaces", tokenHeader("dapi-good")).status, 403)
	expect(t, "after", g.get("/api/2.0/genie/spaces", tokenHeader("dapi-good")).status, 200)
}

// @scenario "A service principal signs in and its client id picks the workspace"
func TestDatabricksServicePrincipalSignIn(t *testing.T) {
	g := newRig(t, Config{})
	basic := func(id string) map[string]string {
		return map[string]string{"Authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte(id+":secret"))}
	}
	ok := g.postAs("/oidc/v1/token", basic("sp-good"), "grant_type=client_credentials&scope=all-apis")
	expect(t, "sign in", ok.status, 200)
	if !strings.Contains(ok.body, `"access_token":"dapi-oauth-sp-good"`) {
		t.Fatalf("token body = %s", ok.body)
	}
	expect(t, "revoked principal", g.postAs("/oidc/v1/token", basic("sp-revoked"), "").status, 401)
}

// @scenario "The SCIM directory pages by startIndex and can be replaced"
func TestDatabricksDirectoryPagesAndIsReplaceable(t *testing.T) {
	g := newRig(t, Config{})
	var page struct {
		Resources    []dbxUser `json:"Resources"`
		TotalResults int       `json:"totalResults"`
	}
	decode(t, g.get("/api/2.0/preview/scim/v2/Users?startIndex=2&count=1", tokenHeader("dapi-good")).body, &page)
	if page.TotalResults != 3 || len(page.Resources) != 1 || page.Resources[0].ID != "1002" {
		t.Fatalf("page = %+v", page)
	}
	set := g.do(http.MethodPut, "/_sim/api/databricks/users", nil, `[{"id":"7","userName":"admin@example.test","active":true}]`)
	expect(t, "replace", set.status, 200)
	expect(t, "lookup", g.get("/api/2.0/preview/scim/v2/Users/7", tokenHeader("dapi-good")).status, 200)
	expect(t, "gone", g.get("/api/2.0/preview/scim/v2/Users/1001", tokenHeader("dapi-good")).status, 404)
	expect(t, "bad user", g.do(http.MethodPut, "/_sim/api/databricks/users", nil, `[{"id":""}]`).status, 422)
}

// @scenario "A usage feed serves events after a cursor for a custom HTTP pull"
func TestFeedServesEventsAfterCursor(t *testing.T) {
	g := newRig(t, Config{})
	var feed struct {
		Events []map[string]any `json:"events"`
		Next   string           `json:"next_cursor"`
	}
	decode(t, g.get("/feeds/usage?cursor=3", tokenHeader("feed-good")).body, &feed)
	if len(feed.Events) != 2 || feed.Next != "5" || feed.Events[0]["id"] != "usage-evt-4" {
		t.Fatalf("feed = %+v", feed)
	}
	expect(t, "revoked feed", g.get("/feeds/usage", tokenHeader("feed-revoked")).status, 401)
}
