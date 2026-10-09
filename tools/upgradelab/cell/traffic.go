package cell

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

// Call is one request the traffic sent: when, how long, what came back, and what it wrote.
type Call struct {
	Kind    string `json:"kind"`
	N       int    `json:"n"`
	AtMs    int64  `json:"atMs"`
	Latency int64  `json:"latencyMs"`
	Status  int    `json:"status"` // 0: no answer (refused, reset, timed out)
	Error   string `json:"error,omitempty"`
	ID      string `json:"id,omitempty"` // what a write left behind, checked after settle
	Write   bool   `json:"write"`
}

// Client is who the traffic speaks as: the seed project's API key and the seed account's session.
type Client struct {
	URL, APIKey, Project, BasePrompt string
	Session                          http.Header
	Seed                             int64
}

// Kind is one stream of the mix: an ingest door, a read or a write, fired every Every.
type Kind struct {
	Name  string
	Every time.Duration
	Write bool
	Do    func(ctx context.Context, client Client, n int) (*http.Request, string, error)
}

// SeededID is item n of kind under seed: a 32-hex id equal on every run with the seed.
func SeededID(seed int64, kind string, n int) string {
	sum := sha256.Sum256([]byte(strconv.FormatInt(seed, 10) + "/" + kind + "/" + strconv.Itoa(n)))
	return hex.EncodeToString(sum[:16])
}

// Mix is the traffic of a cell: four ingest doors, then the API and tRPC calls a user makes.
func Mix(rate time.Duration) []Kind {
	return []Kind{
		{Name: "otlp-trace", Every: rate, Write: true, Do: otlpTrace},
		{Name: "collector", Every: rate, Write: true, Do: collectorTrace},
		{Name: "otlp-log", Every: rate, Write: true, Do: otlpLog},
		{Name: "otlp-metric", Every: rate, Write: true, Do: otlpMetric},
		{Name: "rest-read", Every: 2 * rate, Do: restRead},
		{Name: "trpc-read", Every: 2 * rate, Do: trpcRead},
		{Name: "prompt-create", Every: 4 * rate, Write: true, Do: promptCreate},
		{Name: "prompt-update", Every: 4 * rate, Write: true, Do: promptUpdate},
		{Name: "dataset-create", Every: 4 * rate, Write: true, Do: datasetCreate},
	}
}

func (client Client) post(ctx context.Context, path string, body any) (*http.Request, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.URL+path, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Auth-Token", client.APIKey)
	request.Header.Set("Authorization", "Bearer "+client.APIKey)
	return request, nil
}

func nowNano() string { return strconv.FormatInt(time.Now().UnixNano(), 10) }

func resource(name string) map[string]any {
	return map[string]any{"attributes": []any{map[string]any{"key": "service.name", "value": map[string]any{"stringValue": name}}}}
}

func otlpTrace(ctx context.Context, client Client, n int) (*http.Request, string, error) {
	id := SeededID(client.Seed, "otlp-trace", n)
	span := map[string]any{"traceId": id, "spanId": id[:16], "name": "upgradelab span " + strconv.Itoa(n), "kind": 1,
		"startTimeUnixNano": nowNano(), "endTimeUnixNano": nowNano()}
	body := map[string]any{"resourceSpans": []any{map[string]any{"resource": resource("upgradelab"),
		"scopeSpans": []any{map[string]any{"spans": []any{span}}}}}}
	request, err := client.post(ctx, "/api/otel/v1/traces", body)
	return request, id, err
}

func collectorTrace(ctx context.Context, client Client, n int) (*http.Request, string, error) {
	id := SeededID(client.Seed, "collector", n)
	now := time.Now().UnixMilli()
	span := map[string]any{"type": "span", "span_id": id[:16], "name": "upgradelab collector " + strconv.Itoa(n),
		"input": map[string]string{"type": "text", "value": "item " + strconv.Itoa(n)}, "timestamps": map[string]int64{"started_at": now - 10, "finished_at": now}}
	request, err := client.post(ctx, "/api/collector", map[string]any{"trace_id": id, "spans": []any{span}})
	return request, id, err
}

func otlpLog(ctx context.Context, client Client, n int) (*http.Request, string, error) {
	id := SeededID(client.Seed, "otlp-log", n)
	record := map[string]any{"timeUnixNano": nowNano(), "severityNumber": 9, "severityText": "INFO", "traceId": id, "spanId": id[:16],
		"body": map[string]any{"stringValue": "upgradelab log " + id}}
	body := map[string]any{"resourceLogs": []any{map[string]any{"resource": resource("upgradelab"),
		"scopeLogs": []any{map[string]any{"logRecords": []any{record}}}}}}
	request, err := client.post(ctx, "/api/otel/v1/logs", body)
	return request, id, err
}

func otlpMetric(ctx context.Context, client Client, n int) (*http.Request, string, error) {
	name := "upgradelab_metric_" + SeededID(client.Seed, "otlp-metric", n)[:12]
	point := map[string]any{"timeUnixNano": nowNano(), "asDouble": float64(n)}
	metric := map[string]any{"name": name, "unit": "1", "gauge": map[string]any{"dataPoints": []any{point}}}
	body := map[string]any{"resourceMetrics": []any{map[string]any{"resource": resource("upgradelab"),
		"scopeMetrics": []any{map[string]any{"metrics": []any{metric}}}}}}
	request, err := client.post(ctx, "/api/otel/v1/metrics", body)
	return request, name, err
}

// restRead rotates over the API-key reads: prompts, datasets, evaluators, trace search.
func restRead(ctx context.Context, client Client, n int) (*http.Request, string, error) {
	paths := []string{"/api/prompts", "/api/dataset", "/api/evaluators"}
	if n%4 == 3 {
		end := time.Now().UnixMilli()
		request, err := client.post(ctx, "/api/traces/search", map[string]any{"startDate": end - 86_400_000, "endDate": end, "pageSize": 5})
		return request, "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.URL+paths[n%4], http.NoBody)
	if err == nil {
		request.Header.Set("X-Auth-Token", client.APIKey)
	}
	return request, "", err
}

// trpcRead is the signed-in user's organization list, the first query every screen makes.
func trpcRead(ctx context.Context, client Client, _ int) (*http.Request, string, error) {
	input := url.QueryEscape(`{"json":{}}`)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.URL+"/api/trpc/organization.getAll?input="+input, http.NoBody)
	if err == nil {
		request.Header = client.Session.Clone()
	}
	return request, "", err
}

func promptCreate(ctx context.Context, client Client, n int) (*http.Request, string, error) {
	handle := "upgradelab-" + SeededID(client.Seed, "prompt", n)[:12]
	request, err := client.post(ctx, "/api/prompts", map[string]any{"handle": handle, "prompt": "seeded prompt " + strconv.Itoa(n)})
	return request, handle, err
}

func promptUpdate(ctx context.Context, client Client, n int) (*http.Request, string, error) {
	message := "upgradelab update " + SeededID(client.Seed, "prompt-update", n)[:12]
	request, err := client.post(ctx, "/api/prompts/"+client.BasePrompt, map[string]any{"commitMessage": message, "prompt": message})
	if err == nil {
		request.Method = http.MethodPut
	}
	return request, message, err
}

func datasetCreate(ctx context.Context, client Client, n int) (*http.Request, string, error) {
	name := "upgradelab-" + SeededID(client.Seed, "dataset", n)[:12]
	request, err := client.post(ctx, "/api/dataset", map[string]any{"name": name})
	return request, name, err
}

// Traffic fires the mix until stopped and keeps every call; a held request is waited for, up to Hold.
type Traffic struct {
	Client Client
	Kinds  []Kind
	Origin time.Time
	Hold   time.Duration

	http  *http.Client
	mu    sync.Mutex
	calls []Call
	wait  sync.WaitGroup
}

// Run fires each kind on its own ticker until ctx ends, then waits for calls in flight.
func (traffic *Traffic) Run(ctx context.Context) {
	traffic.http = &http.Client{Timeout: traffic.Hold}
	for _, kind := range traffic.Kinds {
		traffic.wait.Add(1)
		go func() {
			defer traffic.wait.Done()
			traffic.fire(ctx, kind)
		}()
	}
	<-ctx.Done()
	traffic.wait.Wait()
}

func (traffic *Traffic) fire(ctx context.Context, kind Kind) {
	ticker := time.NewTicker(kind.Every)
	defer ticker.Stop()
	for n := 0; ; n++ {
		traffic.wait.Add(1)
		go func() {
			defer traffic.wait.Done()
			traffic.record(traffic.one(context.WithoutCancel(ctx), kind, n))
		}()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (traffic *Traffic) one(ctx context.Context, kind Kind, n int) Call {
	started := time.Now()
	call := Call{Kind: kind.Name, N: n, AtMs: started.Sub(traffic.Origin).Milliseconds(), Write: kind.Write}
	request, id, err := kind.Do(ctx, traffic.Client, n)
	call.ID = id
	if err != nil {
		call.Error = err.Error()
		return call
	}
	response, err := traffic.http.Do(request)
	call.Latency = time.Since(started).Milliseconds()
	if err != nil {
		call.Error = err.Error()
		return call
	}
	defer func() { _ = response.Body.Close() }()
	call.Status = response.StatusCode
	if kind.Name == "dataset-create" && response.StatusCode/100 == 2 {
		call.ID = datasetRef(response.Body, id)
	}
	if response.StatusCode/100 != 2 {
		head, _ := io.ReadAll(io.LimitReader(response.Body, 240))
		call.Error = string(head)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	return call
}

// datasetRef is the created dataset's id from the answer, else the name it was given.
func datasetRef(body io.Reader, fallback string) string {
	var answer struct{ ID, Slug string }
	if json.NewDecoder(body).Decode(&answer) != nil {
		return fallback
	}
	return firstOf(answer.ID, answer.Slug, fallback)
}

func firstOf(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func (traffic *Traffic) record(call Call) {
	traffic.mu.Lock()
	defer traffic.mu.Unlock()
	traffic.calls = append(traffic.calls, call)
}

// Calls is every call so far.
func (traffic *Traffic) Calls() []Call {
	traffic.mu.Lock()
	defer traffic.mu.Unlock()
	return append([]Call(nil), traffic.calls...)
}

// ok is a 2xx answer; a held request answered 2xx counts, its latency recorded.
func (call Call) ok() bool { return call.Status/100 == 2 }

func (call Call) String() string {
	return fmt.Sprintf("%s#%d %d %dms", call.Kind, call.N, call.Status, call.Latency)
}
