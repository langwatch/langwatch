package client_test

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"github.com/langwatch/langwatch/sdks/go/client"
)

// ExampleNew shows the minimal setup: construct a client (reading credentials
// from the environment) and fetch a prompt.
func ExampleNew() {
	lw, err := client.New(
		client.WithAPIKey("sk-lw-..."),
		client.WithProjectID("project_abc123"),
	)
	if err != nil {
		log.Fatal(err)
	}

	prompt, err := lw.Prompts.Get(context.Background(), "support-greeting", nil)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(prompt.Model)
}

// ExamplePromptsService_Get_byTag resolves the version a named tag points at.
func ExamplePromptsService_Get_byTag() {
	lw, err := client.New()
	if err != nil {
		log.Fatal(err)
	}
	prompt, err := lw.Prompts.Get(context.Background(), "support-greeting", &client.GetPromptOptions{
		Tag: "production",
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(prompt.Version)
}

// ExampleAPIError demonstrates typed error handling.
func ExampleAPIError() {
	lw, err := client.New()
	if err != nil {
		log.Fatal(err)
	}

	_, err = lw.Prompts.Get(context.Background(), "missing", nil)
	if client.IsNotFound(err) {
		fmt.Println("no such prompt")
		return
	}

	var apiErr *client.APIError
	if errors.As(err, &apiErr) {
		log.Printf("status=%d op=%s msg=%s", apiErr.StatusCode, apiErr.Operation, apiErr.Message)
	}
}

// ExampleWithMaxRetries customises retry and transport behaviour.
func ExampleWithMaxRetries() {
	lw, err := client.New(
		client.WithMaxRetries(5),
		client.WithRetryWaitMax(10*time.Second),
		client.WithHTTPClient(&http.Client{Timeout: 60 * time.Second}),
	)
	if err != nil {
		log.Fatal(err)
	}
	_ = lw
}

// ExampleEventsService_ThumbsUp records thumbs feedback on a trace after the
// fact. Thumbs is a LangWatch tracked event, not an annotation. While tracing you
// capture the trace id from the active span; later, when the user reacts, you
// submit the thumbs by that id.
func ExampleEventsService_ThumbsUp() {
	lw, err := client.New()
	if err != nil {
		log.Fatal(err)
	}

	// During the request, capture the id from the span you started with the core
	// SDK's tracer:
	//
	//	traceID := span.SpanContext().TraceID().String()
	traceID := "trace_abc123"

	// Later, when the user clicks thumbs-up:
	err = lw.Events.ThumbsUp(context.Background(), traceID, "answered my question perfectly")
	if err != nil {
		log.Fatal(err)
	}

	// A thumbs-down is symmetric:
	if err := lw.Events.ThumbsDown(context.Background(), traceID, "wrong product recommended"); err != nil {
		log.Fatal(err)
	}
}

// ExampleEvaluationsService_Create submits an evaluation against an existing
// trace by id, reusing the very same langwatch.Evaluation value that
// span.RecordEvaluation accepts live.
func ExampleEvaluationsService_Create() {
	lw, err := client.New()
	if err != nil {
		log.Fatal(err)
	}

	// Captured earlier from the span: span.SpanContext().TraceID().String().
	traceID := "trace_abc123"

	// An out-of-band evaluator (LLM judge, human review, nightly batch) produces
	// a verdict; submit it by trace id. This is the same Evaluation type you would
	// pass to span.RecordEvaluation while tracing.
	err = lw.Evaluations.Create(context.Background(), traceID, client.Evaluation{
		Name:   "answer relevancy",
		Passed: langwatch.Bool(true),
		Score:  langwatch.Float64(0.92),
	})
	if err != nil {
		log.Fatal(err)
	}
}

// ExampleDatasetsService_AllRecords streams every record in a dataset with the
// auto-paginating iterator: pages are fetched lazily under the hood, so memory
// stays flat across an arbitrarily large dataset.
func ExampleDatasetsService_AllRecords() {
	lw, err := client.New()
	if err != nil {
		log.Fatal(err)
	}

	for rec, err := range lw.Datasets.AllRecords(context.Background(), "golden-examples", client.ListDatasetsParams{}) {
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(rec["input"])
	}
}

// ExampleTracesService_All streams every trace matching a search, following the
// scroll cursor each response carries until the result set is exhausted.
func ExampleTracesService_All() {
	lw, err := client.New()
	if err != nil {
		log.Fatal(err)
	}

	for tr, err := range lw.Traces.All(context.Background(), client.TraceSearchParams{Query: "timeout"}) {
		if err != nil {
			log.Fatal(err)
		}
		if tr.TraceId != nil {
			fmt.Println(*tr.TraceId)
		}
	}
}

// ExampleScenariosService_AllRuns walks every page of cursor-paginated runs.
// AllRuns advances the cursor and terminates for you, so every page is
// processed — including the last one, which reports HasMore == false.
func ExampleScenariosService_AllRuns() {
	lw, err := client.New()
	if err != nil {
		log.Fatal(err)
	}

	for run, err := range lw.Scenarios.AllRuns(context.Background(), client.SimulationRunsParams{Limit: 50}) {
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(run["id"])
	}
}
