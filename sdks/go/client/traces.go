package client

import (
	"context"
	"time"

	"github.com/langwatch/langwatch/sdks/go/client/internal/openapi"
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
//
// It is written out here rather than aliased to the shared openapi.SearchResponse,
// which describes a page/limit/total envelope that /api/traces/search does not
// send. Decoding into it silently dropped the scroll cursor, so ScrollID could
// be sent but never received and a manual scroll was impossible to drive.
type TraceSearchResponse struct {
	Traces     []Trace               `json:"traces"`
	Pagination TraceSearchPagination `json:"pagination"`
}

// TraceSearchPagination carries where a search left off.
type TraceSearchPagination struct {
	// ScrollID is the cursor for the NEXT page. Its absence means this page is
	// the last one — that is the only end-of-results signal the API gives.
	ScrollID string `json:"scrollId,omitempty"`
	// TotalHits counts everything matching the search, not just this page.
	TotalHits int `json:"totalHits"`
}

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
	// ScrollID continues a previous search; pass the ScrollID the previous
	// response carried in its Pagination. Trace search pages by cursor only —
	// there is no offset — so this is how a manual walk advances.
	ScrollID string
}

// Search runs a trace search and returns matching traces plus pagination
// metadata. It targets the current /api/traces/search endpoint.
//
// To walk more than one page, either use [TracesService.All], or feed each
// response's Pagination.ScrollID back in as the next request's ScrollID and
// stop when a response carries none.
//
//	res, err := lw.Traces.Search(ctx, client.TraceSearchParams{
//		Query:   "timeout",
//		Filters: map[string][]string{"metadata.user_id": {"u_123"}},
//	})
//	if err == nil {
//		for _, t := range res.Traces { fmt.Println(*t.TraceId) }
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
