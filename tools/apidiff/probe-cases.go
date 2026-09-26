package apidiff

import (
	"net/http"
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
			cases[index] = probeCase{name: "mutation", body: bodyA, bodyB: bodyB, perSide: true, captures: create.captureUnder}
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

// pinCreated pins the id one side's curated create minted under the resource
// its collection path names.
func pinCreated(symbols *SymbolTable, collectionPath string, result SideResult) {
	if result.Status < 200 || result.Status >= 300 {
		return
	}
	id, ok := firstCapturedID(result.Body)
	bucket := resourceParamName(collectionPath, "")
	if ok && bucket != "" {
		symbols.pinned[bucket] = id
	}
}

// unmintableReasons name why a parameter has no value on either side, for the
// ids only a running collaborator the run does not host can mint.
var unmintableReasons = map[string]string{
	"turnid":         "a Langy turn exists only inside a conversation the langy agent service runs, and the run starts none",
	"conversationid": "a Langy conversation is started through the langy agent service, and the run starts none",
	"requestid":      "a Langy control request is raised by a connected local Langy session, and the run connects none",
	"callid":         "a Langy local call needs a connected local Langy session, and the run connects none",
	"waitid":         "a Langy wait needs a connected local Langy session, and the run connects none",
	"sourceid":       "an ingest source is registered with the langwatch CLI's device-login token, which the run does not mint",
	"eventid":        "a webhook event is recorded when the AI gateway settles a request, and the run starts no gateway",
	"instantevalid":  "an instant evaluation needs the LangWatchQL ClickHouse identity (LWQL_CLICKHOUSE_URL, LWQL_CLICKHOUSE_USER, LWQL_DATABASE and the tenant access model), which the run provisions on neither side",
	"widgetid":       "a dashboard widget needs release_custom_chart_playground, which turns the saved-chart routes off in the same project; the run keeps saved charts on",
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
