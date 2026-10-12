package apidiff

import (
	"net/http"
	"net/url"
	"time"
)

// fixtureSettleWait bounds how long a create's follow-up waits for what the
// create started to land (a worker projection, a judged run).
var fixtureSettleWait = 90 * time.Second

// langyConversationWait is shorter: the conversation projection folds within
// seconds when the worker drains it (Alex, 2026-09-27: eventual by design).
var langyConversationWait = 30 * time.Second

// awaitLangyConversation waits until each side can read the conversation it
// just started. The branch reads conversations from a projection the worker
// writes, so the chain that follows (the local request, calls, waits and the
// turn's result) would otherwise meet langy_conversation_not_found.
func (engine *probeEngine) awaitLangyConversation() {
	headers := map[string]string{"Authorization": "Bearer " + engine.options.Keys.OrgKey, "X-Project-Id": seededProjectID}
	for _, side := range engine.fixtureSides() {
		conversationID, ok := side.symbols.latest("conversationid")
		if !ok {
			continue
		}
		call := fixtureCall{method: http.MethodGet, headers: headers,
			url: side.baseURL + "/api/langy/local/workspace?conversationId=" + url.QueryEscape(conversationID)}
		result, waited := engine.pollFixture(call, langyConversationWait, func(result rawResult) bool {
			return result.status != 0 && errorCode(result.body) != "langy_conversation_not_found"
		})
		engine.progress("fixture langy conversation readable on %s: %d after %s\n", side.baseURL, result.status, waited)
	}
}

// instantEvalRunning are the run states a judged run passes through before
// it settles.
var instantEvalRunning = map[string]bool{"queued": true, "planning": true, "running": true}

// awaitInstantEval waits until each side's run has settled, so its results
// and sample are read after the judge has answered rather than before.
func (engine *probeEngine) awaitInstantEval() {
	headers := map[string]string{"X-Auth-Token": engine.options.Keys.ProjectKey}
	for _, side := range engine.fixtureSides() {
		runID, ok := side.symbols.Lookup("id", "/api/instant-evals/{id}")
		if !ok {
			continue
		}
		call := fixtureCall{method: http.MethodGet, headers: headers, url: side.baseURL + "/api/v1/instant-evals/" + url.PathEscape(runID)}
		result, waited := engine.pollFixture(call, fixtureSettleWait, func(result rawResult) bool {
			status, _ := result.body["status"].(string)
			return result.status == http.StatusOK && !instantEvalRunning[status]
		})
		engine.progress("fixture instant eval on %s: %d %v after %s\n", side.baseURL, result.status, result.body["status"], waited)
	}
}

// pollFixture repeats one fixture request until settled accepts its answer or
// the wait runs out, and returns the last answer and how long it took.
func (engine *probeEngine) pollFixture(call fixtureCall, wait time.Duration, settled func(rawResult) bool) (rawResult, time.Duration) {
	started := time.Now()
	deadline := started.Add(wait)
	result := engine.fixtureRequest(call)
	for !settled(result) && time.Now().Before(deadline) && engine.backoff(1) {
		result = engine.fixtureRequest(call)
	}
	return result, time.Since(started).Round(time.Second)
}

// errorCode reads a refusal's code from either side's envelope: the branch's
// flat {code} or main's nested {error: {code}}.
func errorCode(body map[string]any) string {
	if code, ok := body["code"].(string); ok {
		return code
	}
	if code, ok := fieldString(body, "error.code"); ok {
		return code
	}
	return ""
}
