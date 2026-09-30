package visualdiff

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"
)

// DefaultProjectKey is the deterministic project key the repository's Prisma
// seed writes (apps/tasks/src/storage-seed/storage-seed.ts). Both stacks share one
// database, so one key seeds fixtures both of them can read.
const DefaultProjectKey = "sk-lw-local-development-key"

// The identity the current seed creates for the local-dev organization
// (apps/tasks's storage-seed task; tools/thuishaven/domain/identity.go names it).
const (
	SeededEmail    = "admin@mail.langwatch.localhost"
	SeededPassword = "LocalHavenAdmin!2026"
	SeededSlug     = "local-dev-project"
)

// SeededPasskeyProbeEmail is the seeded account only the sign-in capture uses. It signs in in
// a context of its own and never answers the passkey offer, so the offer stays outstanding
// for every run; no fuzzer or flow shares it (apps/tasks storage-seed).
const SeededPasskeyProbeEmail = "passkey-probe@mail.langwatch.localhost"

// RetiredSeededEmails are earlier seeded admins an older ref still creates.
var RetiredSeededEmails = []string{"admin@haven.localhost"}

// withSeededDefaults fills whatever the operator did not give from the seeded
// identity; without it every route is rendered signed out, for an empty slug.
func (identity SeedIdentity) withSeededDefaults() SeedIdentity {
	if identity.ProjectKey == "" {
		identity.ProjectKey = DefaultProjectKey
	}
	if identity.Email == "" {
		identity.Email = SeededEmail
		identity.FallbackEmails = RetiredSeededEmails
		if identity.ProbeEmail == "" {
			identity.ProbeEmail = SeededPasskeyProbeEmail
		}
	}
	if identity.Password == "" {
		identity.Password = SeededPassword
	}
	if identity.Slug == "" {
		identity.Slug = SeededSlug
	}
	return identity
}

// SeedIdentity is the identity the run works as: the project key the fixtures
// are posted with, and the credentials the runner's signIn action uses.
type SeedIdentity struct {
	ProjectKey string `json:"projectKey"`
	Email      string `json:"email"`
	Password   string `json:"password"`
	Slug       string `json:"slug"`
	// FallbackEmails are tried in order when Email does not sign in on a side.
	FallbackEmails []string `json:"fallbackEmails,omitempty"`
	// ProbeEmail is the account the sign-in capture photographs the passkey offer with; the
	// runner falls back to Email when it does not sign in. Empty: the run's own account.
	ProbeEmail string `json:"probeEmail,omitempty"`
}

// SeedRequest is one seeding step: which API to post to, as whom, and how
// many traces to write.
type SeedRequest struct {
	Client     *http.Client
	APIURL     string
	Identity   SeedIdentity
	TraceCount int
	// Flows are the run's flows, whose `setup:` the seed posts too (setup.go).
	Flows []Flow
}

// SeedResult reports what the seeding step created. Fixtures are the ids
// this stack generated for the dynamic routes' entities; Warnings name the
// entities it could not create; Timings are how long each part took.
type SeedResult struct {
	TraceIDs  []string
	DatasetOK bool
	Fixtures  map[string]string
	Warnings  []string
	Timings   []SeedTiming
}

// SeedTiming is how long one part of a seed took.
type SeedTiming struct {
	Part string
	Took time.Duration
}

// SeedTraceIDPrefix names the traces a run creates, so a flow can open one by
// name and a person can tell a fixture from real data at a glance.
const SeedTraceIDPrefix = "trace_visualdiff_"

// seedConcurrency bounds how many fixture posts one part of a seed has in flight.
const seedConcurrency = 8

// seedClient is one keep-alive client every post of a seed shares.
func seedClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConnsPerHost = seedConcurrency * 2
	return &http.Client{Timeout: 30 * time.Second, Transport: transport}
}

// Seed posts the run's fixtures through one stack's API: traces on /api/collector,
// the dataset and its rows, the entities the dynamic routes open (seed_entities.go)
// and the flow suite's fixtures, all at once, then each flow's setup (setup.go).
// The ids the stack generates come back as Fixtures, since each stack that owns a
// database generates its own. A failed trace or dataset fails the seed.
func Seed(ctx context.Context, request SeedRequest) (SeedResult, error) {
	client := request.Client
	if client == nil {
		client = seedClient()
	}
	result := SeedResult{Fixtures: map[string]string{}}
	var mutex sync.Mutex
	keep := func(part string, started time.Time, fixtures map[string]string, warnings []string) {
		mutex.Lock()
		defer mutex.Unlock()
		maps.Copy(result.Fixtures, fixtures)
		result.Warnings = append(result.Warnings, warnings...)
		result.Timings = append(result.Timings, SeedTiming{Part: part, Took: time.Since(started)})
	}
	now := time.Now().UnixMilli()
	key := request.Identity.ProjectKey
	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		started := time.Now()
		ids, err := seedTraces(groupCtx, client, request, now)
		result.TraceIDs = ids
		keep("traces", started, nil, nil)
		return err
	})
	group.Go(func() error {
		started := time.Now()
		fixtures, warnings, err := seedDataset(groupCtx, client, request.APIURL, key)
		result.DatasetOK = err == nil
		keep("dataset", started, fixtures, warnings)
		return err
	})
	group.Go(func() error {
		started := time.Now()
		fixtures, warnings := seedEntities(groupCtx, entityRequest{client: client, apiURL: request.APIURL, key: key, seeds: entitySeeds})
		keep("entities", started, fixtures, warnings)
		return nil
	})
	group.Go(func() error {
		started := time.Now()
		fixtures, warnings := seedForFlows(groupCtx, flowSeedRequest{client: client, apiURL: request.APIURL, key: key, now: now})
		keep("flow fixtures", started, fixtures, warnings)
		return nil
	})
	if err := group.Wait(); err != nil {
		return result, err
	}
	started := time.Now()
	setups, warnings := runFlowSetups(ctx, setupRequest{client: client, apiURL: request.APIURL, key: key, fixtures: result.Fixtures, flows: request.Flows})
	keep("setups", started, setups, warnings)
	return result, nil
}

// seedTraces posts TraceCount deterministic traces at once, and returns their ids in order.
func seedTraces(ctx context.Context, client *http.Client, request SeedRequest, now int64) ([]string, error) {
	ids := make([]string, request.TraceCount)
	group, groupCtx := errgroup.WithContext(ctx)
	group.SetLimit(seedConcurrency)
	for index := range request.TraceCount {
		ids[index] = fmt.Sprintf("%s%d", SeedTraceIDPrefix, index)
		group.Go(func() error {
			fixture := postSpec{url: request.APIURL + "/api/collector", key: request.Identity.ProjectKey, body: seedTrace(ids[index], index, now)}
			if err := post(groupCtx, client, fixture); err != nil {
				return fmt.Errorf("seed trace %s: %w", ids[index], err)
			}
			return nil
		})
	}
	return ids, group.Wait()
}

// seedDataset posts the dataset, then its rows, and names it as a fixture.
func seedDataset(ctx context.Context, client *http.Client, apiURL, key string) (map[string]string, []string, error) {
	dataset := map[string]any{
		"name": "Visual Diff QA",
		"columnTypes": []map[string]string{
			{"name": "input", "type": "string"},
			{"name": "expected_output", "type": "string"},
		},
	}
	answer, err := postReading(ctx, client, postSpec{url: apiURL + "/api/dataset", key: key, body: dataset})
	var warnings []string
	switch {
	case err != nil && strings.Contains(err.Error(), "answered 409"):
		// An earlier seed of this database made it, rows and all.
		answer, err = postReading(ctx, client, postSpec{url: apiURL + "/api/dataset/" + SeedDatasetSlug, key: key, method: http.MethodGet})
	case err == nil:
		rows := postSpec{url: apiURL + "/api/dataset/" + SeedDatasetSlug + "/records", key: key, body: map[string]any{"entries": seedDatasetRows()}}
		if err := post(ctx, client, rows); err != nil {
			warnings = append(warnings, fmt.Sprintf("dataset rows not seeded: %v", err))
		}
	}
	if err != nil {
		return nil, nil, fmt.Errorf("seed dataset: %w", err)
	}
	id, err := StringAt(answer, "id")
	if err != nil {
		return nil, append(warnings, fmt.Sprintf("%s not seeded: /api/dataset answered without id: %v", FixtureDataset, err)), nil
	}
	return map[string]string{FixtureDataset: id}, warnings, nil
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

// postSpec is one fixture write, or a read when method is GET.
type postSpec struct {
	url    string
	key    string
	body   any
	method string
	bearer string
}

func post(ctx context.Context, client *http.Client, spec postSpec) error {
	_, err := postReading(ctx, client, spec)
	return err
}

// postReading posts one fixture and returns the answer's body.
func postReading(ctx context.Context, client *http.Client, spec postSpec) ([]byte, error) {
	encoded, err := json.Marshal(spec.body)
	if err != nil {
		return nil, err
	}
	method, body := http.MethodPost, io.Reader(bytes.NewReader(encoded))
	if spec.method != "" {
		method, body = spec.method, nil
	}
	outgoing, err := http.NewRequestWithContext(ctx, method, spec.url, body)
	if err != nil {
		return nil, err
	}
	outgoing.Header.Set("Content-Type", "application/json")
	if spec.bearer != "" {
		outgoing.Header.Set("Authorization", "Bearer "+spec.bearer)
	} else {
		outgoing.Header.Set("X-Auth-Token", spec.key)
	}
	response, err := client.Do(outgoing)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 400))
		return nil, fmt.Errorf("%s answered %d: %s", spec.url, response.StatusCode, bytes.TrimSpace(detail))
	}
	return io.ReadAll(io.LimitReader(response.Body, 1<<20))
}
