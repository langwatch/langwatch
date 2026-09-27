package apidiff

import (
	"net/http"
	"strings"
	"time"
)

// resolveBothSides resolves an operation's parameters on each side that
// serves it. A side that does not serve the operation is only asked whether
// it answers at all, so its missing ids cannot turn a one-sided operation
// into a skip.
func (engine *probeEngine) resolveBothSides(operation Operation) (paramsA, paramsB resolvedParams, unresolved *Finding) {
	deleteOp := operation.Method == http.MethodDelete
	paramsA, unresolvedA := resolveParams(operation, engine.symbolsA, deleteOp)
	paramsB, unresolvedB := resolveParams(operation, engine.symbolsB, deleteOp)
	if !operation.InA {
		unresolvedA = ""
	}
	if !operation.InB {
		unresolvedB = ""
	}
	if unresolvedA == "" && unresolvedB == "" {
		return paramsA, paramsB, nil
	}
	finding := unresolvedFinding(operation, unresolvedA, unresolvedB)
	return resolvedParams{}, resolvedParams{}, &finding
}

// casesFor is operationCases with the curated create body, filled per side,
// in place of the synthesized mutation. The second return names why a
// curated create cannot be sent at all.
func (engine *probeEngine) casesFor(operation Operation) ([]probeCase, string) {
	cases := operationCases(operation)
	create, ok := curatedFor(operation)
	if !ok || create.body == nil {
		return cases, ""
	}
	bodyA, bodyB, missing := curatedBodies(create, engine.symbolsA, engine.symbolsB)
	if missing != "" {
		return nil, missing
	}
	for index := range cases {
		if cases[index].name == "mutation" {
			cases[index] = probeCase{name: "mutation", body: bodyA, bodyB: bodyB, perSide: true, captures: create.captureUnder, curated: &create}
		}
	}
	return cases, ""
}

// captureSucceeded files one side's ids, from a successful answer only. An
// error envelope's trace_id or meta.id names nothing the side created, and
// filing it once let the candidate "resolve" a trace id the base never had.
func captureSucceeded(symbols *SymbolTable, path string, result SideResult) {
	if result.Status < 200 || result.Status >= 300 {
		return
	}
	symbols.Capture(path, decodedBody(result.Body))
}

// pin pins the id one side's curated create minted under the resource its
// collection path names, or under the create's own bucket and id field. A
// nil create pins by the collection path alone.
func (create *curatedCreate) pin(symbols *SymbolTable, collectionPath string, result SideResult) {
	if result.Status < 200 || result.Status >= 300 {
		return
	}
	bucket := resourceParamName(collectionPath, "")
	id, ok := firstCapturedID(result.Body)
	if create != nil && create.bucket != "" {
		bucket = create.bucket
	}
	if create != nil && create.idField != "" {
		id, ok = fieldString(decodedBody(result.Body), create.idField)
	}
	if ok && bucket != "" {
		symbols.file(bucket, id)
		symbols.pinned[bucket] = id
	}
}

// fieldString reads a dotted field ("request.id") out of a decoded body.
func fieldString(value any, dotted string) (string, bool) {
	for _, name := range strings.Split(dotted, ".") {
		object, ok := value.(map[string]any)
		if !ok {
			return "", false
		}
		value = object[name]
	}
	text, ok := value.(string)
	return text, ok && text != ""
}

// afterCurated files the credentials a curated create's answers carry into
// each side's own store, then runs the create's follow-up once.
func (engine *probeEngine) afterCurated(probeCase probeCase, transcript Transcript) {
	create := probeCase.curated
	if create == nil {
		return
	}
	for field, name := range create.credentials {
		if value, ok := fieldString(successBody(transcript.A), field); ok {
			engine.credsA[name] = value
		}
		if value, ok := fieldString(successBody(transcript.B), field); ok {
			engine.credsB[name] = value
		}
	}
	if create.after != nil {
		create.after(engine)
	}
}

func successBody(result SideResult) any {
	if result.Status < 200 || result.Status >= 300 {
		return nil
	}
	return decodedBody(result.Body)
}

// settledReads are the reads whose answer is filled asynchronously by a
// worker projection or a lazily computed read model. Each is re-read until
// both sides answer with content, or the wait runs out and the last answer is
// compared as it stands.
var settledReads = map[string]bool{
	"GET /api/simulation-runs":                          true,
	"GET /api/simulation-runs/{scenarioRunId}":          true,
	"GET /api/simulation-runs/batches/list":             true,
	"GET /api/simulation-runs/batches/{batchRunId}":     true,
	"GET /api/traces/facets":                            true,
	"GET /api/coding-agent/sessions/{sessionId}/events": true,
	"GET /api/webhooks/v1/events":                       true,
	"GET /api/webhooks/v1/endpoints/{id}/deliveries":    true,
	"GET /api/langy/control/requests":                   true,
}

var settledReadWait = 45 * time.Second

// settleRead re-reads a settled read until both sides have content.
func (engine *probeEngine) settleRead(operation Operation, target probeTarget, transcript Transcript) Transcript {
	if transcript.Case != "read" || !settledReads[operationKeyOf(operation)] {
		return transcript
	}
	deadline := time.Now().Add(settledReadWait)
	for unsettled(transcript) && time.Now().Before(deadline) && engine.backoff(3) {
		transcript = engine.runCase(operation, probeCase{name: transcript.Case}, target)
	}
	return transcript
}

// unsettled is whether either side still answers without content: a refusal,
// an empty list, or a read model that says it is still computing.
func unsettled(transcript Transcript) bool {
	for _, side := range []SideResult{transcript.A, transcript.B} {
		if side.Status < 200 || side.Status >= 300 || emptyListBody(side.Body) {
			return true
		}
		if decoded, ok := decodedBody(side.Body).(map[string]any); ok && decoded["pending"] == true {
			return true
		}
	}
	return false
}

// unmintableReasons name, for the ids only a fixture chain mints, which link
// of that chain answered nothing on either side.
var unmintableReasons = map[string]string{
	"turnid":         "a Langy turn is minted by POST /api/langy/conversations against the stub agent manager, which minted none on either side",
	"conversationid": "a Langy conversation is minted by POST /api/langy/conversations against the stub agent manager, which minted none on either side",
	"requestid":      "a Langy control request is raised by POST /api/langy/local/requests for the fixture conversation, which raised none on either side",
	"callid":         "a Langy local call needs the fixture conversation's turn and a registered folder, and POST /api/langy/local/calls started none on either side",
	"waitid":         "a Langy wait needs the fixture conversation's turn, and POST /api/langy/waits started none on either side",
	"sourceid":       "an ingest source is listed under the device-login token the run mints, and neither side listed one",
	"eventid":        "a webhook event is recorded from the fixture gateway spend, and neither side listed one",
	"instantevalid":  "an instant evaluation needs the LangWatchQL identity the run provisions and a configured judge, and POST /api/instant-evals created none on either side",
	"widgetid":       "a dashboard widget is created in the widget fixture project, and POST .../dashboard-widgets created none on either side",
}

// unresolvableReason names a skip: the parameter, and either why nothing can
// mint it or that no earlier create on either side returned one.
func unresolvableReason(param, operationPath string) string {
	if reason, ok := unmintableReasons[bucketOf(param, operationPath)]; ok {
		return "unresolvable parameter: " + param + " (" + reason + ")"
	}
	return "unresolvable parameter: " + param + " (no earlier create on either side returned one)"
}

// bucketOf is the symbol bucket a parameter resolves from.
func bucketOf(param, operationPath string) string {
	if buckets := lookupBuckets(param, operationPath); len(buckets) > 0 {
		return buckets[0]
	}
	return normalizeParamName(param)
}
