package client

import (
	"context"
	"time"

	"github.com/langwatch/langwatch/sdk-go/client/internal/openapi"
)

// TracesService is the client for reading and searching ingested traces.
//
// Access it via [Client.Traces]. Trace and search payloads reuse the API's
// shared schemas, re-exported here as [Trace], [TraceSearchResponse] and
// related types so callers depend only on this package.
type TracesService struct {
	client *Client
}

// Trace is an ingested trace as returned by the API, including its input,
// output, metrics, metadata and any evaluations.
type Trace = openapi.Trace

// TraceMetrics, TraceMetadata, TraceEvaluation and related aliases re-export the
// nested trace schemas for convenience.
type (
	TraceMetrics    = openapi.Metrics
	TraceMetadata   = openapi.Metadata
	TraceEvaluation = openapi.Evaluation
	TraceInput      = openapi.Input
	TraceOutput     = openapi.Output
)

// TraceSearchResponse is the paginated result of [TracesService.Search].
type TraceSearchResponse = openapi.SearchResponse

// TraceSearchParams describes a trace search. All fields are optional; an empty
// params searches recent traces with server defaults.
type TraceSearchParams struct {
	// Query is a free-text search string.
	Query string
	// StartDate and EndDate bound the search window.
	StartDate *time.Time
	EndDate   *time.Time
	// Filters maps a filter field to the set of values to match.
	Filters map[string][]string
	// PageSize caps the number of traces returned.
	PageSize int
	// ScrollID continues a previous search; pass the value the API returned.
	ScrollID string
}

// Search runs a trace search and returns matching traces plus pagination
// metadata. It targets the current /api/traces/search endpoint.
//
//	res, err := lw.Traces.Search(ctx, client.TraceSearchParams{
//		Query:   "timeout",
//		Filters: map[string][]string{"metadata.user_id": {"u_123"}},
//	})
//	if err == nil && res.Traces != nil {
//		for _, t := range *res.Traces { fmt.Println(*t.TraceId) }
//	}
func (s *TracesService) Search(ctx context.Context, params TraceSearchParams) (*TraceSearchResponse, error) {
	body := openapi.SearchRequest{}
	if params.Query != "" {
		body.Query = &params.Query
	}
	if params.StartDate != nil {
		body.StartDate = params.StartDate
	}
	if params.EndDate != nil {
		body.EndDate = params.EndDate
	}
	if params.Filters != nil {
		body.Filters = &params.Filters
	}
	if params.PageSize > 0 {
		body.PageSize = &params.PageSize
	}
	if params.ScrollID != "" {
		body.ScrollId = &params.ScrollID
	}
	reader, err := jsonReader(body)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.gen.PostApiTracesSearchWithBody(ctx, contentTypeJSON, reader)
	var out TraceSearchResponse
	if derr := decodeInto("Traces.Search", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// Get fetches a single trace by ID. The API returns either an AI-readable digest
// or the full raw JSON; this method requests the full JSON form and returns the
// decoded [Trace].
//
//	t, err := lw.Traces.Get(ctx, "trace_abc123")
func (s *TracesService) Get(ctx context.Context, traceID string) (*Trace, error) {
	jsonFormat := openapi.GetApiTracesByTraceIdParamsFormatJson
	params := &openapi.GetApiTracesByTraceIdParams{Format: &jsonFormat}
	resp, err := s.client.gen.GetApiTracesByTraceId(ctx, traceID, params)
	var out Trace
	if derr := decodeInto("Traces.Get", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}
