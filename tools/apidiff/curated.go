package apidiff

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
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
//
// bucket and idField pin the created id where the collection path would
// misname it (a widget id the item routes call {widgetId}; a control request
// nested under "request"). credentials files response fields as credentials
// that side minted (side-credentials.go), and after runs once the create has
// been sent on both sides.
type curatedCreate struct {
	key          string
	body         any
	captureUnder string
	bucket       string
	idField      string
	credentials  map[string]string
	after        func(*probeEngine)
}

// langyWorkspace is the folder a connected local Langy session shares.
var langyWorkspace = map[string]any{"root": "/tmp/apidiff-workspace", "name": "apidiff-workspace", "os": "linux"}

// curatedCreates run first, in this order: every prerequisite precedes what
// needs it (evaluator before monitor, scenario and agent before suite, suite
// before run plan).
var curatedCreates = []curatedCreate{
	// The CLI's governance lists read what these create: a template, a
	// personal ingestion key, then (seedGovernance) a source and a budget.
	{key: "POST /api/governance/ingestion-templates"},
	{key: "POST /api/auth/cli/governance/ingestion-key", after: (*probeEngine).seedGovernance,
		body: map[string]any{"source_type": "copilot_app", "device_label": "apidiff"}},
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
		"type": "SCENARIO_RUN_STARTED", "timestamp": "{{now}}",
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
	}, after: (*probeEngine).emitGatewaySpend},
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
	{key: "PUT /api/model-providers/{provider}", body: map[string]any{
		"enabled": true, "customKeys": map[string]any{"OPENAI_API_KEY": "sk-apidiff-throwaway"},
	}},
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
	{key: "POST /api/projects/{projectId}/analytics/dashboard-widgets", bucket: "widgetid", body: map[string]any{
		"name": "apidiff widget", "code": "export default function Widget() { return null; }",
		"queries": []any{map[string]any{"name": "q", "sql": "SELECT 1 AS value"}},
	}},
	{key: "POST /api/instant-evals", body: map[string]any{
		"name": "apidiff instant eval", "sql": "SELECT TraceId, eval(TraceName, 'The trace is named apidiff') AS named FROM traces",
		"start": "{{window:from}}", "end": "{{window:to}}", "limit": 1,
		"questions": []any{map[string]any{"id": "q1", "kind": "boolean", "instructions": "Is the answer polite?"}},
	}, after: (*probeEngine).awaitInstantEval},
	// Langy, in the order a connected local session lives: a turn, the
	// request to share a folder, its approval (a session key), the folder's
	// registration (an instance token), a local call and a question the
	// worker asks, the folder's poll and frames, and last the turn's result.
	{key: "POST /api/langy/conversations", body: map[string]any{
		"messages":       []any{map[string]any{"role": "user", "content": "apidiff question"}},
		"idempotencyKey": "apidiff-turn-1",
	}, after: (*probeEngine).awaitLangyConversation},
	{key: "POST /api/langy/local/requests", captureUnder: "/api/langy/control/requests", bucket: "requestid", idField: "request.id",
		body: map[string]any{"conversationId": "{{conversationid}}"}},
	{key: "GET /api/langy/control/requests"},
	{key: "POST /api/langy/control/requests/{requestId}/approve", credentials: map[string]string{"sessionKey": credLangySession},
		body: map[string]any{"workspace": langyWorkspace}},
	{key: "POST /api/langy/control/connect/register", credentials: map[string]string{"instanceToken": credLangyInstance},
		body: map[string]any{
			"protocol": 1, "type": "register",
			"cli":       map[string]any{"name": "langwatch", "version": "0.0.0-apidiff"},
			"instance":  map[string]any{"id": "apidiff-instance", "hostname": "apidiff", "username": "apidiff", "pid": 1, "startedAt": "2026-01-01T00:00:00Z"},
			"workspace": langyWorkspace,
		}},
	{key: "POST /api/langy/local/calls", body: map[string]any{
		"conversationId": "{{conversationid}}", "turnId": "{{turnid}}",
		"tool": "local_ls", "params": map[string]any{"path": "."},
	}},
	{key: "POST /api/langy/waits", body: map[string]any{
		"conversationId": "{{conversationid}}", "turnId": "{{turnid}}", "kind": "question",
		"questions": []any{map[string]any{"question": "apidiff?", "options": []any{map[string]any{"label": "yes"}}}},
	}},
	{key: "GET /api/langy/control/connect/poll"},
	{key: "POST /api/langy/control/connect/frames", body: map[string]any{
		"frames": []any{map[string]any{"protocol": 1, "type": "ack", "callId": "{{callid}}"}},
	}},
	{key: "GET /api/langy/local/calls/{id}"},
	{key: "GET /api/langy/waits/{id}"},
	{key: "POST /api/internal/langy/turn/{turnId}/result", body: map[string]any{
		"projectId": "{{const:projectid}}", "conversationId": "{{conversationid}}",
		"status": "completed", "text": "apidiff answer",
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
	if name == "now" {
		return time.Now().UnixMilli(), ""
	}
	if bound, ok := strings.CutPrefix(name, "window:"); ok {
		return windowISO(bound)
	}
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

// windowISO renders one bound of the run window as an ISO timestamp, for the
// bodies that take a range as dates rather than epoch milliseconds.
func windowISO(bound string) (any, string) {
	millis := map[string]string{"from": synthFromMillis, "to": synthToMillis}[bound]
	parsed, err := strconv.ParseInt(millis, 10, 64)
	if err != nil {
		return nil, "window:" + bound
	}
	return time.UnixMilli(parsed).UTC().Format(time.RFC3339), ""
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
