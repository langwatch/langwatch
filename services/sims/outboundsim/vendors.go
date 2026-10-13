package outboundsim

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ChannelVendor records the OpenAI, Anthropic and Microsoft calls governance pull sources make
// when their vendor base points at this sim.
const ChannelVendor = "vendor"

// vendorUsers is the member list every vendor route serves; Microsoft needs UUID ids.
var vendorUsers = []map[string]string{
	{"id": "11111111-1111-4111-8111-111111111111", "name": "Ada Analyst", "email": "ada@sim.vendor.test"},
	{"id": "22222222-2222-4222-8222-222222222222", "name": "Ben Builder", "email": "ben@sim.vendor.test"},
	{"id": "33333333-3333-4333-8333-333333333333", "name": "Cleo Controller", "email": "cleo@sim.vendor.test"},
}

// vendorCall answers a vendor route: the bearer or x-api-key word picks the tenant as on the
// Databricks routes (empty, revoked, noscope, ratelimited, down, malformed).
func (s *Server) vendorCall(w http.ResponseWriter, r *http.Request, answer func(tenant string) reply) {
	c, ok := readCall(w, r, ChannelVendor, r.URL.Path)
	if !ok {
		return
	}
	credential := bearerOf(r)
	if credential == "" {
		credential = r.Header.Get("x-api-key")
	}
	if credential == "" {
		s.finish(w, c, jsonReply(http.StatusUnauthorized, map[string]string{"error": "missing credential"}))
		return
	}
	tenant := dbxTenantOf(credential)
	if refusal, refused := dbxRefusal(tenant); refused {
		s.finish(w, c, refusal)
		return
	}
	s.finish(w, c, answer(tenant))
}

func (s *Server) handleVendorMembers(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(tenant string) reply {
		data := vendorUsers
		if tenant == dbxTenantEmpty {
			data = []map[string]string{}
		}
		return jsonReply(http.StatusOK, map[string]any{"data": data, "has_more": false, "last_id": nil})
	})
}

func (s *Server) handleOpenAIProjects(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(string) reply {
		out := jsonReply(http.StatusOK, map[string]any{"data": []map[string]string{{"id": "proj_sim"}}})
		out.header = map[string]string{"openai-organization": "org-sim"}
		return out
	})
}

func (s *Server) handleAnthropicMe(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(string) reply {
		return jsonReply(http.StatusOK, map[string]string{"id": "org_sim", "name": "Sim organization"})
	})
}

// handleMicrosoftToken answers any tenant's client-credentials grant; a tenant word in the
// client secret (revoked, down, ...) refuses it as the Databricks token route does.
func (s *Server) handleMicrosoftToken(w http.ResponseWriter, r *http.Request) {
	c, ok := readCall(w, r, ChannelVendor, r.URL.Path)
	if !ok {
		return
	}
	secret := strings.ToLower(string(c.body))
	if tenant := dbxTenantOf(secret); tenant == dbxTenantRevoked || tenant == dbxTenantNoScope {
		s.finish(w, c, jsonReply(http.StatusUnauthorized, map[string]string{"error": "invalid_client"}))
		return
	}
	s.finish(w, c, jsonReply(http.StatusOK, map[string]any{
		"access_token": "sim-microsoft-" + r.PathValue("tenant"), "token_type": "Bearer", "expires_in": 3600,
	}))
}

func (s *Server) handleGraphUsers(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(tenant string) reply {
		rows := []map[string]any{}
		if tenant != dbxTenantEmpty {
			for _, u := range vendorUsers {
				rows = append(rows, map[string]any{
					"id": u["id"], "displayName": u["name"], "mail": u["email"],
					"userPrincipalName": u["email"], "department": "Engineering", "accountEnabled": true,
				})
			}
		}
		return jsonReply(http.StatusOK, map[string]any{"value": rows})
	})
}

func (s *Server) handleGraphSkus(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(string) reply {
		return jsonReply(http.StatusOK, map[string]any{"value": []map[string]any{{
			"skuId": "44444444-4444-4444-8444-444444444444", "skuPartNumber": "COPILOT_STUDIO_SIM",
			"appliesTo": "User", "capabilityStatus": "Enabled", "consumedUnits": 2,
			"prepaidUnits": map[string]int{"enabled": 5, "suspended": 0, "warning": 0},
		}}})
	})
}

// vendorPageSize is how many rows (or one bucket) a paged vendor route returns, so a seeded
// feed always spans several pages.
const vendorPageSize = 3

// credentialOf is the bearer or x-api-key word that picks the tenant.
func credentialOf(r *http.Request) string {
	if token := bearerOf(r); token != "" {
		return token
	}
	return r.Header.Get("x-api-key")
}

// originOf is the scheme and host the caller reached the sim on, for absolute next links.
func originOf(r *http.Request) string {
	scheme, host := "http", r.Host
	if r.TLS != nil {
		scheme = "https"
	}
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	}
	if forwarded := r.Header.Get("X-Forwarded-Host"); forwarded != "" {
		host = forwarded
	}
	return scheme + "://" + host
}

// bucketsFrom is up to three buckets of width step from start, none starting after now.
func bucketsFrom(start time.Time, step time.Duration, now time.Time) []time.Time {
	out := []time.Time{}
	for i := range 3 {
		at := start.UTC().Add(time.Duration(i) * step)
		if at.Before(now) {
			out = append(out, at)
		}
	}
	return out
}

// stepOf is the duration of an Anthropic or OpenAI bucket width.
func stepOf(width string) time.Duration {
	switch width {
	case "1h":
		return time.Hour
	case "1m":
		return time.Minute
	}
	return 24 * time.Hour
}

// bucketedReply serves one bucket per page as {data, has_more, next_page}. Tenants: empty has
// no buckets, cycle hands back the same next_page forever, and a credential holding "flaky"
// answers every page after the first with 503.
func bucketedReply(items []map[string]any, r *http.Request, tenant string) reply {
	page := r.URL.Query().Get("page")
	index := 0
	if page != "" {
		n, err := strconv.Atoi(strings.TrimPrefix(page, "p"))
		if err != nil || n < 0 || !strings.HasPrefix(page, "p") {
			return jsonReply(http.StatusBadRequest, map[string]any{"error": map[string]string{
				"type": "invalid_request_error", "message": "invalid page token",
			}})
		}
		index = n
	}
	if index > 0 && strings.Contains(strings.ToLower(credentialOf(r)), "flaky") {
		return jsonReply(http.StatusServiceUnavailable, map[string]string{"error": "temporarily unavailable"})
	}
	if tenant == dbxTenantEmpty || index >= len(items) {
		return jsonReply(http.StatusOK, map[string]any{"data": []map[string]any{}, "has_more": false, "next_page": nil})
	}
	if tenant == dbxTenantCycle {
		return jsonReply(http.StatusOK, map[string]any{"data": items[:1], "has_more": true, "next_page": "p1"})
	}
	if index+1 < len(items) {
		return jsonReply(http.StatusOK, map[string]any{
			"data": items[index : index+1], "has_more": true, "next_page": "p" + strconv.Itoa(index+1),
		})
	}
	return jsonReply(http.StatusOK, map[string]any{"data": items[index:], "has_more": false, "next_page": nil})
}

// handleOpenAICosts serves GET /openai/v1/organization/costs: daily cost buckets from
// start_time, one per page. A credential holding "nokeys" refuses group_by[]=api_key_id the way
// an old organization does, so the puller falls back to user-only grouping.
func (s *Server) handleOpenAICosts(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(tenant string) reply {
		q := r.URL.Query()
		seconds, err := strconv.ParseInt(q.Get("start_time"), 10, 64)
		if err != nil {
			return jsonReply(http.StatusBadRequest, map[string]any{"error": map[string]string{
				"type": "invalid_request_error", "param": "start_time", "message": "start_time is required",
			}})
		}
		keyed := false
		for _, dim := range q["group_by[]"] {
			keyed = keyed || dim == "api_key_id"
		}
		if keyed && strings.Contains(strings.ToLower(credentialOf(r)), "nokeys") {
			return jsonReply(http.StatusBadRequest, map[string]any{"error": map[string]string{
				"type": "invalid_request_error", "param": "start_time", "code": "invalid_request_error",
				"message": "group_by api_key_id is not available for this window",
			}})
		}
		items := []map[string]any{}
		for i, at := range bucketsFrom(time.Unix(seconds, 0).UTC().Truncate(24*time.Hour), 24*time.Hour, s.now()) {
			results := []map[string]any{}
			for k, user := range []string{"user-sim-ada", "user-sim-ben"} {
				row := map[string]any{
					"object": "organization.costs.result", "line_item": "gpt-sim-mini, input", "project_id": "proj_sim",
					"user_id": user, "amount": map[string]any{"value": fmt.Sprintf("%.4f", 0.25*float64(i+1+k)), "currency": "usd"},
				}
				if keyed {
					row["api_key_id"] = fmt.Sprintf("key_sim_%d", k+1)
				}
				results = append(results, row)
			}
			items = append(items, map[string]any{
				"object": "bucket", "start_time": at.Unix(), "end_time": at.Add(24 * time.Hour).Unix(), "results": results,
			})
		}
		return bucketedReply(items, r, tenant)
	})
}

// anthropicBuckets are the report buckets from starting_at, rows made by row(bucketIndex).
func (s *Server) anthropicBuckets(r *http.Request, row func(i int) []map[string]any) ([]map[string]any, bool) {
	q := r.URL.Query()
	start, err := time.Parse(time.RFC3339, q.Get("starting_at"))
	if err != nil {
		return nil, false
	}
	step := stepOf(q.Get("bucket_width"))
	items := []map[string]any{}
	for i, at := range bucketsFrom(start, step, s.now()) {
		items = append(items, map[string]any{
			"starting_at": at.Format(time.RFC3339), "ending_at": at.Add(step).Format(time.RFC3339), "results": row(i),
		})
	}
	return items, true
}

func anthropicBadRequest() reply {
	return jsonReply(http.StatusBadRequest, map[string]any{"type": "error", "error": map[string]string{
		"type": "invalid_request_error", "message": "starting_at must be an RFC 3339 time",
	}})
}

// handleAnthropicUsage serves GET /anthropic/v1/organizations/usage_report/messages.
func (s *Server) handleAnthropicUsage(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(tenant string) reply {
		items, ok := s.anthropicBuckets(r, func(i int) []map[string]any {
			rows := []map[string]any{}
			for k, model := range []string{"claude-sim-sonnet", "claude-sim-haiku"} {
				rows = append(rows, map[string]any{
					"uncached_input_tokens": 1000 * (i + 1 + k), "output_tokens": 200 * (i + 1 + k),
					"cache_creation":          map[string]int{"ephemeral_1h_input_tokens": 50, "ephemeral_5m_input_tokens": 25},
					"cache_read_input_tokens": 400, "model": model, "workspace_id": "wrkspc_sim",
					"api_key_id": fmt.Sprintf("apikey_sim_%d", k+1), "service_tier": "standard", "context_window": "0-200k",
				})
			}
			return rows
		})
		if !ok {
			return anthropicBadRequest()
		}
		return bucketedReply(items, r, tenant)
	})
}

// handleAnthropicCost serves GET /anthropic/v1/organizations/cost_report; amounts are decimal cents.
func (s *Server) handleAnthropicCost(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(tenant string) reply {
		items, ok := s.anthropicBuckets(r, func(i int) []map[string]any {
			rows := []map[string]any{}
			for k, model := range []string{"claude-sim-sonnet", "claude-sim-haiku"} {
				rows = append(rows, map[string]any{
					"amount": fmt.Sprintf("%.2f", 12.5*float64(i+1+k)), "currency": "USD", "cost_type": "tokens",
					"workspace_id": "wrkspc_sim", "description": model + " input tokens", "model": model,
				})
			}
			return rows
		})
		if !ok {
			return anthropicBadRequest()
		}
		return bucketedReply(items, r, tenant)
	})
}

// handleClaudeCompliance serves GET /anthropic/v1/organizations/audit_log?cursor=<n>: seven
// audit events, three per page, and the cursor to send next (the end of the feed once drained).
func (s *Server) handleClaudeCompliance(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(tenant string) reply {
		events := []map[string]any{}
		if tenant != dbxTenantEmpty {
			for i := range 7 {
				events = append(events, map[string]any{
					"id": fmt.Sprintf("audit-evt-%d", i+1), "event_type": "claude.chat.message",
					"created_at": s.databricks.origin.Add(time.Duration(i) * time.Hour).Format(time.RFC3339),
					"actor":      map[string]string{"email": vendorUsers[i%3]["email"], "ip_address": "203.0.113.7"},
					"model":      "claude-sim-sonnet", "workspace_id": "wrkspc_sim",
					"usage": map[string]any{"cost_usd": "0.0125", "input_tokens": 120, "output_tokens": 48},
				})
			}
		}
		from, _ := strconv.Atoi(r.URL.Query().Get("cursor"))
		from = min(max(from, 0), len(events))
		end := min(from+vendorPageSize, len(events))
		next := strconv.Itoa(end)
		if tenant == dbxTenantCycle {
			next = "0"
		}
		return jsonReply(http.StatusOK, map[string]any{"data": events[from:end], "next_cursor": next})
	})
}

// handleGraphDirectoryAudits serves GET /microsoft-graph/v1.0/auditLogs/directoryAudits: seven
// directory changes, three per page, with an absolute @odata.nextLink as Graph sends.
func (s *Server) handleGraphDirectoryAudits(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(tenant string) reply {
		rows := []map[string]any{}
		if tenant != dbxTenantEmpty {
			for i := range 7 {
				rows = append(rows, map[string]any{
					"id": fmt.Sprintf("directory-audit-%d", i+1), "category": "ApplicationManagement",
					"activityDisplayName": "Consent to application", "result": "success",
					"activityDateTime": s.databricks.origin.Add(time.Duration(i) * time.Hour).Format(time.RFC3339),
					"correlationId":    fmt.Sprintf("00000000-0000-4000-8000-%012d", i+1),
					"initiatedBy":      map[string]any{"user": map[string]string{"userPrincipalName": vendorUsers[i%3]["email"]}},
					"targetResources":  []map[string]string{{"displayName": "Sim Copilot app"}},
				})
			}
		}
		from, _ := strconv.Atoi(r.URL.Query().Get("$skiptoken"))
		from = min(max(from, 0), len(rows))
		end := min(from+vendorPageSize, len(rows))
		body := map[string]any{"value": rows[from:end]}
		if end < len(rows) || tenant == dbxTenantCycle {
			next := end
			if tenant == dbxTenantCycle {
				next = from
			}
			q := r.URL.Query()
			q.Set("$skiptoken", strconv.Itoa(next))
			body["@odata.nextLink"] = originOf(r) + r.URL.Path + "?" + q.Encode()
		}
		return jsonReply(http.StatusOK, body)
	})
}

// dataverseBots are the agents of the seeded Dataverse environment.
var dataverseBots = []map[string]any{
	{"botid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "name": "Sim Helpdesk Agent", "modifiedon": "2026-09-01T09:00:00Z"},
	{"botid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "name": "Sim HR Agent", "modifiedon": "2026-09-02T09:00:00Z"},
}

// handleDataverseBots serves GET /dataverse/api/data/v9.2/bots; $top is honored.
func (s *Server) handleDataverseBots(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(tenant string) reply {
		rows := dataverseBots
		if tenant == dbxTenantEmpty {
			rows = nil
		}
		if top, err := strconv.Atoi(r.URL.Query().Get("$top")); err == nil && top >= 0 && top < len(rows) {
			rows = rows[:top]
		}
		body := map[string]any{"@odata.context": "$metadata#bots", "value": append([]map[string]any{}, rows...)}
		if tenant == dbxTenantCycle {
			body["@odata.nextLink"] = originOf(r) + r.URL.RequestURI()
		}
		return jsonReply(http.StatusOK, body)
	})
}

type dataverseTranscript struct {
	id, bot string
	created time.Time
}

// dataverseTranscripts are seven conversations an hour apart, alternating between the bots.
func (s *Server) dataverseTranscripts() []dataverseTranscript {
	out := make([]dataverseTranscript, 0, 7)
	for i := range 7 {
		out = append(out, dataverseTranscript{
			id:      fmt.Sprintf("bbbbbbbb-bbbb-4bbb-8bbb-%012d", i+1),
			bot:     dataverseBots[i%len(dataverseBots)]["botid"].(string),
			created: s.databricks.origin.Add(time.Duration(i) * time.Hour).UTC(),
		})
	}
	return out
}

var (
	dvAfterPattern = regexp.MustCompile(`createdon eq (\S+) and conversationtranscriptid gt ([0-9a-fA-F-]+)`)
	dvFromPattern  = regexp.MustCompile(`createdon ge (\S+)`)
	dvBotPattern   = regexp.MustCompile(`_bot_conversationtranscriptid_value eq ([0-9a-fA-F-]+)`)
)

// transcriptRow is the conversation as Dataverse stores it: the activities are a JSON string.
func transcriptRow(t dataverseTranscript, n int) map[string]any {
	at := func(offset time.Duration) int64 { return t.created.Add(offset).UnixMilli() }
	content := jsonString(map[string]any{"activities": []map[string]any{
		{"id": fmt.Sprintf("act-%d-1", n), "type": "message", "text": fmt.Sprintf("Question %d from Ada", n), "timestamp": at(-4 * time.Minute),
			"from": map[string]any{"id": "user", "role": 1, "aadObjectId": vendorUsers[0]["id"]}},
		{"id": fmt.Sprintf("act-%d-2", n), "type": "message", "text": fmt.Sprintf("Answer %d from the agent", n), "timestamp": at(-3 * time.Minute),
			"from": map[string]any{"id": "bot", "role": 0, "name": "Sim agent"}},
	}})
	metadata := jsonString(map[string]any{"BatchId": 1})
	return map[string]any{
		"conversationtranscriptid": t.id, "name": fmt.Sprintf("Conversation %d", n),
		"createdon": t.created.Format("2006-01-02T15:04:05.000Z"), "conversationstarttime": t.created.Add(-5 * time.Minute).Format("2006-01-02T15:04:05.000Z"),
		"content": content, "metadata": metadata, "schematype": "Microsoft.Copilot", "schemaversion": "1.0",
		"_bot_conversationtranscriptid_value": t.bot,
	}
}

// handleDataverseTranscripts serves GET /dataverse/api/data/v9.2/conversationtranscripts. It reads
// the $filter the puller writes (createdon ge, the (createdon, id) continuation, the bot ids),
// orders by that pair, and pages three rows at a time through an absolute @odata.nextLink.
func (s *Server) handleDataverseTranscripts(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(tenant string) reply {
		filter := r.URL.Query().Get("$filter")
		var floor, afterAt time.Time
		afterID := ""
		if m := dvFromPattern.FindStringSubmatch(filter); m != nil {
			floor, _ = time.Parse(time.RFC3339Nano, m[1])
		}
		if m := dvAfterPattern.FindStringSubmatch(filter); m != nil {
			afterAt, _ = time.Parse(time.RFC3339Nano, m[1])
			afterID = m[2]
		}
		bots := map[string]bool{}
		for _, m := range dvBotPattern.FindAllStringSubmatch(filter, -1) {
			bots[strings.ToLower(m[1])] = true
		}
		matched := []dataverseTranscript{}
		for _, t := range s.dataverseTranscripts() {
			switch {
			case tenant == dbxTenantEmpty, t.created.Before(floor):
			case len(bots) > 0 && !bots[t.bot]:
			case t.created.Equal(afterAt) && t.id <= afterID:
			default:
				matched = append(matched, t)
			}
		}
		sort.Slice(matched, func(i, j int) bool {
			if !matched[i].created.Equal(matched[j].created) {
				return matched[i].created.Before(matched[j].created)
			}
			return matched[i].id < matched[j].id
		})
		from, _ := strconv.Atoi(r.URL.Query().Get("$skiptoken"))
		from = min(max(from, 0), len(matched))
		end := min(from+vendorPageSize, len(matched))
		rows := []map[string]any{}
		for i, t := range matched[from:end] {
			rows = append(rows, transcriptRow(t, from+i+1))
		}
		body := map[string]any{"@odata.context": "$metadata#conversationtranscripts", "value": rows}
		if end < len(matched) || tenant == dbxTenantCycle {
			next := end
			if tenant == dbxTenantCycle {
				next = from
			}
			q := r.URL.Query()
			q.Set("$skiptoken", strconv.Itoa(next))
			body["@odata.nextLink"] = originOf(r) + r.URL.Path + "?" + strings.ReplaceAll(q.Encode(), "+", "%20")
		}
		return jsonReply(http.StatusOK, body)
	})
}

// jsonString is v as a JSON document held in a string, as Dataverse stores content columns.
func jsonString(v any) string {
	encoded, _ := json.Marshal(v)
	return string(encoded)
}
