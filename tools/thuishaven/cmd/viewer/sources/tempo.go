package sources

import (
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"time"
)

// Tempo is the traces tab's backing: TraceQL search for this worktree's root
// spans, and one trace's own spans for the drill-in. Every query carries the
// worktree attribute, because one collector serves every worktree on the
// machine and an unfiltered list is somebody else's stack.

// Tempo reads the bundle's Tempo through Grafana's datasource proxy. The
// bundle puts Tempo behind Grafana rather than publishing its own port, so the
// proxy is the only address on the host that answers at all.
type Tempo struct {
	api      endpoint
	grafana  string
	worktree string
	// datasource is the provisioned Tempo datasource's uid in the bundle.
	datasource string
}

// NewTempo opens a source over the bundle's Grafana, filtered to one worktree.
func NewTempo(grafanaPort int, worktree string) *Tempo {
	return &Tempo{
		api:        newEndpoint(grafanaPort),
		grafana:    fmt.Sprintf("http://127.0.0.1:%d", grafanaPort),
		worktree:   worktree,
		datasource: "tempo",
	}
}

// Up reports whether the observability stack is listening.
func (t *Tempo) Up() bool { return t.api.up() }

// traceQL is the selector for this worktree, narrowed to failures on demand.
func (t *Tempo) traceQL(errorsOnly bool) string {
	q := fmt.Sprintf("{ resource.langwatch.worktree = %q", t.worktree)
	if errorsOnly {
		q += " && status = error"
	}
	return q + " }"
}

// tempoSearch is the shape Tempo's /api/search answers with.
type tempoSearch struct {
	Traces []struct {
		TraceID           string `json:"traceID"`
		RootServiceName   string `json:"rootServiceName"`
		RootTraceName     string `json:"rootTraceName"`
		StartTimeUnixNano string `json:"startTimeUnixNano"`
		DurationMs        int64  `json:"durationMs"`
	} `json:"traces"`
}

// Roots lists this worktree's recent root spans, newest first.
func (t *Tempo) Roots(errorsOnly bool) ([]RootSpan, error) {
	if !t.Up() {
		return nil, ErrStackDown
	}
	rows, err := t.search(t.traceQL(errorsOnly))
	if err != nil {
		return nil, err
	}
	if errorsOnly {
		for i := range rows {
			rows[i].Error = true
		}
		return rows, nil
	}
	return markFailed(rows, t.failedIDs()), nil
}

// search runs one TraceQL query and maps it onto the list's rows.
func (t *Tempo) search(query string) ([]RootSpan, error) {
	params := url.Values{}
	params.Set("q", query)
	params.Set("limit", "50")
	params.Set("start", strconv.FormatInt(time.Now().Add(-ProfileWindow).Unix(), 10))
	params.Set("end", strconv.FormatInt(time.Now().Unix(), 10))
	var body tempoSearch
	path := "/api/datasources/proxy/uid/" + t.datasource + "/api/search"
	if err := t.api.getJSON(path, params, &body); err != nil {
		return nil, err
	}
	out := make([]RootSpan, 0, len(body.Traces))
	for _, tr := range body.Traces {
		nanos, _ := strconv.ParseInt(tr.StartTimeUnixNano, 10, 64)
		out = append(out, RootSpan{
			TraceID:  tr.TraceID,
			At:       time.Unix(0, nanos),
			Service:  tr.RootServiceName,
			Name:     tr.RootTraceName,
			Duration: time.Duration(tr.DurationMs) * time.Millisecond,
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.After(out[j].At) })
	return out, nil
}

// failedIDs is the second query behind the status column: which of this
// worktree's recent traces failed. It reports no error of its own, because
// losing it costs one column and nothing else - a reader who can see their
// traces but not which failed is better served than one shown an error where a
// list should be.
func (t *Tempo) failedIDs() map[string]bool {
	failed, err := t.search(t.traceQL(true))
	if err != nil {
		return nil
	}
	ids := make(map[string]bool, len(failed))
	for _, f := range failed {
		ids[f.TraceID] = true
	}
	return ids
}

// markFailed flags the rows whose trace came back from the errors-only search.
func markFailed(rows []RootSpan, failed map[string]bool) []RootSpan {
	for i := range rows {
		rows[i].Error = failed[rows[i].TraceID]
	}
	return rows
}

// otlpTrace is the OTLP JSON one trace comes back as.
type otlpTrace struct {
	Batches []struct {
		Resource struct {
			Attributes []otlpAttr `json:"attributes"`
		} `json:"resource"`
		ScopeSpans []struct {
			Spans []otlpSpan `json:"spans"`
		} `json:"scopeSpans"`
	} `json:"batches"`
}

type otlpAttr struct {
	Key   string `json:"key"`
	Value struct {
		StringValue string `json:"stringValue"`
	} `json:"value"`
}

type otlpSpan struct {
	SpanID            string `json:"spanId"`
	ParentSpanID      string `json:"parentSpanId"`
	Name              string `json:"name"`
	StartTimeUnixNano string `json:"startTimeUnixNano"`
	EndTimeUnixNano   string `json:"endTimeUnixNano"`
}

// Tree returns one trace's spans, depth-first, with each span's depth.
func (t *Tempo) Tree(traceID string) ([]Span, error) {
	if !t.Up() {
		return nil, ErrStackDown
	}
	var body otlpTrace
	path := "/api/datasources/proxy/uid/" + t.datasource + "/api/v2/traces/" + url.PathEscape(traceID)
	if err := t.api.getJSON(path, nil, &body); err != nil {
		return nil, err
	}
	return buildTree(flatten(body)), nil
}

// flatSpan is one span with the service it came from, before the tree is built.
type flatSpan struct {
	id, parent, name, service string
	duration                  time.Duration
}

// flatten reads every batch's spans and stamps each with its resource's service.
func flatten(body otlpTrace) []flatSpan {
	var out []flatSpan
	for _, batch := range body.Batches {
		service := serviceName(batch.Resource.Attributes)
		for _, scope := range batch.ScopeSpans {
			for _, span := range scope.Spans {
				out = append(out, toFlatSpan(span, service))
			}
		}
	}
	return out
}

// serviceName reads a resource's service.name attribute.
func serviceName(attrs []otlpAttr) string {
	for _, attr := range attrs {
		if attr.Key == "service.name" {
			return attr.Value.StringValue
		}
	}
	return ""
}

// toFlatSpan maps one OTLP span onto the tree builder's input.
func toFlatSpan(span otlpSpan, service string) flatSpan {
	start, _ := strconv.ParseInt(span.StartTimeUnixNano, 10, 64)
	end, _ := strconv.ParseInt(span.EndTimeUnixNano, 10, 64)
	return flatSpan{
		id: span.SpanID, parent: span.ParentSpanID, name: span.Name,
		service: service, duration: time.Duration(end - start),
	}
}

// buildTree orders the spans parents-before-children and stamps each with the
// depth it hangs at, which is all the drill-in's indentation needs.
func buildTree(spans []flatSpan) []Span {
	children := map[string][]flatSpan{}
	known := map[string]bool{}
	for _, s := range spans {
		known[s.id] = true
	}
	for _, s := range spans {
		parent := s.parent
		if parent == "" || !known[parent] {
			parent = "" // a root, or a span whose parent is outside this trace
		}
		children[parent] = append(children[parent], s)
	}
	var out []Span
	var walk func(parent string, depth int)
	walk = func(parent string, depth int) {
		for _, s := range children[parent] {
			out = append(out, Span{Depth: depth, Name: s.name, Service: s.service, Duration: s.duration})
			walk(s.id, depth+1)
		}
	}
	walk("", 0)
	return out
}

// GrafanaURL opens one trace in the bundle's Grafana.
func (t *Tempo) GrafanaURL(traceID string) string {
	pane := fmt.Sprintf(`{"t":{"datasource":%q,"queries":[{"query":%q,"queryType":"traceql"}]}}`,
		t.datasource, traceID)
	return t.grafana + "/explore?schemaVersion=1&panes=" + url.QueryEscape(pane) + "&orgId=1"
}
