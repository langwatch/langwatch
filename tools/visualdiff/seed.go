package visualdiff

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// DefaultProjectKey is the deterministic project key the repository's Prisma
// seed writes (packages/prisma-client/prisma/seed.ts). Both stacks share one
// database, so one key seeds fixtures both of them can read.
const DefaultProjectKey = "sk-lw-local-development-key"

// SeedIdentity is the identity the run works as: the project key the fixtures
// are posted with, and the credentials the runner's signIn action uses.
type SeedIdentity struct {
	ProjectKey string `json:"projectKey"`
	Email      string `json:"email"`
	Password   string `json:"password"`
	Slug       string `json:"slug"`
}

// SeedRequest is one seeding step: which API to post to, as whom, and how
// many traces to write.
type SeedRequest struct {
	Client     *http.Client
	APIURL     string
	Identity   SeedIdentity
	TraceCount int
}

// SeedResult reports what the seeding step created.
type SeedResult struct {
	TraceIDs  []string
	DatasetOK bool
}

// SeedTraceIDPrefix names the traces a run creates, so a flow can open one by
// name and a person can tell a fixture from real data at a glance.
const SeedTraceIDPrefix = "trace_visualdiff_"

// Seed posts the run's fixtures through the candidate API: traces on
// /api/collector and one dataset on /api/dataset. Both stacks read the same
// database, so seeding once through the candidate is enough — and doing it
// through the candidate rather than the base means the fixtures exist in the
// shape the newer code writes.
func Seed(ctx context.Context, request SeedRequest) (SeedResult, error) {
	client := request.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	result := SeedResult{}
	now := time.Now().UnixMilli()
	for index := range request.TraceCount {
		traceID := fmt.Sprintf("%s%d", SeedTraceIDPrefix, index)
		body := seedTrace(traceID, index, now)
		fixture := postSpec{url: request.APIURL + "/api/collector", key: request.Identity.ProjectKey, body: body}
		if err := post(ctx, client, fixture); err != nil {
			return result, fmt.Errorf("seed trace %s: %w", traceID, err)
		}
		result.TraceIDs = append(result.TraceIDs, traceID)
	}
	dataset := map[string]any{
		"name": "Visual Diff QA",
		"columnTypes": []map[string]string{
			{"name": "input", "type": "string"},
			{"name": "expected_output", "type": "string"},
		},
	}
	if err := post(ctx, client, postSpec{url: request.APIURL + "/api/dataset", key: request.Identity.ProjectKey, body: dataset}); err != nil {
		return result, fmt.Errorf("seed dataset: %w", err)
	}
	result.DatasetOK = true
	return result, nil
}

// seedTrace is one deterministic trace: a root span, an LLM span and a
// retrieval span, so the trace screens have something with structure to draw.
func seedTrace(traceID string, index int, now int64) map[string]any {
	start := now - int64(index+1)*3_600_000
	root := map[string]any{
		"type": "span", "span_id": traceID + "_root", "trace_id": traceID, "name": "handle_request",
		"input":      map[string]any{"type": "text", "value": fmt.Sprintf("Question %d", index)},
		"output":     map[string]any{"type": "text", "value": fmt.Sprintf("Answer %d", index)},
		"timestamps": map[string]any{"started_at": start, "finished_at": start + 2400},
	}
	llm := map[string]any{
		"type": "llm", "span_id": traceID + "_llm", "parent_id": traceID + "_root", "trace_id": traceID,
		"name": "chat_completion", "model": "gpt-5-mini", "vendor": "openai",
		"metrics":    map[string]any{"prompt_tokens": 120 + index, "completion_tokens": 60 + index, "cost": 0.0012},
		"timestamps": map[string]any{"started_at": start + 200, "finished_at": start + 2200},
	}
	retrieval := map[string]any{
		"type": "rag", "span_id": traceID + "_rag", "parent_id": traceID + "_root", "trace_id": traceID,
		"name":       "retrieve_documents",
		"contexts":   []map[string]any{{"document_id": traceID + "_doc", "content": "Visual diff fixture context."}},
		"timestamps": map[string]any{"started_at": start + 50, "finished_at": start + 190},
	}
	return map[string]any{
		"trace_id": traceID,
		"spans":    []map[string]any{root, llm, retrieval},
		"metadata": map[string]any{"user_id": fmt.Sprintf("user_%d", index%3), "labels": []string{"visual-diff"}},
	}
}

// postSpec is one fixture write.
type postSpec struct {
	url  string
	key  string
	body any
}

func post(ctx context.Context, client *http.Client, spec postSpec) error {
	encoded, err := json.Marshal(spec.body)
	if err != nil {
		return err
	}
	outgoing, err := http.NewRequestWithContext(ctx, http.MethodPost, spec.url, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	outgoing.Header.Set("Content-Type", "application/json")
	outgoing.Header.Set("X-Auth-Token", spec.key)
	response, err := client.Do(outgoing)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 400))
		return fmt.Errorf("%s answered %d: %s", spec.url, response.StatusCode, bytes.TrimSpace(detail))
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
	return nil
}
