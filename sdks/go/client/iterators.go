package client

import (
	"context"
	"fmt"
	"iter"
)

// maxPageSize is the largest page the LangWatch API will serve on its heavy,
// paginated endpoints (dataset records, dataset/project lists, trace search).
// The auto-paginating iterators below default to it so an unbounded walk makes
// the fewest possible round-trips while still holding only one page in memory at
// a time.
const maxPageSize = 1000

// resolvePageSize picks the per-request page size for an auto-paginating
// iterator. An unset (non-positive) size defaults to [maxPageSize] to minimise
// round-trips; a caller-set size is respected but clamped to the server maximum,
// since a larger value would be capped server-side anyway and only inflate the
// request.
func resolvePageSize(requested int) int {
	if requested <= 0 || requested > maxPageSize {
		return maxPageSize
	}
	return requested
}

// AllRecords returns an iterator over every record in a dataset, transparently
// fetching one page at a time so memory stays flat across an arbitrarily large
// dataset. It complements [DatasetsService.ListRecords], which returns a single
// page; reach for AllRecords when you want to stream the whole set.
//
//	for rec, err := range lw.Datasets.AllRecords(ctx, "golden-examples", client.ListDatasetsParams{}) {
//		if err != nil {
//			log.Fatal(err)
//		}
//		process(rec)
//	}
//
// The page size defaults to the server maximum (1000) when params.Limit is
// unset. Pagination advances lazily: the next page is fetched only once the
// current one is exhausted, and stops as soon as a short page (or the reported
// total) signals the end. A page-fetch error is yielded once as (nil, err) and
// ends iteration. Breaking out of the loop stops fetching immediately, and the
// supplied context is honoured between pages.
func (s *DatasetsService) AllRecords(ctx context.Context, slugOrID string, params ListDatasetsParams) iter.Seq2[map[string]any, error] {
	limit := resolvePageSize(params.Limit)
	return func(yield func(map[string]any, error) bool) {
		page := params.Page
		if page <= 0 {
			page = 1
		}
		seen := 0
		for {
			if err := ctx.Err(); err != nil {
				yield(nil, err)
				return
			}
			records, pg, err := s.ListRecords(ctx, slugOrID, ListDatasetsParams{Page: page, Limit: limit})
			if err != nil {
				yield(nil, err)
				return
			}
			for _, rec := range records {
				if !yield(rec, nil) {
					return
				}
			}
			seen += len(records)
			if !hasNextOffsetPage(len(records), limit, seen, pg.Total) {
				return
			}
			page++
		}
	}
}

// All returns an iterator over every dataset in the project, fetching one page
// at a time. It complements [DatasetsService.List], which returns a single page.
//
//	for d, err := range lw.Datasets.All(ctx, client.ListDatasetsParams{}) {
//		if err != nil {
//			log.Fatal(err)
//		}
//		fmt.Println(d.Slug)
//	}
//
// The page size defaults to the server maximum (1000) when params.Limit is
// unset; pagination, error and early-termination semantics match
// [DatasetsService.AllRecords].
func (s *DatasetsService) All(ctx context.Context, params ListDatasetsParams) iter.Seq2[Dataset, error] {
	limit := resolvePageSize(params.Limit)
	return func(yield func(Dataset, error) bool) {
		page := params.Page
		if page <= 0 {
			page = 1
		}
		seen := 0
		for {
			if err := ctx.Err(); err != nil {
				yield(Dataset{}, err)
				return
			}
			datasets, pg, err := s.List(ctx, ListDatasetsParams{Page: page, Limit: limit})
			if err != nil {
				yield(Dataset{}, err)
				return
			}
			for _, d := range datasets {
				if !yield(d, nil) {
					return
				}
			}
			seen += len(datasets)
			if !hasNextOffsetPage(len(datasets), limit, seen, pg.Total) {
				return
			}
			page++
		}
	}
}

// All returns an iterator over every project in the organization, fetching one
// page at a time. It complements [ProjectsService.List], which returns a single
// page. Like [ProjectsService.List] it requires an admin-scoped API key.
//
//	for p, err := range lw.Projects.All(ctx, client.ListProjectsParams{}) {
//		if err != nil {
//			log.Fatal(err)
//		}
//		fmt.Println(*p.Id)
//	}
//
// The page size defaults to the server maximum (1000) when params.Limit is
// unset; pagination, error and early-termination semantics match
// [DatasetsService.AllRecords].
func (s *ProjectsService) All(ctx context.Context, params ListProjectsParams) iter.Seq2[Project, error] {
	limit := resolvePageSize(params.Limit)
	return func(yield func(Project, error) bool) {
		page := params.Page
		if page <= 0 {
			page = 1
		}
		seen := 0
		for {
			if err := ctx.Err(); err != nil {
				yield(Project{}, err)
				return
			}
			projects, pg, err := s.List(ctx, ListProjectsParams{Page: page, Limit: limit})
			if err != nil {
				yield(Project{}, err)
				return
			}
			for _, p := range projects {
				if !yield(p, nil) {
					return
				}
			}
			seen += len(projects)
			if !hasNextOffsetPage(len(projects), limit, seen, pg.Total) {
				return
			}
			page++
		}
	}
}

// All returns an iterator over every trace matching a search, fetching one page
// at a time. It complements [TracesService.Search], which returns a single page.
//
//	for tr, err := range lw.Traces.All(ctx, client.TraceSearchParams{Query: "timeout"}) {
//		if err != nil {
//			log.Fatal(err)
//		}
//		fmt.Println(*tr.TraceId)
//	}
//
// Pages are walked by the scroll cursor each response carries: the first
// request sends none, and every later one replays the ScrollID the previous
// response returned. The page size defaults to the server maximum (1000) when
// params.PageSize is unset; iteration stops when a response carries no cursor,
// which is how trace search says there is nothing after this page. A page-fetch
// error is yielded once as (zero, err) and ends iteration; breaking out of the
// loop stops fetching immediately; the supplied context is honoured between
// pages.
//
// It walked by pageOffset until trace search started rejecting a non-zero one.
// That parameter had been unread since trace storage moved to ClickHouse, so
// the walk was re-served page one for every request and, since a repeated full
// page never looks short, never terminated (#6808). The cursor is the only
// pagination the endpoint has ever actually honoured.
//
// Auto-pagination and a caller-supplied cursor remain mutually exclusive: a
// cursor names a position in a scroll this call did not start, and resuming
// someone else's scroll is a manual walk by definition. Passing params.ScrollID
// here therefore yields a single (zero, err) and stops — drive that scroll with
// [TracesService.Search] instead.
func (s *TracesService) All(ctx context.Context, params TraceSearchParams) iter.Seq2[Trace, error] {
	pageSize := resolvePageSize(params.PageSize)
	return func(yield func(Trace, error) bool) {
		if params.ScrollID != "" {
			yield(Trace{}, fmt.Errorf("langwatch: Traces.All: ScrollID cannot be combined with auto-pagination; use Traces.Search to drive a scroll cursor"))
			return
		}
		scrollID := ""
		for {
			if err := ctx.Err(); err != nil {
				yield(Trace{}, err)
				return
			}
			traces, nextScrollID, err := s.searchPage(ctx, params, scrollID, pageSize)
			if err != nil {
				yield(Trace{}, err)
				return
			}
			for _, tr := range traces {
				if !yield(tr, nil) {
					return
				}
			}
			// No cursor to advance with is the end of the result set. An empty
			// page ends it too: a server that kept handing back a cursor with
			// nothing attached would otherwise loop forever.
			if nextScrollID == "" || len(traces) == 0 {
				return
			}
			scrollID = nextScrollID
		}
	}
}

// searchPage fetches one cursor-addressed page of trace-search results and
// returns it alongside the cursor for the page after it (empty when there is
// none). It is the per-page engine behind [TracesService.All]. The request body
// mirrors [TracesService.Search] but pins pageSize and carries the walk's own
// cursor rather than params.ScrollID, which [TracesService.All] rejects up
// front.
func (s *TracesService) searchPage(ctx context.Context, params TraceSearchParams, scrollID string, pageSize int) ([]Trace, string, error) {
	body := map[string]any{
		"pageSize": pageSize,
	}
	if scrollID != "" {
		body["scrollId"] = scrollID
	}
	if params.Query != "" {
		body["query"] = params.Query
	}
	if params.StartDate != nil {
		body["startDate"] = params.StartDate
	}
	if params.EndDate != nil {
		body["endDate"] = params.EndDate
	}
	if params.Filters != nil {
		body["filters"] = params.Filters
	}

	reader, err := jsonReader(body)
	if err != nil {
		return nil, "", err
	}
	resp, err := s.client.gen.PostApiTracesSearchWithBody(ctx, contentTypeJSON, reader)
	var out TraceSearchResponse
	if derr := decodeInto("Traces.All", resp, err, &out); derr != nil {
		return nil, "", derr
	}
	return out.Traces, out.Pagination.ScrollID, nil
}

// AllRuns returns an iterator over every simulation run matching the filter,
// fetching one cursor-paginated page at a time. It complements
// [ScenariosService.ListRuns], which returns a single page; runs are yielded as
// free-form maps for the same reason ListRuns returns them that way.
//
//	for run, err := range lw.Scenarios.AllRuns(ctx, client.SimulationRunsParams{}) {
//		if err != nil {
//			log.Fatal(err)
//		}
//		process(run)
//	}
//
// The page size defaults to the server maximum (1000) when params.Limit is
// unset. Pagination advances by the page's NextCursor and stops when the API
// reports no more pages (HasMore false, or an empty page with no cursor). A
// page-fetch error is yielded once as (nil, err) and ends iteration; breaking
// out of the loop stops fetching immediately; the supplied context is honoured
// between pages.
func (s *ScenariosService) AllRuns(ctx context.Context, params SimulationRunsParams) iter.Seq2[map[string]any, error] {
	limit := resolvePageSize(params.Limit)
	return func(yield func(map[string]any, error) bool) {
		cursor := params.Cursor
		for {
			if err := ctx.Err(); err != nil {
				yield(nil, err)
				return
			}
			page, err := s.ListRuns(ctx, SimulationRunsParams{
				ScenarioSetID: params.ScenarioSetID,
				BatchRunID:    params.BatchRunID,
				Limit:         limit,
				Cursor:        cursor,
			})
			if err != nil {
				yield(nil, err)
				return
			}
			for _, run := range page.Runs {
				if !yield(run, nil) {
					return
				}
			}
			// Stop when the server signals no more pages, or fails to hand back a
			// cursor to advance with (a missing cursor can't be paged past).
			if !page.HasMore || page.NextCursor == "" {
				return
			}
			cursor = page.NextCursor
		}
	}
}

// hasNextOffsetPage reports whether an offset-paginated walk should fetch
// another page after the one just consumed. A page shorter than the requested
// limit is the last one; otherwise, when the server reported a positive Total,
// the walk also stops once everything seen so far covers it. A zero Total means
// "unknown", so paging continues on the short-page signal alone.
func hasNextOffsetPage(pageLen, limit, seen, total int) bool {
	if pageLen == 0 || pageLen < limit {
		return false
	}
	if total > 0 && seen >= total {
		return false
	}
	return true
}
