package outboundsim

import (
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// @scenario "Outboundsim answers the OpenAI, Anthropic and Microsoft calls a pull source makes"
func TestVendorRoutesServeTheGovernancePulls(t *testing.T) {
	g := newRig(t, Config{})
	var members struct {
		Data []map[string]string `json:"data"`
	}
	decode(t, g.get("/openai/v1/organization/users", tokenHeader("sk-admin-good")).body, &members)
	if len(members.Data) != 3 {
		t.Fatalf("openai members = %d, want 3", len(members.Data))
	}
	anthropic := g.get("/anthropic/v1/organizations/me", map[string]string{"x-api-key": "sk-ant-good"})
	if anthropic.status != http.StatusOK || !strings.Contains(anthropic.body, "org_sim") {
		t.Fatalf("anthropic me = %d %s", anthropic.status, anthropic.body)
	}
	token := g.do(http.MethodPost, "/microsoft-login/tenant-1/oauth2/v2.0/token", nil, "client_secret=s3cret")
	if token.status != http.StatusOK || !strings.Contains(token.body, "sim-microsoft-tenant-1") {
		t.Fatalf("microsoft token = %d %s", token.status, token.body)
	}
	for _, path := range []string{"/microsoft-graph/v1.0/users", "/microsoft-graph/v1.0/subscribedSkus"} {
		if got := g.get(path, tokenHeader("sim-microsoft-tenant-1")); got.status != http.StatusOK {
			t.Fatalf("%s = %d %s", path, got.status, got.body)
		}
	}
	if got := g.get("/openai/v1/organization/users", tokenHeader("sk-revoked")); got.status != http.StatusUnauthorized {
		t.Fatalf("revoked key = %d, want 401", got.status)
	}
	if got := g.get("/openai/v1/organization/users", nil); got.status != http.StatusUnauthorized {
		t.Fatalf("no credential = %d, want 401", got.status)
	}
}

type bucketPage struct {
	Data []struct {
		Results []map[string]any `json:"results"`
	} `json:"data"`
	HasMore  bool    `json:"has_more"`
	NextPage *string `json:"next_page"`
}

// walkPages follows next_page from path until it ends or limit is reached, returning the pages.
func walkPages(t *testing.T, g *rig, path string, header map[string]string, limit int) []bucketPage {
	t.Helper()
	var pages []bucketPage
	next := ""
	for range limit {
		url := path
		if next != "" {
			url += "&page=" + next
		}
		var page bucketPage
		decode(t, g.get(url, header).body, &page)
		pages = append(pages, page)
		if page.NextPage == nil {
			break
		}
		next = *page.NextPage
	}
	return pages
}

// @scenario "Outboundsim serves the OpenAI cost report, paged"
func TestOpenAICostReportPagesByDay(t *testing.T) {
	g := newRig(t, Config{})
	start := time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC).Unix()
	path := "/openai/v1/organization/costs?bucket_width=1d&limit=180&group_by[]=project_id&group_by[]=api_key_id&start_time=" + strconv.FormatInt(start, 10)
	pages := walkPages(t, g, path, tokenHeader("sk-admin-good"), 6)
	if len(pages) != 3 || pages[2].HasMore {
		t.Fatalf("pages = %d, want 3 ending without more", len(pages))
	}
	row := pages[0].Data[0].Results[0]
	if row["api_key_id"] == nil || row["amount"].(map[string]any)["value"] == "" {
		t.Fatalf("row = %v", row)
	}
	if got := g.get(path, tokenHeader("sk-admin-nokeys")); got.status != http.StatusBadRequest || !strings.Contains(got.body, `"param":"start_time"`) {
		t.Fatalf("nokeys = %d %s", got.status, got.body)
	}
	if got := g.get(path+"&page=p1", tokenHeader("sk-admin-flaky")); got.status != http.StatusServiceUnavailable {
		t.Fatalf("flaky page 2 = %d, want 503", got.status)
	}
	if got := g.get(path, tokenHeader("sk-admin-revoked")); got.status != http.StatusUnauthorized {
		t.Fatalf("revoked = %d, want 401", got.status)
	}
}

// @scenario "Outboundsim serves the Anthropic usage and cost reports, paged"
func TestAnthropicReportsPageAndLoopOnCycle(t *testing.T) {
	g := newRig(t, Config{})
	key := map[string]string{"x-api-key": "sk-ant-admin-good"}
	usage := "/anthropic/v1/organizations/usage_report/messages?bucket_width=1d&starting_at=2026-10-07T00:00:00.000Z"
	pages := walkPages(t, g, usage, key, 6)
	if len(pages) != 3 {
		t.Fatalf("usage pages = %d, want 3", len(pages))
	}
	if pages[0].Data[0].Results[0]["model"] == nil {
		t.Fatalf("usage row = %v", pages[0].Data[0].Results[0])
	}
	cost := walkPages(t, g, "/anthropic/v1/organizations/cost_report?bucket_width=1d&starting_at=2026-10-07T00:00:00.000Z", key, 6)
	if len(cost) != 3 || cost[0].Data[0].Results[0]["amount"] == nil {
		t.Fatalf("cost pages = %d", len(cost))
	}
	cycle := walkPages(t, g, usage, map[string]string{"x-api-key": "sk-ant-cycle"}, 4)
	if len(cycle) != 4 {
		t.Fatalf("cycle ended after %d pages, want it to keep going", len(cycle))
	}
	if got := g.get("/anthropic/v1/organizations/cost_report?starting_at=nonsense", key); got.status != http.StatusBadRequest {
		t.Fatalf("bad starting_at = %d, want 400", got.status)
	}
}

// @scenario "Outboundsim serves the Claude compliance audit log and the Microsoft directory audits, paged"
func TestAuditFeedsPageThroughCursorAndNextLink(t *testing.T) {
	g := newRig(t, Config{})
	var first struct {
		Data       []map[string]any `json:"data"`
		NextCursor string           `json:"next_cursor"`
	}
	decode(t, g.get("/anthropic/v1/organizations/audit_log", map[string]string{"x-api-key": "sk-ant-good"}).body, &first)
	if len(first.Data) != 3 || first.NextCursor != "3" {
		t.Fatalf("first page = %d events, cursor %q", len(first.Data), first.NextCursor)
	}
	var last struct {
		Data []map[string]any `json:"data"`
	}
	decode(t, g.get("/anthropic/v1/organizations/audit_log?cursor=7", map[string]string{"x-api-key": "sk-ant-good"}).body, &last)
	if len(last.Data) != 0 {
		t.Fatalf("drained feed returned %d events", len(last.Data))
	}
	var audits struct {
		Value    []map[string]any `json:"value"`
		NextLink string           `json:"@odata.nextLink"`
	}
	seen := 0
	link := "/microsoft-graph/v1.0/auditLogs/directoryAudits"
	for range 5 {
		audits.NextLink = ""
		decode(t, g.get(link, tokenHeader("sim-microsoft-tenant-1")).body, &audits)
		seen += len(audits.Value)
		if audits.NextLink == "" {
			break
		}
		if !strings.HasPrefix(audits.NextLink, g.url+"/microsoft-graph/") {
			t.Fatalf("nextLink = %q, want absolute on the sim", audits.NextLink)
		}
		link = strings.TrimPrefix(audits.NextLink, g.url)
	}
	if seen != 7 {
		t.Fatalf("directory audits seen = %d, want 7", seen)
	}
	if got := g.get("/anthropic/v1/organizations/audit_log", map[string]string{"x-api-key": "sk-ant-noscope"}); got.status != http.StatusForbidden {
		t.Fatalf("noscope = %d, want 403", got.status)
	}
	if got := g.get("/microsoft-graph/v1.0/auditLogs/directoryAudits", tokenHeader("sim-microsoft-down")); got.status != http.StatusServiceUnavailable {
		t.Fatalf("down = %d, want 503", got.status)
	}
}

// @scenario "Outboundsim serves Dataverse bots and conversation transcripts behind the Microsoft token"
func TestDataverseServesBotsAndPagedTranscripts(t *testing.T) {
	g := newRig(t, Config{})
	auth := tokenHeader("sim-microsoft-tenant-1")
	var bots struct {
		Value []map[string]any `json:"value"`
	}
	decode(t, g.get("/dataverse/api/data/v9.2/bots?$select=botid,name,modifiedon&$top=100", auth).body, &bots)
	if len(bots.Value) != 2 || bots.Value[0]["botid"] == nil {
		t.Fatalf("bots = %v", bots.Value)
	}
	type page struct {
		Value    []map[string]any `json:"value"`
		NextLink string           `json:"@odata.nextLink"`
	}
	filter := url.QueryEscape("createdon ge 2026-01-01T00:00:00.000Z")
	link := "/dataverse/api/data/v9.2/conversationtranscripts?$filter=" + filter
	var ids, created []string
	for range 5 {
		var p page
		decode(t, g.get(link, auth).body, &p)
		for _, row := range p.Value {
			ids = append(ids, row["conversationtranscriptid"].(string))
			created = append(created, row["createdon"].(string))
		}
		if p.NextLink == "" {
			break
		}
		link = strings.TrimPrefix(p.NextLink, g.url)
	}
	if len(ids) != 7 || !sort.StringsAreSorted(ids) {
		t.Fatalf("transcripts = %v, want 7 in order", ids)
	}
	var after page
	cont := "createdon ge " + created[3] + " and (createdon gt " + created[3] + " or (createdon eq " + created[3] + " and conversationtranscriptid gt " + ids[3] + "))"
	decode(t, g.get("/dataverse/api/data/v9.2/conversationtranscripts?$filter="+url.QueryEscape(cont), auth).body, &after)
	if len(after.Value) != 3 {
		t.Fatalf("continuation rows = %d, want the 3 after the fourth", len(after.Value))
	}
	for _, row := range after.Value {
		if row["conversationtranscriptid"].(string) <= ids[3] {
			t.Fatalf("continuation returned %v, which is not after %s", row["conversationtranscriptid"], ids[3])
		}
	}
	botFilter := url.QueryEscape("createdon ge 2026-01-01T00:00:00.000Z and (_bot_conversationtranscriptid_value eq aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2)")
	var one page
	decode(t, g.get("/dataverse/api/data/v9.2/conversationtranscripts?$filter="+botFilter, auth).body, &one)
	if len(one.Value) != 3 {
		t.Fatalf("bot-filtered first page = %d rows, want 3", len(one.Value))
	}
	if got := g.get("/dataverse/api/data/v9.2/bots", tokenHeader("sim-microsoft-revoked")); got.status != http.StatusUnauthorized {
		t.Fatalf("revoked = %d, want 401", got.status)
	}
	if got := g.get("/dataverse/api/data/v9.2/conversationtranscripts", nil); got.status != http.StatusUnauthorized {
		t.Fatalf("no token = %d, want 401", got.status)
	}
}
