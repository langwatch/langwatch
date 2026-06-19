// Package client is the official Go client for the LangWatch REST API.
//
// It provides an ergonomic, strongly-typed wrapper over every LangWatch HTTP
// endpoint — prompts, datasets, traces, annotations, triggers, monitors,
// projects, scenarios and more — generated from the canonical OpenAPI
// specification and hand-wrapped for a clean, discoverable Go surface.
//
// This package is the API client. It is distinct from the tracing /
// observability instrumentation in the parent module
// (github.com/langwatch/langwatch/sdk-go), which emits OpenTelemetry spans.
// Use this package when you want to read or write LangWatch resources (fetch a
// prompt, push dataset records, search traces); use the parent module when you
// want to instrument your application's LLM calls.
//
// # Quick start
//
//	package main
//
//	import (
//		"context"
//		"fmt"
//		"log"
//
//		"github.com/langwatch/langwatch/sdk-go/client"
//	)
//
//	func main() {
//		// Reads LANGWATCH_API_KEY, LANGWATCH_PROJECT_ID and LANGWATCH_ENDPOINT
//		// from the environment when the corresponding options are omitted.
//		lw, err := client.New()
//		if err != nil {
//			log.Fatal(err)
//		}
//
//		prompt, err := lw.Prompts.Get(context.Background(), "my-prompt", nil)
//		if err != nil {
//			log.Fatal(err)
//		}
//		fmt.Println(prompt.Model, len(prompt.Messages))
//	}
//
// # Authentication
//
// The client always sends the credential as Authorization: Bearer <key>, and
// identifies the project with an X-Project-Id header when one is known (via
// [WithProjectID] or the LANGWATCH_PROJECT_ID environment variable). Two
// credential families are handled transparently by [New] and its options:
//
//   - Legacy project keys (sk-lw-*): the key carries project identity, so
//     X-Project-Id is optional — it pins the request to a specific project.
//
//   - Personal Access Tokens (pat-lw-*): user-scoped, and require X-Project-Id
//     so the server can resolve the correct role binding.
//
// See [WithAPIKey], [WithProjectID] and [WithEndpoint].
//
// # Errors
//
// Methods return a typed [*APIError] for any non-2xx response. It exposes the
// HTTP status code, the decoded API message, the operation that failed and the
// raw response body. Use [errors.As] to branch on it, or the [IsNotFound],
// [IsUnauthorized] and [IsConflict] helpers for the common cases:
//
//	prompt, err := lw.Prompts.Get(ctx, "missing", nil)
//	if client.IsNotFound(err) {
//		// handle 404
//	}
//
// # Retries and timeouts
//
// By default the client retries idempotent requests that fail with HTTP 429 or
// 5xx, using exponential backoff with jitter and honouring any Retry-After
// header, up to a bounded number of attempts. Configure this with
// [WithMaxRetries] and [WithRetryWaitMax], or disable it entirely with
// WithMaxRetries(0). All requests respect the context passed to each method, so
// callers control cancellation and deadlines.
//
// # Pagination
//
// The LangWatch API uses two pagination styles, both surfaced as plain
// parameters on the relevant list methods: page/limit offset pagination (for
// example datasets and dataset records) and cursor pagination (for example
// simulation runs). Each heavy list method returns a single page, so callers
// can loop and pass the next page or cursor explicitly when they want manual
// control.
//
// # Streaming large result sets
//
// For the heavy, paginated endpoints the API does not stream a single
// unbounded response: it serves fixed-size pages capped at 1000 rows. To walk
// an arbitrarily large result set without holding it all in memory, each such
// service also exposes a Go 1.23 range-over-func iterator that fetches one page
// at a time and yields elements as [iter.Seq2] of (element, error):
//
//	for rec, err := range lw.Datasets.AllRecords(ctx, "golden-examples", client.ListDatasetsParams{}) {
//		if err != nil {
//			log.Fatal(err)
//		}
//		process(rec)
//	}
//
// The iterators are [DatasetsService.AllRecords], [DatasetsService.All],
// [TracesService.All], [ScenariosService.AllRuns] and [ProjectsService.All].
// Each defaults its page size to the server maximum (1000) to minimise
// round-trips, fetches the next page lazily only once the current one is
// exhausted, surfaces a page-fetch failure once as (zero, err) and then stops,
// honours an early break (no further pages are fetched), and respects context
// cancellation between pages. Because the server caps pages at 1000 rows, these
// iterators are the constant-memory way to process a large result set.
package client
