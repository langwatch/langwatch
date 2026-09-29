package visualdiff

import (
	"context"
	"fmt"
	"maps"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Fixtures the flow suite's seed adds; a flow names one as {errorTrace} and so on.
const (
	FixtureErrorTrace   = "errorTrace"
	FixtureConversation = "conversation"
	FixtureBugReport    = "bugReport"
	// FixtureIsolatedSlug and FixtureIsolatedKey name the second project an
	// isolated flow works in ({isolatedSlug}); seedIsolatedProject creates it.
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

// seedForFlows writes what the flow suite asserts on, all at once: an error trace,
// a two-turn conversation, a bug report and the isolated flows' second project. Each
// failure is a warning, since the run's other flows still hold without it.
func seedForFlows(ctx context.Context, request flowSeedRequest) (map[string]string, []string) {
	fixtures := map[string]string{FixtureErrorTrace: SeedErrorTraceID, FixtureConversation: SeedConversationThread}
	var warnings []string
	var mutex sync.Mutex
	keep := func(found map[string]string, name string, err error) {
		mutex.Lock()
		defer mutex.Unlock()
		maps.Copy(fixtures, found)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s not seeded: %v", name, err))
		}
	}
	traces := map[string]map[string]any{SeedErrorTraceID: seedErrorTrace(SeedErrorTraceID, request.now)}
	for turn := range conversationTurns {
		id := fmt.Sprintf("%s%d", SeedConversationPrefix, turn)
		traces[id] = seedTurn(id, turn, request.now)
	}
	var group sync.WaitGroup
	for id, body := range traces {
		group.Go(func() {
			keep(nil, "trace "+id, post(ctx, request.client, postSpec{url: request.apiURL + "/api/collector", key: request.key, body: body}))
		})
	}
	group.Go(func() {
		answer, err := postReading(ctx, request.client, postSpec{url: request.apiURL + "/api/bug-reports", body: seedBugReport()})
		var id string
		if err == nil {
			id, err = StringAt(answer, "id")
		}
		keep(map[string]string{FixtureBugReport: id}, FixtureBugReport, err)
	})
	group.Go(func() {
		isolated, err := seedIsolatedProject(ctx, request)
		keep(isolated, FixtureIsolatedSlug, err)
	})
	group.Wait()
	if fixtures[FixtureBugReport] == "" {
		delete(fixtures, FixtureBugReport)
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

// The seeded organization's team and its full-access private token, as apps/tasks's
// storage-seed writes them (tools/thuishaven/domain/identity.go names the token).
const (
	SeededTeamID             = "local-dev-team"
	SeededPrivateAccessToken = "sk-lw-LocalDevPrivate1_LocalDevPrivateAccessTokenSecretFixedValue000000" // #nosec G101 -- the public local-dev token every haven stack seeds.
)

// isolatedAttempts is how often the second project is asked for before it is a warning.
const isolatedAttempts = 3

// seedIsolatedProject creates the second project an isolated flow works in, in the
// seeded team, named by the seed's time so a reseed never collides with an earlier one.
func seedIsolatedProject(ctx context.Context, request flowSeedRequest) (map[string]string, error) {
	body := map[string]any{
		"name": fmt.Sprintf("Visual Diff Isolated %d", request.now), "teamId": SeededTeamID,
		"language": "typescript", "framework": "openai",
	}
	answer, err := postReading(ctx, request.client, postSpec{url: request.apiURL + "/api/projects", key: SeededPrivateAccessToken, body: body})
	for attempt := 1; err != nil && strings.Contains(err.Error(), "answered 503") && attempt < isolatedAttempts; attempt++ {
		// The grant's projection can miss the API's window under load (AuthzGrantNotConfirmedError).
		time.Sleep(time.Duration(attempt) * time.Second)
		body["name"] = fmt.Sprintf("Visual Diff Isolated %d-%d", request.now, attempt)
		answer, err = postReading(ctx, request.client, postSpec{url: request.apiURL + "/api/projects", key: SeededPrivateAccessToken, body: body})
	}
	if err != nil {
		return nil, err
	}
	slug, err := StringAt(answer, "slug")
	if err != nil {
		return nil, err
	}
	key, err := StringAt(answer, "serviceApiKey")
	if err != nil {
		return nil, err
	}
	return map[string]string{FixtureIsolatedSlug: slug, FixtureIsolatedKey: key}, nil
}
