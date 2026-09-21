package toolmap

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// traceSearchDocument builds what `langwatch trace search --format json`
// prints: rows of eleven keys, where "trace_id" sorts after the five keys the
// tightest reduction pass keeps.
func traceSearchDocument(rows int) string {
	traces := make([]any, 0, rows)
	for i := range rows {
		traces = append(traces, map[string]any{
			"trace_id":    fmt.Sprintf("%032x", i+1),
			"project_id":  "project-1",
			"error":       nil,
			"evaluations": []any{},
			"input":       map[string]any{"value": strings.Repeat("How long does a refund take? ", 40)},
			"output":      map[string]any{"value": strings.Repeat("It reaches your card in a week. ", 40)},
			"metadata":    map[string]any{"labels": []any{"refund"}, "user_id": "customer-1", "thread_id": "thread-1", "topic": "refund", "language": "en", "model": "gpt-5-mini"},
			"metrics":     map[string]any{"total_cost": 0.002, "prompt_tokens": 784, "completion_tokens": 55, "total_time_ms": 900},
			"timestamps":  map[string]any{"started_at": 1789880945632, "inserted_at": 1789885473525},
			"spans":       []any{},
			"events":      []any{},
		})
	}
	raw, _ := json.Marshal(map[string]any{
		"traces":     traces,
		"pagination": map[string]any{"totalHits": rows, "total": rows},
	})
	return string(raw)
}

// @scenario "A reduced result keeps the id of every row it keeps"
func TestTruncateToolOutput_KeepsRowIdentity(t *testing.T) {
	raw := traceSearchDocument(13)
	if len(raw) <= MaxToolOutputBytes {
		t.Fatalf("fixture must exceed the cap to exercise reduction, got %d bytes", len(raw))
	}

	var parsed struct {
		Traces     []any          `json:"traces"`
		Pagination map[string]any `json:"pagination"`
	}
	if err := json.Unmarshal([]byte(TruncateToolOutput(raw)), &parsed); err != nil {
		t.Fatalf("the reduced document does not parse: %v", err)
	}

	rows := 0
	for _, item := range parsed.Traces {
		row, ok := item.(map[string]any)
		if !ok {
			continue // the "N more items truncated" marker
		}
		rows++
		if id, _ := row["trace_id"].(string); id == "" {
			t.Errorf("a kept row lost its trace_id, keys left: %v", keysOf(row))
		}
	}
	if rows == 0 {
		t.Fatal("no row survived the reduction")
	}
	if total, _ := parsed.Pagination["totalHits"].(float64); total != 13 {
		t.Errorf("the reported total is %v, want 13", parsed.Pagination["totalHits"])
	}
}

func TestIsIdentityKey(t *testing.T) {
	for key, want := range map[string]bool{
		"id": true, "trace_id": true, "traceId": true, "scenarioRunId": true,
		"input": false, "identity": false, "valid": false, "paid": false, "grid": false,
	} {
		if got := isIdentityKey(key); got != want {
			t.Errorf("isIdentityKey(%q) = %v, want %v", key, got, want)
		}
	}
}

func keysOf(row map[string]any) []string {
	keys := make([]string, 0, len(row))
	for key := range row {
		keys = append(keys, key)
	}
	return keys
}
