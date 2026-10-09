package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// queryLang is the backend language a raw `haven query` is written in.
type queryLang string

const (
	langTraceQL queryLang = "traceql"
	langLogQL   queryLang = "logql"
	langPromQL  queryLang = "promql"
)

const (
	queryDefaultWindow = time.Hour
	queryDefaultLimit  = 100
	queryTimeout       = 10 * time.Second
)

// rawQuery is one `haven query` read with the worktree filter already forced in.
type rawQuery struct {
	lang   queryLang
	scoped string
	window time.Duration
	limit  int
}

// querySpec is the raw-query escape hatch over the stack's Tempo, Loki and
// Prometheus, for what the curated traces and logs flags cannot ask.
func querySpec() commandSpec {
	return commandSpec{
		name:    "query",
		summary: "raw TraceQL / LogQL / PromQL against this stack's own telemetry, worktree filter forced in",
		args:    "<traceql|logql|promql> <query>",
		maxArgs: 2,
		flags: []flagSpec{
			{long: "--since", takesValue: true, value: "<dur>", summary: "look back this far, e.g. 10m (default 1h)"},
			{long: "--limit", takesValue: true, value: "<n>", summary: "at most n traces, lines or series (default 100)"},
			{long: "--json", summary: "machine-readable: the scoped query, the backend's answer and a Grafana link"},
			{long: "--stack", takesValue: true, value: "<slug>", summary: "another worktree's stack by slug"},
		},
		run: runQuery,
	}
}

func runQuery(_ context.Context, d deps, inv invocation) error {
	if len(inv.args) != 2 {
		return errors.New("haven query wants a language and one quoted query: haven query traceql|logql|promql '<query>'")
	}
	slug, err := tabSlug(d, inv)
	if err != nil {
		return err
	}
	q, err := rawQueryFrom(inv, slug)
	if err != nil {
		return err
	}
	base := fmt.Sprintf("http://127.0.0.1:%d", observabilityEndpoints().GrafanaPort)
	return q.run(base, readOutput{w: os.Stdout, asJSON: inv.has("--json") || d.isAgent})
}

// rawQueryFrom reads the language, the flags and scopes the query to slug.
func rawQueryFrom(inv invocation, slug string) (rawQuery, error) {
	lang := queryLang(inv.args[0])
	switch lang {
	case langTraceQL, langLogQL, langPromQL:
	default:
		return rawQuery{}, fmt.Errorf("haven query wants traceql, logql or promql, got %q", inv.args[0])
	}
	q := rawQuery{lang: lang, scoped: scopeQuery(lang, inv.args[1], slug), window: queryDefaultWindow, limit: queryDefaultLimit}
	window, err := parseDurationFlag(inv, "--since")
	if err != nil {
		return q, err
	}
	if window > 0 {
		q.window = window
	}
	if v := inv.value("--limit"); v != "" {
		if q.limit, err = strconv.Atoi(v); err != nil || q.limit <= 0 {
			return q, fmt.Errorf("--limit wants a positive number, got %q", v)
		}
	}
	return q, nil
}

// run sends the query through Grafana's datasource proxy at base and prints it.
func (q rawQuery) run(base string, out readOutput) error {
	path, params := q.request(time.Now())
	raw, err := getRaw(base+path, params)
	if err != nil {
		return traceReadError(err)
	}
	out.link = q.grafanaLink(base)
	if out.asJSON {
		return encodeJSON(out.w, map[string]any{"query": q.scoped, "grafana": out.link, "data": raw})
	}
	if q.lang == langTraceQL {
		err = printTraceSearch(out.w, raw)
	} else {
		err = printSeries(out.w, raw, q.limit)
	}
	if err != nil {
		return err
	}
	fmt.Fprintln(out.w, "grafana:", out.link)
	return nil
}

// request is the proxy path and parameters for the query's backend.
func (q rawQuery) request(now time.Time) (string, url.Values) {
	start := now.Add(-q.window)
	params := url.Values{}
	switch q.lang {
	case langTraceQL:
		params.Set("q", q.scoped)
		params.Set("limit", strconv.Itoa(q.limit))
		params.Set("start", strconv.FormatInt(start.Unix(), 10))
		params.Set("end", strconv.FormatInt(now.Unix(), 10))
		return "/api/datasources/proxy/uid/tempo/api/search", params
	case langLogQL:
		params.Set("query", q.scoped)
		params.Set("limit", strconv.Itoa(q.limit))
		params.Set("start", strconv.FormatInt(start.UnixNano(), 10))
		params.Set("end", strconv.FormatInt(now.UnixNano(), 10))
		params.Set("direction", "backward")
		return "/api/datasources/proxy/uid/loki/loki/api/v1/query_range", params
	case langPromQL:
	}
	params.Set("query", q.scoped)
	params.Set("start", strconv.FormatInt(start.Unix(), 10))
	params.Set("end", strconv.FormatInt(now.Unix(), 10))
	params.Set("step", strconv.Itoa(max(15, int(q.window.Seconds())/100)))
	return "/api/datasources/proxy/uid/prometheus/api/v1/query_range", params
}

// grafanaLink opens the scoped query in the bundle's Grafana Explore.
func (q rawQuery) grafanaLink(base string) string {
	uid, query := string(q.lang), map[string]any{"refId": "A", "expr": q.scoped}
	switch q.lang {
	case langTraceQL:
		uid, query = "tempo", map[string]any{"refId": "A", "queryType": "traceql", "query": q.scoped}
	case langLogQL:
		uid = "loki"
	case langPromQL:
		uid = "prometheus"
	}
	query["datasource"] = map[string]string{"uid": uid}
	pane, _ := json.Marshal(map[string]any{"q": map[string]any{
		"datasource": uid, "queries": []any{query},
		"range": map[string]string{"from": "now-" + q.window.String(), "to": "now"},
	}})
	return base + "/explore?schemaVersion=1&orgId=1&panes=" + url.QueryEscape(string(pane))
}

// getRaw reads one JSON body. A refused connection is the stack being down.
func getRaw(target string, params url.Values) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return nil, fmt.Errorf("%w (%w)", sources.ErrStackDown, err)
	}
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("query refused (%s): %s", resp.Status, strings.TrimSpace(string(body)))
	}
	return body, nil
}

// printTraceSearch prints Tempo's search answer, one trace per line.
func printTraceSearch(w io.Writer, raw json.RawMessage) error {
	var body struct {
		Traces []struct {
			TraceID           string `json:"traceID"`
			RootServiceName   string `json:"rootServiceName"`
			RootTraceName     string `json:"rootTraceName"`
			StartTimeUnixNano string `json:"startTimeUnixNano"`
			DurationMs        int64  `json:"durationMs"`
		} `json:"traces"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return err
	}
	if len(body.Traces) == 0 {
		fmt.Fprintln(w, "(no traces matched in this stack)")
	}
	for _, t := range body.Traces {
		nanos, _ := strconv.ParseInt(t.StartTimeUnixNano, 10, 64)
		fmt.Fprintf(w, "%s  %s  %s  %s  %dms\n", time.Unix(0, nanos).Format(time.RFC3339),
			t.TraceID, t.RootServiceName, t.RootTraceName, t.DurationMs)
	}
	return nil
}

// seriesBody is the shape Loki and Prometheus share for query_range.
type seriesBody struct {
	Data struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Stream map[string]string    `json:"stream"`
			Metric map[string]string    `json:"metric"`
			Values [][2]json.RawMessage `json:"values"`
		} `json:"result"`
	} `json:"data"`
}

// printSeries prints log streams oldest first, or each series' latest value.
func printSeries(w io.Writer, raw json.RawMessage, limit int) error {
	var body seriesBody
	if err := json.Unmarshal(raw, &body); err != nil {
		return err
	}
	if len(body.Data.Result) == 0 {
		fmt.Fprintln(w, "(no results in this stack)")
	}
	if body.Data.ResultType == "streams" {
		printStreams(w, body)
		return nil
	}
	for i, r := range body.Data.Result {
		if i == limit {
			break
		}
		last := "-"
		if n := len(r.Values); n > 0 {
			last = strings.Trim(string(r.Values[n-1][1]), `"`)
		}
		fmt.Fprintf(w, "%s  %s\n", labelSet(r.Metric), last)
	}
	return nil
}

// printStreams prints every log line, oldest first, with its service.
func printStreams(w io.Writer, body seriesBody) {
	type line struct{ at, service, text string }
	var lines []line
	for _, r := range body.Data.Result {
		for _, v := range r.Values {
			var at, text string
			_ = json.Unmarshal(v[0], &at)
			_ = json.Unmarshal(v[1], &text)
			lines = append(lines, line{at: at, service: r.Stream["service_name"], text: text})
		}
	}
	sort.SliceStable(lines, func(i, j int) bool { return lines[i].at < lines[j].at })
	for _, l := range lines {
		nanos, _ := strconv.ParseInt(l.at, 10, 64)
		fmt.Fprintf(w, "%s  %s  %s\n", time.Unix(0, nanos).Format(time.RFC3339Nano), l.service, l.text)
	}
}

// labelSet spells a series' labels the PromQL way, sorted.
func labelSet(labels map[string]string) string {
	parts := make([]string, 0, len(labels))
	for k, v := range labels {
		parts = append(parts, fmt.Sprintf("%s=%q", k, v))
	}
	sort.Strings(parts)
	return "{" + strings.Join(parts, ", ") + "}"
}
