# LangWatch Go API Client

`github.com/langwatch/langwatch/sdk-go/client`

An ergonomic, strongly-typed Go client for the [LangWatch](https://langwatch.ai)
REST API — prompts, datasets, traces, annotations, triggers, monitors, projects,
scenarios and more. It is generated from the canonical OpenAPI specification and
hand-wrapped for a clean, discoverable Go surface.

> This is the **API client**. It is distinct from the tracing / observability
> instrumentation in the parent module
> (`github.com/langwatch/langwatch/sdk-go`), which emits OpenTelemetry spans. Use
> this package to read and write LangWatch resources; use the parent module to
> instrument your application's LLM calls.

## Installation

```bash
go get github.com/langwatch/langwatch/sdk-go/client
```

Requires Go 1.25+.

## Quick start

```go
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/langwatch/langwatch/sdk-go/client"
)

func main() {
	// Reads LANGWATCH_API_KEY, LANGWATCH_PROJECT_ID and LANGWATCH_ENDPOINT
	// from the environment when the corresponding options are omitted.
	lw, err := client.New()
	if err != nil {
		log.Fatal(err)
	}

	prompt, err := lw.Prompts.Get(context.Background(), "support-greeting", nil)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(prompt.Model, len(prompt.Messages))
}
```

## Authentication

LangWatch accepts two credential families, both handled transparently. Configure
them with options or the matching environment variables:

| Option | Environment variable | Purpose |
| --- | --- | --- |
| `client.WithAPIKey(key)` | `LANGWATCH_API_KEY` | API key or Personal Access Token |
| `client.WithProjectID(id)` | `LANGWATCH_PROJECT_ID` | Project ID (required for PATs) |
| `client.WithEndpoint(url)` | `LANGWATCH_ENDPOINT` | Base URL (self-hosted / staging) |

An explicit option always wins over the environment.

- **Legacy project keys (`sk-lw-*`)** carry project identity in the token. The
  client sends `Authorization: Bearer <key>` plus `X-Auth-Token: <key>`.
- **Personal Access Tokens (`pat-lw-*`)** are user-scoped and must be paired with
  a project ID. When a project ID is available the client sends
  `Authorization: Basic base64(projectID:token)`. Without one it falls back to
  the Bearer + `X-Auth-Token` shape so the server returns a clean `401` rather
  than silently mis-authenticating.

```go
// PAT + project, explicit:
lw, err := client.New(
	client.WithAPIKey("pat-lw-..."),
	client.WithProjectID("project_abc123"),
)
```

> The `Projects` service operates on organization resources and requires an
> **admin-scoped** API key (`sk-lw-{id}_{secret}`); a project-scoped key is
> rejected with `401`.

## Services

Reach resources through the service fields on `*client.Client`. Every method
takes a `context.Context` first and returns a typed error on failure.

| Field | Resource |
| --- | --- |
| `lw.Prompts` | Prompt configs, versions and tags |
| `lw.Datasets` | Datasets and records |
| `lw.Traces` | Trace search and retrieval |
| `lw.Annotations` | Human annotations on traces |
| `lw.Events` | Tracked events by trace id, incl. thumbs up/down feedback |
| `lw.Evaluations` | Submit evaluation results by trace id |
| `lw.Triggers` | Alerting / automation triggers |
| `lw.Monitors` | Evaluation monitors |
| `lw.Scenarios` | Simulation scenarios and runs |
| `lw.Projects` | Organization projects (admin key) |

### Prompts

The flagship service. Create, read, update, delete prompts; list versions;
manage organization tags.

```go
ctx := context.Background()

// Create a prompt.
p, err := lw.Prompts.Create(ctx, client.CreatePromptParams{
	Handle: "support-greeting",
	Model:  "openai/gpt-5-mini",
	Messages: []client.Message{
		{Role: client.RoleSystem, Content: "You are a friendly support agent."},
	},
})

// Fetch the latest version, a pinned version, or a tagged version.
latest, err := lw.Prompts.Get(ctx, "support-greeting", nil)
v4, err := lw.Prompts.Get(ctx, "support-greeting", &client.GetPromptOptions{Version: 4})
prod, err := lw.Prompts.Get(ctx, "support-greeting", &client.GetPromptOptions{Tag: "production"})

// Shorthand: a suffix in the handle works too.
prod, err = lw.Prompts.Get(ctx, "support-greeting:production", nil)

// Update (creates a new version).
p, err = lw.Prompts.Update(ctx, "support-greeting", client.UpdatePromptParams{
	CommitMessage: "Warmer tone",
	Model:         "openai/gpt-5-mini",
})

// Existence check without handling a 404 yourself.
ok, err := lw.Prompts.Exists(ctx, "support-greeting")

// Versions.
versions, err := lw.Prompts.Versions(ctx, "support-greeting")

// Tags.
tag, err := lw.Prompts.CreateTag(ctx, "production")
_, err = lw.Prompts.AssignTag(ctx, "support-greeting", "production", p.VersionID)
tags, err := lw.Prompts.ListTags(ctx)
err = lw.Prompts.DeleteTag(ctx, "staging")
```

### Datasets

```go
// Offset pagination: read pages and inspect the envelope.
items, pg, err := lw.Datasets.List(ctx, client.ListDatasetsParams{Page: 1, Limit: 50})
for _, d := range items {
	fmt.Println(d.Slug, d.Name)
}

// Append records (each record is a column→value map).
_, err = lw.Datasets.CreateRecords(ctx, "golden-examples", []map[string]any{
	{"input": "hello", "expected_output": "hi"},
})

records, pg, err := lw.Datasets.ListRecords(ctx, "golden-examples", client.ListDatasetsParams{Page: 1, Limit: 100})
```

### Traces

```go
res, err := lw.Traces.Search(ctx, client.TraceSearchParams{
	Query:   "timeout",
	Filters: map[string][]string{"metadata.user_id": {"u_123"}},
})
if res.Traces != nil {
	for _, t := range *res.Traces {
		fmt.Println(*t.TraceId)
	}
}

trace, err := lw.Traces.Get(ctx, "trace_abc123")
```

### Feedback (thumbs up/down)

Thumbs feedback is a LangWatch **tracked event**, not an annotation. `lw.Events`
is the ergonomic "the user clicked thumbs later" flow: capture the trace id from
a span while tracing, then submit feedback by that id afterwards.

```go
// While tracing, grab the id from the active span:
traceID := span.SpanContext().TraceID().String()

// Later, when the user reacts:
err := lw.Events.ThumbsUp(ctx, traceID, "spot on")
err = lw.Events.ThumbsDown(ctx, traceID, "wrong product")

// The feedback string is optional — a bare thumbs is fine:
err = lw.Events.ThumbsUp(ctx, traceID)
```

`ThumbsUp` / `ThumbsDown` are thin conveniences over `Events.Track`, which posts
the same `langwatch.Event` value the core SDK's live `span.RecordEvent` accepts —
so a value can be recorded live or submitted later interchangeably. Reach for
`Track` directly for custom event types or extra metrics:

```go
err := lw.Events.Track(ctx, traceID, langwatch.Event{
	Type:    "thumbs_up_down",
	Metrics: map[string]float64{"vote": 1},
	Details: map[string]string{"feedback": "loved it"},
})
```

This maps to LangWatch's track-event endpoint (`POST /api/events/track`). Both
the trace id and the event type are required; an empty value for either returns
an error without sending a request.

### Annotations

Annotations are structured human review attached to a trace (comment,
thumbs-up/down flag, scores). Create, list and update them with the full
annotation body:

```go
up := true
a, err := lw.Annotations.CreateForTrace(ctx, traceID, client.AnnotationParams{
	Comment:    "Great answer",
	IsThumbsUp: &up,
})

list, err := lw.Annotations.ListByTrace(ctx, traceID)
```

`AnnotationParams.ScoreOptions` is sent for forward compatibility but is
currently ignored by the REST endpoint — set scores in the LangWatch UI if you
need them persisted today. For quick thumbs feedback, prefer `lw.Events` above.

### Evaluations by trace id

`lw.Evaluations.Create` submits an evaluation result against an
already-ingested trace, by trace id. It reuses the **same** `langwatch.Evaluation`
type accepted by the core SDK's live `span.RecordEvaluation`, so a value can be
recorded live or submitted later interchangeably — handy for LLM judges, human
review jobs or nightly batches that score a trace after the fact.

```go
traceID := span.SpanContext().TraceID().String() // captured earlier

err := lw.Evaluations.Create(ctx, traceID, client.Evaluation{
	Name:   "answer relevancy",
	Passed: langwatch.Bool(true),
	Score:  langwatch.Float64(0.92),
})

// Several scores from one evaluator in a single request:
err = lw.Evaluations.CreateBatch(ctx, traceID, []client.Evaluation{
	{Name: "relevancy", Score: langwatch.Float64(0.92), Passed: langwatch.Bool(true)},
	{Name: "toxicity", Score: langwatch.Float64(0.01), Passed: langwatch.Bool(true)},
})
```

`Status` defaults to `"processed"` when unset, matching the live path. This maps
to LangWatch's REST ingestion (collector) endpoint: there is no dedicated
"submit evaluation by trace id" REST route, so the SDK uses the same collector
ingestion path the other LangWatch SDKs share, which dispatches the evaluation
into the same pipeline as a live span event.

### Triggers, Monitors, Scenarios, Projects

```go
triggers, err := lw.Triggers.List(ctx)

monitors, err := lw.Monitors.List(ctx)
_, err = lw.Monitors.Toggle(ctx, "monitor_abc", false)

scenarios, err := lw.Scenarios.List(ctx)

projects, pg, err := lw.Projects.List(ctx, client.ListProjectsParams{}) // admin key
```

## Error handling

Every method returns a typed `*client.APIError` for any non-2xx response. It
carries the HTTP status, the decoded message, the operation that failed and the
raw body.

```go
prompt, err := lw.Prompts.Get(ctx, "missing", nil)
if err != nil {
	var apiErr *client.APIError
	if errors.As(err, &apiErr) {
		log.Printf("status=%d op=%s msg=%s", apiErr.StatusCode, apiErr.Operation, apiErr.Message)
	}
}

// Convenience helpers for the common cases:
if client.IsNotFound(err)     { /* 404 */ }
if client.IsUnauthorized(err) { /* 401 */ }
if client.IsConflict(err)     { /* 409 */ }
```

The message decoder tolerates both of LangWatch's error-body shapes (the inline
route shape where `error` is a string, and the component shape where `error` is
an integer code with a separate `message`).

## Retries and timeouts

By default the client retries idempotent requests that fail with `429` or `5xx`
using exponential backoff with full jitter, honouring any `Retry-After` header,
up to `client.DefaultMaxRetries` extra attempts. Every request respects the
context you pass, so cancellation and deadlines are entirely in your control.

```go
lw, err := client.New(
	client.WithMaxRetries(5),                 // 0 disables retries
	client.WithRetryWaitMax(10*time.Second),  // cap backoff
	client.WithHTTPClient(&http.Client{       // bring your own transport
		Timeout: 60 * time.Second,
	}),
)

ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
prompts, err := lw.Prompts.List(ctx)
```

## Pagination

The API uses two pagination styles. The single-page list methods surface both as
plain parameters, so you can drive paging by hand when you need the page metadata:

**Offset (`page` / `limit`)** — datasets, dataset records, projects. The list
methods return the page plus a `client.Pagination{Page, Limit, Total}` envelope:

```go
items, pg, err := lw.Datasets.List(ctx, client.ListDatasetsParams{Page: 1, Limit: 50})
hasMore := pg.Page*pg.Limit < pg.Total
```

**Cursor** — simulation runs. Pass the returned `NextCursor` back in to advance:

```go
page, err := lw.Scenarios.ListRuns(ctx, client.SimulationRunsParams{Limit: 50})
for err == nil && page.HasMore {
	// process page.Runs ...
	page, err = lw.Scenarios.ListRuns(ctx, client.SimulationRunsParams{
		Limit:  50,
		Cursor: page.NextCursor,
	})
}
```

## Streaming large result sets

The heavy endpoints are **paginated, not streamed**: the server serves
fixed-size pages capped at **1000 rows** (it does not emit one unbounded
response). To walk an arbitrarily large result set without holding it all in
memory, each heavy service exposes a Go 1.23 range-over-func iterator
(`iter.Seq2[T, error]`) that fetches one page at a time and yields elements as
you consume them — so memory stays flat no matter how large the set is. Because
the server caps pages at 1000, these iterators are the constant-memory way to
process a large set.

```go
for rec, err := range lw.Datasets.AllRecords(ctx, "golden-examples", client.ListDatasetsParams{}) {
	if err != nil {
		log.Fatal(err)
	}
	process(rec) // one record at a time; pages are fetched lazily under the hood
}
```

| Iterator | Yields | Pages by |
|----------|--------|----------|
| `lw.Datasets.AllRecords(ctx, slugOrID, params)` | `map[string]any` | offset (`page`/`limit`) |
| `lw.Datasets.All(ctx, params)` | `client.Dataset` | offset (`page`/`limit`) |
| `lw.Traces.All(ctx, params)` | `client.Trace` | offset (`pageOffset`/`pageSize`) |
| `lw.Scenarios.AllRuns(ctx, params)` | `map[string]any` | cursor (`nextCursor`) |
| `lw.Projects.All(ctx, params)` | `client.Project` | offset (`page`/`limit`) |

Every iterator:

- **Defaults the page size to the server maximum (1000)** when you leave it
  unset, minimising round-trips; a smaller caller-set size is respected.
- **Fetches lazily** — the next page is requested only once the current one is
  exhausted, and paging stops as soon as a short page (or the reported total /
  end-of-cursor) signals the end.
- **Surfaces a page error once** as `(zero, err)` and then stops — it never
  loops on a failing page.
- **Honours an early `break`** — no further pages are fetched once you stop
  consuming.
- **Respects context cancellation** between pages, surfacing `ctx.Err()`.

The single-page `List` / `Search` / `ListRuns` methods remain for callers that
want the page metadata or manual control.

## Regenerating the OpenAPI types

The low-level request/response models and HTTP client in
`internal/openapi/zz_generated.gen.go` are generated from the canonical OpenAPI
document with [`oapi-codegen`](https://github.com/oapi-codegen/oapi-codegen) and
**committed**, so `go build` works with no extra toolchain.

To regenerate after the API spec changes, from this module's root:

```bash
go generate ./...
```

This runs two steps (see `internal/openapi/generate.go`):

1. `downconvert.py` rewrites the canonical OpenAPI **3.1** document to a
   **3.0.3**-compatible temporary file (oapi-codegen does not parse 3.1). The
   canonical spec is never modified.
2. `oapi-codegen` (pinned to `v2.7.1` in the directive, configured by
   `oapi-codegen.yaml`) emits the generated Go.

Requires `python3` and the Go toolchain on `PATH`. The generation is
deterministic: re-running it produces an identical file.

## Module layout

This is a **separate Go module** (`sdk-go/client`) with its own `go.mod` and a
`replace` directive onto the core SDK, mirroring the instrumentation modules. It
keeps the core tracing SDK lean: the only third-party dependency the client adds
is the tiny `github.com/oapi-codegen/runtime` (plus `go-jsonmerge` and
`google/uuid`, the latter already used by the core). No web frameworks are
compiled in.
```
