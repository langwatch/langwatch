package apidiff

import (
	"net/http"
	"net/url"
	"time"
)

// fixtureSide is one instance as a fixture sees it: its address, what it
// minted for itself, and the ids it has created.
type fixtureSide struct {
	baseURL     string
	credentials sideCredentials
	symbols     *SymbolTable
}

func (engine *probeEngine) fixtureSides() []fixtureSide {
	return []fixtureSide{
		{baseURL: engine.options.A, credentials: engine.credsA, symbols: engine.symbolsA},
		{baseURL: engine.options.B, credentials: engine.credsB, symbols: engine.symbolsB},
	}
}

// ingestionSourcesProcedure is the dashboard's create for an ingestion
// source; no REST route or CLI command creates one on either side.
const ingestionSourcesProcedure = "/api/trpc/ingestionSources.create"

// seedGovernance gives each side what the CLI's governance reads list: an
// ingestion source, created the way the dashboard creates one, an
// organization budget, which binds every key the admin owns.
func (engine *probeEngine) seedGovernance() {
	for _, side := range engine.fixtureSides() {
		engine.createIngestionSource(side)
		engine.createOrganizationBudget(side)
	}
}

// createIngestionSource creates a push source with the admin's session, pins
// it as that side's {sourceId}, and sends it one span, so the CLI's source
// events and health read a source that has received something.
func (engine *probeEngine) createIngestionSource(side fixtureSide) {
	input := map[string]any{"organizationId": seededOrganizationID, "sourceType": "otel_generic", "name": "apidiff source"}
	result := engine.trpcMutation(side, ingestionSourcesProcedure, input)
	id, ok := trpcData(result.body, "source.id")
	engine.progress("fixture ingestion source %s: %d (id %t)\n", side.baseURL, result.status, ok)
	if !ok {
		return
	}
	side.symbols.file("sourceid", id)
	side.symbols.pinned["sourceid"] = id
	secret, ok := trpcData(result.body, "ingestSecret")
	if !ok {
		return
	}
	pushed := engine.fixtureRequest(fixtureCall{method: http.MethodPost, url: side.baseURL + "/api/ingest/otel/" + url.PathEscape(id),
		headers: map[string]string{"Authorization": "Bearer " + secret}, body: fixtureTraceBody(time.Now())})
	engine.progress("fixture ingestion source span %s: %d\n", side.baseURL, pushed.status)
	events := fixtureCall{method: http.MethodGet, url: side.baseURL + "/api/auth/cli/governance/ingest/sources/" + url.PathEscape(id) + "/events",
		headers: map[string]string{"Authorization": "Bearer " + side.credentials[credCLIToken]}}
	read, waited := engine.pollFixture(events, fixtureSettleWait, func(read rawResult) bool {
		listed, _ := read.body["events"].([]any)
		return len(listed) > 0
	})
	engine.progress("fixture ingestion source events %s: %d after %s\n", side.baseURL, read.status, waited)
}

// trpcMutation calls one tRPC mutation with the admin's session. Main's tRPC
// reads a superjson envelope and the branch's plain JSON, so both are tried.
func (engine *probeEngine) trpcMutation(side fixtureSide, procedure string, input map[string]any) rawResult {
	cookie := side.credentials[credSessionCookie]
	if cookie == "" {
		return rawResult{}
	}
	headers := map[string]string{"Cookie": cookie, "Origin": browserOrigin(side.baseURL)}
	var result rawResult
	for _, body := range []any{input, map[string]any{"json": input}} {
		result = engine.fixtureRequest(fixtureCall{method: http.MethodPost, url: side.baseURL + procedure, headers: headers, body: body})
		if result.status == http.StatusOK {
			return result
		}
	}
	return result
}

// trpcData reads a field of a tRPC answer in either transformer's form.
func trpcData(body map[string]any, field string) (string, bool) {
	for _, prefix := range []string{"result.data.", "result.data.json."} {
		if value, ok := fieldString(body, prefix+field); ok {
			return value, true
		}
	}
	return "", false
}

// budgetsPath is the gateway's budget create, whose budget the CLI overview lists.
const budgetsPath = "/api/gateway/v1/budgets"

// budgetsProcedure is the dashboard's budget create, the fallback where a
// side refuses the REST create (the branch answers it 500; see the handoff).
const budgetsProcedure = "/api/trpc/gatewayBudgets.create"

// createOrganizationBudget creates a monthly organization budget with the
// project key, then the admin's personal key, then the admin's session.
func (engine *probeEngine) createOrganizationBudget(side fixtureSide) {
	keys := engine.options.Keys
	body := map[string]any{
		"scope": map[string]any{"kind": "organization", "organization_id": seededOrganizationID},
		"name":  "apidiff budget", "window": "month", "limit_usd": 100,
	}
	credentials := []map[string]string{
		{"X-Auth-Token": keys.ProjectKey},
		{"Authorization": "Bearer " + keys.OrgKey, "X-Project-Id": seededProjectID},
	}
	for _, headers := range credentials {
		result := engine.fixtureRequest(fixtureCall{method: http.MethodPost, url: side.baseURL + budgetsPath, headers: headers, body: body})
		engine.progress("fixture budget %s: %d\n", side.baseURL, result.status)
		if result.status >= 200 && result.status < 300 {
			return
		}
	}
	result := engine.trpcMutation(side, budgetsProcedure, map[string]any{
		"organizationId": seededOrganizationID,
		"scope":          map[string]any{"kind": "ORGANIZATION", "organizationId": seededOrganizationID},
		"name":           "apidiff budget", "window": "MONTH", "limitUsd": 100,
	})
	engine.progress("fixture budget %s through the dashboard: %d\n", side.baseURL, result.status)
}
