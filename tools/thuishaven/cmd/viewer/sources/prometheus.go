package sources

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Prometheus is the metrics tab's backing. The tab is a fixed panel rather than
// a query box on purpose, so the queries live here as a list: the six questions
// a person actually has about a local stack, each asked the same way every time.

// metricStep is the resolution of the sparkline. Ten minutes at fifteen seconds
// is forty samples, which is about as many blocks as fit on a terminal line.
const metricStep = 15 * time.Second

// panelQuery is one row of the fixed panel: what it is called, what to ask, and
// how to spell the answer.
type panelQuery struct {
	label string
	query string
	unit  string
}

// panel is the fixed metrics panel, in the order it is rendered. Every query is
// narrowed to one worktree through the same attribute the other signals carry;
// %s is that slug.
var panel = []panelQuery{
	{label: "request rate", query: `sum by (service_name) (rate(http_server_request_duration_count{langwatch_worktree="%s"}[5m]))`, unit: "/s"},
	{label: "p95 latency", query: `histogram_quantile(0.95, sum by (service_name, le) (rate(http_server_request_duration_bucket{langwatch_worktree="%s"}[5m])))`, unit: "s"},
	{label: "queue depth", query: `sum(langwatch_queue_depth{langwatch_worktree="%s"})`, unit: ""},
	{label: "blocked jobs", query: `sum(langwatch_queue_blocked_jobs{langwatch_worktree="%s"})`, unit: ""},
	{label: "ClickHouse statements", query: `sum(langwatch_clickhouse_statements_in_flight{langwatch_worktree="%s"})`, unit: ""},
	{label: "lane RSS", query: `sum by (class) (haven_proc_rss_bytes)`, unit: "bytes"},
	{label: "lane CPU", query: `sum by (class) (rate(process_cpu_seconds_total{langwatch_worktree="%s"}[5m]))`, unit: "cores"},
}

// Prometheus reads the bundle's Prometheus through Grafana's datasource proxy.
type Prometheus struct {
	api        endpoint
	worktree   string
	datasource string
}

// NewPrometheus opens a source over the bundle's Grafana for one worktree.
func NewPrometheus(grafanaPort int, worktree string) *Prometheus {
	return &Prometheus{api: newEndpoint(grafanaPort), worktree: worktree, datasource: "prometheus"}
}

// Up reports whether the observability stack is listening.
func (p *Prometheus) Up() bool { return p.api.up() }

// promRange is the shape Prometheus's query_range answers with.
type promRange struct {
	Data struct {
		Result []struct {
			Metric map[string]string `json:"metric"`
			Values [][2]any          `json:"values"`
		} `json:"result"`
	} `json:"data"`
}

// Panel answers every fixed query and returns one series per row, in order. A
// query that fails contributes a row with no samples rather than dropping out:
// a panel whose rows move around between polls is unreadable.
func (p *Prometheus) Panel() ([]Series, error) {
	if !p.Up() {
		return nil, ErrStackDown
	}
	out := make([]Series, 0, len(panel))
	for _, row := range panel {
		out = append(out, p.series(row))
	}
	return out, nil
}

// series runs one panel query and folds every returned label set into one line.
func (p *Prometheus) series(row panelQuery) Series {
	query := row.query
	if strings.Contains(query, "%s") {
		query = fmt.Sprintf(query, p.worktree)
	}
	samples := p.samples(query)
	value := " - "
	if len(samples) > 0 {
		value = FormatValue(samples[len(samples)-1], row.unit)
	}
	return Series{Label: row.label, Value: value, Samples: samples}
}

// samples reads one query's window, summing every returned label set per step
// so the row is one line however many services answered.
func (p *Prometheus) samples(query string) []float64 {
	params := url.Values{}
	now := time.Now()
	params.Set("query", query)
	params.Set("start", strconv.FormatInt(now.Add(-ProfileWindow).Unix(), 10))
	params.Set("end", strconv.FormatInt(now.Unix(), 10))
	params.Set("step", strconv.Itoa(int(metricStep.Seconds())))
	var body promRange
	path := "/api/datasources/proxy/uid/" + p.datasource + "/api/v1/query_range"
	if err := p.api.getJSON(path, params, &body); err != nil {
		return nil
	}
	var summed []float64
	for _, result := range body.Data.Result {
		for i, pair := range result.Values {
			value := parseSample(pair)
			if i < len(summed) {
				summed[i] += value
				continue
			}
			summed = append(summed, value)
		}
	}
	return summed
}

// parseSample reads Prometheus's [timestamp, "value"] pair.
func parseSample(pair [2]any) float64 {
	text, ok := pair[1].(string)
	if !ok {
		return 0
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return 0
	}
	return value
}
