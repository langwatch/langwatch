package visualdiff

import (
	"context"
	"fmt"
	"net/http"
)

// Fixtures the flow suite's seed adds; a flow names one as {errorTrace} and so on.
const (
	FixtureErrorTrace   = "errorTrace"
	FixtureConversation = "conversation"
	FixtureBugReport    = "bugReport"
	// FixtureIsolatedSlug and FixtureIsolatedKey name the second project an
	// isolated flow works in ({isolatedSlug}); nothing seeds them yet.
	FixtureIsolatedSlug = "isolatedSlug"
	FixtureIsolatedKey  = "isolatedProjectKey"
)

// SeedDatasetSlug is the slug the seeded dataset gets from its name.
const SeedDatasetSlug = "visual-diff-qa"

// conversationTurns is the thread the conversation fixture spans: two traces.
const conversationTurns = 2

// flowSeedRequest is the flow-suite fixtures one stack gets on top of Seed's.
type flowSeedRequest struct {
	client *http.Client
	apiURL string
	key    string
	now    int64
}

// seedForFlows writes what the flow suite asserts on: an error trace, a
// two-turn conversation, rows in the dataset and a bug report. Each failure is a
// warning, since the run's other flows still hold without it.
func seedForFlows(ctx context.Context, request flowSeedRequest) (fixtures map[string]string, warnings []string) {
	fixtures = map[string]string{}
	warn := func(name string, err error) {
		warnings = append(warnings, fmt.Sprintf("%s not seeded: %v", name, err))
	}
	traces := map[string]map[string]any{SeedErrorTraceID: seedErrorTrace(SeedErrorTraceID, request.now)}
	for turn := range conversationTurns {
		id := fmt.Sprintf("%s%d", SeedConversationPrefix, turn)
		traces[id] = seedTurn(id, turn, request.now)
	}
	for id, body := range traces {
		if err := post(ctx, request.client, postSpec{url: request.apiURL + "/api/collector", key: request.key, body: body}); err != nil {
			warn("trace "+id, err)
		}
	}
	fixtures[FixtureErrorTrace] = SeedErrorTraceID
	fixtures[FixtureConversation] = SeedConversationThread
	rows := postSpec{
		url: request.apiURL + "/api/dataset/" + SeedDatasetSlug + "/records", key: request.key,
		body: map[string]any{"entries": seedDatasetRows()},
	}
	if err := post(ctx, request.client, rows); err != nil {
		warn("dataset rows", err)
	}
	report := postSpec{url: request.apiURL + "/api/bug-reports", body: seedBugReport()}
	answer, err := postReading(ctx, request.client, report)
	if err != nil {
		warn(FixtureBugReport, err)
		return fixtures, warnings
	}
	if id, err := StringAt(answer, "id"); err == nil {
		fixtures[FixtureBugReport] = id
	} else {
		warn(FixtureBugReport, err)
	}
	return fixtures, warnings
}

// The traces the flow seed writes, named so a flow finds them by name.
const (
	SeedErrorTraceID       = SeedTraceIDPrefix + "error"
	SeedConversationPrefix = SeedTraceIDPrefix + "turn_"
	SeedConversationThread = "visualdiff-conversation"
)

// seedErrorTrace is a trace whose root span failed, for the Errors lens.
func seedErrorTrace(traceID string, now int64) map[string]any {
	start := now - 1_800_000
	root := map[string]any{
		"type": "span", "span_id": traceID + "_root", "trace_id": traceID, "name": "failing_request",
		"input":      map[string]any{"type": "text", "value": "Question that fails"},
		"error":      map[string]any{"has_error": true, "message": "Visual diff seeded failure", "stacktrace": []string{"seed.go: seeded error"}},
		"timestamps": map[string]any{"started_at": start, "finished_at": start + 900},
	}
	return map[string]any{
		"trace_id": traceID, "spans": []map[string]any{root},
		"metadata": map[string]any{"user_id": "user_0", "labels": []string{"visual-diff"}},
	}
}

// seedTurn is one turn of the seeded conversation: traces sharing a thread id.
func seedTurn(traceID string, turn int, now int64) map[string]any {
	start := now - int64(turn+1)*600_000
	root := map[string]any{
		"type": "span", "span_id": traceID + "_root", "trace_id": traceID, "name": "chat_turn",
		"input":      map[string]any{"type": "text", "value": fmt.Sprintf("Turn %d question", turn)},
		"output":     map[string]any{"type": "text", "value": fmt.Sprintf("Turn %d answer", turn)},
		"timestamps": map[string]any{"started_at": start, "finished_at": start + 1200},
	}
	return map[string]any{
		"trace_id": traceID, "spans": []map[string]any{root},
		"metadata": map[string]any{"thread_id": SeedConversationThread, "user_id": "user_1", "labels": []string{"visual-diff"}},
	}
}

// seedDatasetRows are the seeded dataset's rows, keyed by its two columns.
func seedDatasetRows() []map[string]string {
	return []map[string]string{
		{"input": "What is visual diff?", "expected_output": "A screenshot comparison tool."},
		{"input": "What is a flow?", "expected_output": "A scripted walk through the UI."},
		{"input": "What is a fixture?", "expected_output": "Data the seed writes for a screen to show."},
	}
}

// seedBugReport is a report filed the way a coding agent files one.
func seedBugReport() map[string]any {
	return map[string]any{
		"source": "cli", "kind": "summary", "title": "Visual diff seeded report",
		"summary": "Filed by visualdiff's seed so the ops bug-report screen has a row.",
	}
}
