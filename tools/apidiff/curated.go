package apidiff

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
)

// curatedCreate is a hand-written create body for an operation whose handler
// enforces refinements its schema cannot express (a discriminator, a name
// pattern, a prerequisite id), so a synthesized body is refused on both sides
// and nothing is ever created for the operations that need its id.
//
// A string value "{{bucket}}" is filled per side from that side's own symbol
// table, and "{{const:name}}" from SeededConstants. A nil body only orders the
// operation: its synthesized body already creates, but something later needs
// what it creates. captureUnder files the created id as if a create at that
// collection path had answered, for a create whose own path names the wrong
// resource (POST /api/run-plans/run creates a run plan, not a "run").
type curatedCreate struct {
	key          string
	body         any
	captureUnder string
}

// curatedCreates run first, in this order: every prerequisite precedes what
// needs it (evaluator before monitor, scenario and agent before suite, suite
// before run plan).
var curatedCreates = []curatedCreate{
	{key: "POST /api/evaluators", body: map[string]any{
		"name":   "apidiff evaluator",
		"config": map[string]any{"evaluatorType": "langevals/exact_match", "settings": map[string]any{}},
	}},
	{key: "POST /api/monitors", body: map[string]any{
		"name": "apidiff monitor", "checkType": "langevals/exact_match",
		"evaluatorId": "{{evaluatorid}}", "executionMode": "MANUALLY",
	}},
	{key: "POST /api/agents", body: map[string]any{
		"name": "apidiff agent", "type": "http",
		"config": map[string]any{"name": "apidiff agent", "url": synthURI, "method": "POST"},
	}},
	{key: "POST /api/scenarios"},
	{key: "POST /api/scenario-events", body: map[string]any{
		"type": "SCENARIO_RUN_STARTED", "timestamp": 1767225600000,
		"scenarioId": "{{scenarioid}}", "scenarioRunId": "{{const:scenariorunid}}",
		"batchRunId": "{{const:batchrunid}}", "scenarioSetId": "{{const:scenariosetid}}",
		"metadata": map[string]any{"name": "apidiff scenario run"},
	}},
	{key: "POST /api/suites", body: map[string]any{
		"name":        "apidiff suite",
		"scenarioIds": []any{"{{scenarioid}}"},
		"targets":     []any{map[string]any{"type": "http", "referenceId": "{{agentid}}"}},
	}},
	{key: "POST /api/run-plans/run", captureUnder: "/api/run-plans", body: map[string]any{
		"name": "apidiff run plan",
		"config": map[string]any{
			"scope":   map[string]any{"mode": "test_suites", "testSuiteIds": []any{"{{suiteid}}"}},
			"targets": []any{map[string]any{"type": "http", "referenceId": "{{agentid}}"}},
		},
	}},
	{key: "POST /api/roles", body: map[string]any{"name": "apidiff role", "permissions": []any{"project:view"}}},
	{key: "POST /api/secrets", body: map[string]any{"name": "APIDIFF_SECRET", "value": "apidiff"}},
	{key: "POST /api/webhooks/v1/endpoints", body: map[string]any{
		"destination_kind": "http", "url": synthURI,
		"enabled_events": []any{"gateway.request.completed"},
	}},
	{key: "POST /api/model-defaults", body: map[string]any{
		"config": map[string]any{"DEFAULT": "openai/gpt-5-mini"},
		"scopes": []any{map[string]any{"scopeType": "PROJECT", "scopeId": "{{const:projectid}}"}},
	}},
	{key: "POST /api/experiments", body: map[string]any{"name": "apidiff experiment"}},
	{key: "POST /api/organization/invites", body: map[string]any{"invites": []any{map[string]any{
		"email": "apidiff-invite@example.com", "role": "MEMBER",
		"teams": []any{map[string]any{"teamId": "{{const:teamid}}", "role": "MEMBER"}},
	}}}},
	{key: "POST /api/groups"},
	{key: "POST /api/groups/{groupId}/members", body: map[string]any{"userId": fixtureDoomedUserID}},
	{key: "POST /api/groups/{groupId}/bindings", body: map[string]any{
		"role": "VIEWER", "scopeType": "PROJECT", "scopeId": "{{const:projectid}}",
	}},
	{key: "PUT /api/model-providers/{provider}"},
	{key: "POST /api/annotations/trace/{id}", captureUnder: "/api/annotations", body: map[string]any{
		"comment": "apidiff annotation", "isThumbsUp": true,
	}},
	{key: "POST /api/stored-objects/uploads", captureUnder: "/api/stored-objects", body: map[string]any{
		"projectId": "{{const:projectid}}", "purpose": "dataset_import",
		"filename": "apidiff.csv", "mediaType": "text/csv", "byteLength": 3,
	}},
	{key: "POST /api/projects/{projectId}/analytics/charts", body: map[string]any{
		"name":       "apidiff chart",
		"definition": map[string]any{"version": 1, "sql": "SELECT 1 AS value"},
	}},
	{key: "POST /api/projects/{projectId}/analytics/dashboard-widgets", body: map[string]any{
		"name": "apidiff widget", "code": "export default function Widget() { return null; }",
		"queries": []any{map[string]any{"name": "q", "sql": "SELECT 1 AS value"}},
	}},
	{key: "POST /api/instant-evals", body: map[string]any{
		"name": "apidiff instant eval", "target": "traces", "sql": "SELECT trace_id FROM traces",
		"start": synthDateTime, "end": "2026-01-02T00:00:00Z", "limit": 1,
		"questions": []any{map[string]any{"id": "q1", "kind": "boolean", "instructions": "Is the answer polite?"}},
	}},
}

var curatedIndex = indexCurated(curatedCreates)

func indexCurated(creates []curatedCreate) map[string]int {
	index := make(map[string]int, len(creates))
	for position, create := range creates {
		index[create.key] = position
	}
	return index
}

// curatedFor returns the curated create for an operation, if one is written.
func curatedFor(operation Operation) (curatedCreate, bool) {
	position, ok := curatedIndex[operationKeyOf(operation)]
	if !ok {
		return curatedCreate{}, false
	}
	return curatedCreates[position], true
}

// probeOrder is the order the main pass runs in: the curated creates first,
// in dependency order, then every other non-DELETE operation in path order,
// then every DELETE. A DELETE sorts before the GET/PATCH at its own path, so
// in path order it destroyed the entity the rest of its family was about to
// read and every later probe met a 404 on both sides.
func probeOrder(operations []Operation) []Operation {
	ordered := append([]Operation(nil), operations...)
	sort.SliceStable(ordered, func(i, j int) bool {
		return orderRank(ordered[i]) < orderRank(ordered[j])
	})
	return ordered
}

func orderRank(operation Operation) int {
	if position, ok := curatedIndex[operationKeyOf(operation)]; ok {
		return position - len(curatedCreates)
	}
	if operation.Method == http.MethodDelete {
		return 1
	}
	return 0
}

// fillTemplate resolves a curated body against one side's symbol table. It
// returns the filled body, or the name of the first placeholder that side
// has nothing for.
func fillTemplate(value any, symbols *SymbolTable) (any, string) {
	switch typed := value.(type) {
	case map[string]any:
		return fillObject(typed, symbols)
	case []any:
		return fillSlice(typed, symbols)
	case string:
		return fillPlaceholder(typed, symbols)
	default:
		return value, ""
	}
}

func fillObject(object map[string]any, symbols *SymbolTable) (any, string) {
	filled := make(map[string]any, len(object))
	for _, key := range sortedKeys(object) {
		value, missing := fillTemplate(object[key], symbols)
		if missing != "" {
			return nil, missing
		}
		filled[key] = value
	}
	return filled, ""
}

func fillSlice(values []any, symbols *SymbolTable) (any, string) {
	filled := make([]any, 0, len(values))
	for _, child := range values {
		value, missing := fillTemplate(child, symbols)
		if missing != "" {
			return nil, missing
		}
		filled = append(filled, value)
	}
	return filled, ""
}

func fillPlaceholder(text string, symbols *SymbolTable) (any, string) {
	if !strings.HasPrefix(text, "{{") || !strings.HasSuffix(text, "}}") {
		return text, ""
	}
	name := strings.TrimSuffix(strings.TrimPrefix(text, "{{"), "}}")
	if constant, ok := strings.CutPrefix(name, "const:"); ok {
		value, found := SeededConstants[constant]
		if !found {
			return nil, name
		}
		return value, ""
	}
	if value, ok := symbols.latest(name); ok {
		return value, ""
	}
	return nil, name
}

// curatedBodies fills one curated body for both sides; missing names the side
// and placeholder that could not be filled.
func curatedBodies(create curatedCreate, symbolsA, symbolsB *SymbolTable) (bodyA, bodyB any, missing string) {
	bodyA, missingA := fillTemplate(create.body, symbolsA)
	if missingA != "" {
		return nil, nil, fmt.Sprintf("curated body for %s needs %s, which nothing created on the candidate", create.key, missingA)
	}
	bodyB, missingB := fillTemplate(create.body, symbolsB)
	if missingB != "" {
		return nil, nil, fmt.Sprintf("curated body for %s needs %s, which nothing created on the base", create.key, missingB)
	}
	return bodyA, bodyB, ""
}

// userBoundPrefixes are the operations that refuse a key no user owns
// (model_default_user_key_required, user_token_required,
// langy_api_key_unowned). They are sent the seeded personal access token,
// which the admin user owns, with the seeded project named in X-Project-Id,
// the form both sides accept for a user key on a project route.
var userBoundPrefixes = []string{
	"/api/model-defaults",
	"/api/governance/ingestion-templates",
	"/api/langy/local",
	"/api/langy/waits",
	"/api/langy/conversations",
	"/api/langy/control/requests",
}

func needsUserBoundKey(path string) bool {
	return excluded(path, userBoundPrefixes)
}

// userBoundHeaders replaces a project-key credential with the seeded personal
// access token on the operations that require a user-owned key.
func userBoundHeaders(operation Operation, headers map[string]string, keys Keys) map[string]string {
	if !needsUserBoundKey(operation.Path) || keys.OrgKey == "" {
		return headers
	}
	return map[string]string{"Authorization": "Bearer " + keys.OrgKey, "X-Project-Id": seededProjectID}
}
