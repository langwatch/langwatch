package visualdiff

import (
	"context"
	"fmt"
	"strconv"
)

// Fixtures the coding-assistant seed adds: two sessions ingested the way the
// `langwatch ingest` hooks send them, and the seeded organization's key that
// the org-scoped gateway reads take.
const (
	FixtureCodingSession     = "codingSession"
	FixtureCodingSessionBeta = "codingSessionBeta"
	FixtureOrgKey            = "orgKey"
)

// The sessions' fixed identity. Deterministic on purpose: a reseed folds into the
// same rows, and a flow may name the repository, branch and title literally.
const (
	CodingSessionAlpha  = "vd-coding-alpha"
	CodingSessionBeta   = "vd-coding-beta"
	CodingRepoOwner     = "vd-org"
	CodingRepoName      = "vd-repo"
	CodingAlphaBranch   = "feat/vd-alpha"
	CodingBetaFirstRef  = "main"
	CodingBetaBranch    = "feat/vd-beta"
	CodingAlphaTitle    = "Visual diff alpha session"
	CodingBetaTitle     = "Visual diff beta session"
	CodingAlphaTool     = "Bash"
	claudeEventsScope   = "com.anthropic.claude_code.events"
	langwatchHookScope  = "langwatch.coding_agent.hook"
	sessionContextEvent = "langwatch.session_context"
)

// seedCodingSessions posts the sessions' logs and one model-call span through the
// OTLP receivers, with the project key, the public path the ingest CLI uses.
func seedCodingSessions(ctx context.Context, request flowSeedRequest) (map[string]string, error) {
	logs := codingSessionLogs(request.now)
	spans := codingSessionSpans(request.now)
	for index, body := range append(logs, spans...) {
		path := "/api/otel/v1/logs"
		if index >= len(logs) {
			path = "/api/otel/v1/traces"
		}
		if err := post(ctx, request.client, postSpec{url: request.apiURL + path, key: request.key, body: body}); err != nil {
			return nil, fmt.Errorf("coding session payload %d: %w", index, err)
		}
	}
	return map[string]string{FixtureCodingSession: CodingSessionAlpha, FixtureCodingSessionBeta: CodingSessionBeta}, nil
}

// codingSessionLogs are the two sessions' log requests: alpha is a Claude Code
// session with a prompt and one billed model call on a feature branch; beta is a
// Codex session that declares itself on main, then moves to its own branch.
func codingSessionLogs(now int64) []map[string]any {
	minute := int64(60_000)
	alpha := []map[string]any{
		logRecord(now-9*minute, sessionContextEvent, CodingSessionAlpha, map[string]any{
			"coding_agent.name": "claude_code", "vcs.repository.host": "github.com",
			"vcs.repository.owner": CodingRepoOwner, "vcs.repository.name": CodingRepoName,
			"vcs.ref.head.name": CodingAlphaBranch, "langwatch.session.name": CodingAlphaTitle,
		}),
		logRecord(now-8*minute, "claude_code.user_prompt", CodingSessionAlpha, map[string]any{
			"prompt": "Make the visual diff seed deterministic", "prompt_length": 39, "prompt.id": "vd-prompt-1",
		}),
		logRecord(now-7*minute, "claude_code.api_request", CodingSessionAlpha, map[string]any{
			"model": "claude-sonnet-4-20250514", "input_tokens": 1200, "output_tokens": 340,
			"cache_read_tokens": 800, "cache_creation_tokens": 100, "cost_usd": 0.012,
			"duration_ms": 2100, "prompt.id": "vd-prompt-1",
		}),
	}
	beta := []map[string]any{
		logRecord(now-6*minute, sessionContextEvent, CodingSessionBeta, map[string]any{
			"coding_agent.name": "codex", "vcs.repository.host": "github.com",
			"vcs.repository.owner": CodingRepoOwner, "vcs.repository.name": CodingRepoName,
			"vcs.ref.head.name": CodingBetaFirstRef, "langwatch.session.name": CodingBetaTitle,
		}),
		logRecord(now-3*minute, sessionContextEvent, CodingSessionBeta, map[string]any{
			"coding_agent.name": "codex", "vcs.repository.host": "github.com",
			"vcs.repository.owner": CodingRepoOwner, "vcs.repository.name": CodingRepoName,
			"vcs.ref.head.name": CodingBetaBranch, "langwatch.session.name": CodingBetaTitle,
		}),
	}
	return []map[string]any{
		otlpLogs(claudeEventsScope, "claude-code", alpha[1:]),
		otlpLogs(langwatchHookScope, "langwatch-cli", alpha[:1]),
		otlpLogs(langwatchHookScope, "langwatch-cli", beta),
	}
}

// codingSessionSpans is alpha's model call as a Claude Code llm_request span, so the
// session has a stored trace to replay and to read back through the trace API, and
// one Bash tool span after it, so the session's usage summary has a tool run to show.
func codingSessionSpans(now int64) []map[string]any {
	start := (now - 7*60_000) * 1_000_000
	toolStart := start + 2_500_000_000
	tool := map[string]any{
		"traceId": "5c0d1a6e0000000000000000000000a1", "spanId": "5c0d1a6e000000a2", "name": "claude_code.tool",
		"kind": 1, "startTimeUnixNano": strconv.FormatInt(toolStart, 10), "endTimeUnixNano": strconv.FormatInt(toolStart+800_000_000, 10),
		"attributes": []map[string]any{
			otlpAttribute("session.id", CodingSessionAlpha), otlpAttribute("tool_name", CodingAlphaTool),
			otlpAttribute("duration_ms", 800),
		},
	}
	span := map[string]any{
		"traceId": "5c0d1a6e0000000000000000000000a1", "spanId": "5c0d1a6e000000a1", "name": "claude_code.llm_request",
		"kind": 1, "startTimeUnixNano": strconv.FormatInt(start, 10), "endTimeUnixNano": strconv.FormatInt(start+2_100_000_000, 10),
		"attributes": []map[string]any{
			otlpAttribute("session.id", CodingSessionAlpha), otlpAttribute("model", "claude-sonnet-4-20250514"),
			otlpAttribute("input_tokens", 1200), otlpAttribute("output_tokens", 340), otlpAttribute("cost_usd", 0.012),
		},
	}
	return []map[string]any{{
		"resourceSpans": []any{map[string]any{
			"resource": map[string]any{"attributes": []map[string]any{otlpAttribute("service.name", "claude-code")}},
			"scopeSpans": []any{map[string]any{
				"scope": map[string]any{"name": claudeEventsScope, "version": "1"},
				"spans": []any{span, tool},
			}},
		}},
	}}
}

// logRecord is one OTLP log record: event.name and session.id ride as attributes,
// the way both agents and the hook send them.
func logRecord(atMs int64, event, sessionID string, attributes map[string]any) map[string]any {
	list := []map[string]any{otlpAttribute("event.name", event), otlpAttribute("session.id", sessionID)}
	for key, value := range attributes {
		list = append(list, otlpAttribute(key, value))
	}
	return map[string]any{
		"timeUnixNano": strconv.FormatInt(atMs*1_000_000, 10), "severityNumber": 9, "severityText": "INFO",
		"eventName": event, "attributes": list,
	}
}

// otlpLogs wraps records in one OTLP/HTTP JSON logs request under one scope.
func otlpLogs(scope, service string, records []map[string]any) map[string]any {
	return map[string]any{"resourceLogs": []any{map[string]any{
		"resource": map[string]any{"attributes": []map[string]any{otlpAttribute("service.name", service)}},
		"scopeLogs": []any{map[string]any{
			"scope":      map[string]any{"name": scope, "version": "1"},
			"logRecords": records,
		}},
	}}}
}

// otlpAttribute types a value the way OTLP JSON spells it: 64-bit ints are strings.
func otlpAttribute(key string, value any) map[string]any {
	switch typed := value.(type) {
	case int:
		return map[string]any{"key": key, "value": map[string]any{"intValue": strconv.Itoa(typed)}}
	case float64:
		return map[string]any{"key": key, "value": map[string]any{"doubleValue": typed}}
	default:
		return map[string]any{"key": key, "value": map[string]any{"stringValue": fmt.Sprint(typed)}}
	}
}
