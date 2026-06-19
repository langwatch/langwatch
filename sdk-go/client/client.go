package client

import (
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"time"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/client/internal/openapi"
)

// SDK identification headers sent with every request. These let the LangWatch
// backend attribute traffic to this client and version. The version is reused
// from the core SDK so the API client and the trace exporter always report the
// same release.
const (
	sdkName     = "langwatch-sdk-go"
	sdkLanguage = "go"
	sdkVersion  = langwatch.Version
)

// Client is the entry point to the LangWatch REST API. Construct it with [New],
// then reach resources through its service fields:
//
//	lw, err := client.New()
//	prompt, err := lw.Prompts.Get(ctx, "my-prompt", nil)
//	traces, err := lw.Traces.Search(ctx, client.TraceSearchParams{Query: "error"})
//
// A Client is safe for concurrent use by multiple goroutines.
type Client struct {
	cfg config
	gen openapi.ClientInterface

	// doer is the transport every request flows through: the caller's
	// *http.Client wrapped in the retrying transport. The generated client uses
	// it, and so do the handful of raw requests this package makes for endpoints
	// absent from the OpenAPI spec (see [Client.rawJSON] and [EvaluationsService]).
	doer openapi.HttpRequestDoer

	// Prompts manages prompt configurations and their versions and tags. It is
	// the most fully-featured service and the recommended starting point.
	Prompts *PromptsService

	// Datasets manages datasets and their records.
	Datasets *DatasetsService

	// Traces reads, searches and annotates ingested traces.
	Traces *TracesService

	// Annotations manages human annotations attached to traces.
	Annotations *AnnotationsService

	// Events records LangWatch tracked events against a trace by trace id,
	// including the thumbs-up/down feedback shortcuts [EventsService.ThumbsUp]
	// and [EventsService.ThumbsDown]. It reuses the core langwatch.Event type.
	Events *EventsService

	// Evaluations submits evaluation results against an already-ingested trace,
	// by trace id, reusing the core langwatch.Evaluation type.
	Evaluations *EvaluationsService

	// Triggers manages alerting/automation triggers.
	Triggers *TriggersService

	// Monitors manages evaluation monitors and their on/off state.
	Monitors *MonitorsService

	// Scenarios manages simulation scenarios and their runs.
	Scenarios *ScenariosService

	// Projects manages organization projects. These endpoints require an
	// admin-scoped API key.
	Projects *ProjectsService
}

// New constructs a [Client] from the supplied options, falling back to
// environment variables for any unset credential or endpoint:
//
//   - LANGWATCH_API_KEY    -> [WithAPIKey]
//   - LANGWATCH_PROJECT_ID -> [WithProjectID]
//   - LANGWATCH_ENDPOINT   -> [WithEndpoint] (else [DefaultEndpoint])
//
// It returns an error only when configuration is internally inconsistent (for
// example an unparseable endpoint); a missing API key is permitted so the
// resulting client can still hit unauthenticated endpoints and so credentials
// can be injected entirely via the environment.
//
//	// Fully from the environment:
//	lw, err := client.New()
//
//	// Explicit PAT + project:
//	lw, err := client.New(
//		client.WithAPIKey("pat-lw-..."),
//		client.WithProjectID("project_abc123"),
//	)
func New(opts ...Option) (*Client, error) {
	cfg := config{
		apiKey:       os.Getenv("LANGWATCH_API_KEY"),
		projectID:    os.Getenv("LANGWATCH_PROJECT_ID"),
		endpoint:     os.Getenv("LANGWATCH_ENDPOINT"),
		maxRetries:   DefaultMaxRetries,
		retryWaitMin: DefaultRetryWaitMin,
		retryWaitMax: DefaultRetryWaitMax,
		userAgent:    fmt.Sprintf("%s/%s", sdkName, sdkVersion),
	}
	if cfg.endpoint == "" {
		cfg.endpoint = DefaultEndpoint
	}
	for _, opt := range opts {
		opt(&cfg)
	}

	if cfg.httpClient == nil {
		cfg.httpClient = &http.Client{Timeout: DefaultTimeout}
	}

	c := &Client{cfg: cfg}

	// Wrap the caller's http.Client in the retrying transport, then hand it to
	// the generated client along with the header-stamping editor.
	doer := openapi.HttpRequestDoer(cfg.httpClient)
	if cfg.maxRetries > 0 {
		doer = &retryingDoer{
			inner:        cfg.httpClient,
			maxRetries:   cfg.maxRetries,
			retryWaitMin: cfg.retryWaitMin,
			retryWaitMax: cfg.retryWaitMax,
			rand:         rand.New(rand.NewSource(time.Now().UnixNano())),
		}
	}

	c.doer = doer

	gen, err := openapi.NewClient(
		cfg.endpoint,
		openapi.WithHTTPClient(doer),
		openapi.WithRequestEditorFn(c.requestEditor()),
	)
	if err != nil {
		return nil, fmt.Errorf("langwatch: creating client: %w", err)
	}
	c.gen = gen

	c.Prompts = &PromptsService{client: c}
	c.Datasets = &DatasetsService{client: c}
	c.Traces = &TracesService{client: c}
	c.Annotations = &AnnotationsService{client: c}
	c.Events = &EventsService{client: c}
	c.Evaluations = &EvaluationsService{client: c}
	c.Triggers = &TriggersService{client: c}
	c.Monitors = &MonitorsService{client: c}
	c.Scenarios = &ScenariosService{client: c}
	c.Projects = &ProjectsService{client: c}

	return c, nil
}

// Endpoint returns the resolved base URL the client targets. Useful for logging
// and tests.
func (c *Client) Endpoint() string { return c.cfg.endpoint }
