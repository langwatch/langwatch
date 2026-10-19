package sources

import (
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain/logfmt"
)

// Loki is the log tab's second backing. With the observability stack up, haven
// mutes every console to warn and above, so the info and debug detail exists
// only here - which is the whole reason the tab offers a source switch rather
// than leaving the reader to conclude their application went quiet.

// lokiLimit bounds one query_range page. The tab renders a few hundred lines;
// asking for more only costs the bundle memory nobody reads.
const lokiLimit = 500

// Loki reads the bundle's Loki through Grafana's datasource proxy, filtered to
// one worktree.
type Loki struct {
	api        endpoint
	worktree   string
	datasource string
	grafana    string
	// since is the instant the previous page ended, so a poll asks only for
	// what it has not already shown.
	since time.Time
}

// NewLoki opens a source over the bundle's Grafana for one worktree's lines.
func NewLoki(grafanaPort int, worktree string, since time.Time) *Loki {
	return &Loki{
		api: newEndpoint(grafanaPort), worktree: worktree, datasource: "loki", since: since,
		grafana: fmt.Sprintf("http://127.0.0.1:%d", grafanaPort),
	}
}

// Up reports whether the observability stack is listening.
func (l *Loki) Up() bool { return l.api.up() }

// logQL selects every service's stream, then narrows to this worktree. The
// worktree tag is structured metadata rather than an indexed stream label, so
// it has to be a pipe filter: putting it in the selector matches nothing.
func (l *Loki) logQL() string {
	return fmt.Sprintf(`{service_name=~".+"} | langwatch_worktree=%q`, l.worktree)
}

// lokiRange is the shape Loki's query_range answers with.
type lokiRange struct {
	Data struct {
		Result []struct {
			Stream map[string]string `json:"stream"`
			Values [][2]string       `json:"values"`
		} `json:"result"`
	} `json:"data"`
}

// Fresh returns the lines Loki holds for this worktree since the previous call.
func (l *Loki) Fresh() []LogLine {
	if !l.Up() {
		return nil
	}
	params := url.Values{}
	params.Set("query", l.logQL())
	params.Set("start", strconv.FormatInt(l.since.UnixNano(), 10))
	params.Set("end", strconv.FormatInt(time.Now().UnixNano(), 10))
	params.Set("limit", strconv.Itoa(lokiLimit))
	params.Set("direction", "forward")
	var body lokiRange
	path := "/api/datasources/proxy/uid/" + l.datasource + "/loki/api/v1/query_range"
	if err := l.api.getJSON(path, params, &body); err != nil {
		return nil
	}
	return l.collect(body)
}

// collect flattens every stream's values into lines and advances the cursor.
func (l *Loki) collect(body lokiRange) []LogLine {
	var out []LogLine
	for _, stream := range body.Data.Result {
		lane := stream.Stream["service_name"]
		for _, value := range stream.Values {
			line, ok := l.toLine(lane, value)
			if !ok {
				continue
			}
			out = append(out, line)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out
}

// toLine maps one Loki [timestamp, line] pair onto a log line and advances the
// cursor past it, so the next poll asks only for what has not been shown.
func (l *Loki) toLine(lane string, value [2]string) (LogLine, bool) {
	nanos, err := strconv.ParseInt(value[0], 10, 64)
	if err != nil {
		return LogLine{}, false
	}
	at := time.Unix(0, nanos)
	line := LogLine{At: at, Lane: lane, Text: value[1]}
	if rec, ok := logfmt.Parse(value[1]); ok {
		line.Level = string(rec.Level)
	}
	if at.After(l.since) {
		l.since = at.Add(time.Nanosecond)
	}
	return line, true
}

// LogQuery narrows a full read of this worktree's stream. Services match as
// substrings of the OTel service name, since haven's lane names are not it.
type LogQuery struct {
	Services []string
	Grep     string
	TraceID  string
	Limit    int
}

// queryQL is the LogQL for the query: the service selector, the worktree pipe
// filter, then the line and trace filters.
func (l *Loki) queryQL(q LogQuery) string {
	sel := ".+"
	if len(q.Services) > 0 {
		quoted := make([]string, len(q.Services))
		for i, s := range q.Services {
			quoted[i] = ".*" + regexp.QuoteMeta(s) + ".*"
		}
		sel = strings.Join(quoted, "|")
	}
	ql := fmt.Sprintf("{service_name=~%q}", sel)
	if q.Grep != "" {
		ql += fmt.Sprintf(" |= %q", q.Grep)
	}
	ql += fmt.Sprintf(" | langwatch_worktree=%q", l.worktree)
	if q.TraceID != "" {
		ql += fmt.Sprintf(" | trace_id=%q", q.TraceID)
	}
	return ql
}

// Query returns the matching lines since the source's start, oldest first,
// capped at the newest q.Limit.
func (l *Loki) Query(q LogQuery) ([]LogLine, error) {
	if !l.Up() {
		return nil, ErrStackDown
	}
	if q.Limit <= 0 {
		q.Limit = lokiLimit
	}
	params := url.Values{}
	params.Set("query", l.queryQL(q))
	params.Set("start", strconv.FormatInt(l.since.UnixNano(), 10))
	params.Set("end", strconv.FormatInt(time.Now().UnixNano(), 10))
	params.Set("limit", strconv.Itoa(q.Limit))
	params.Set("direction", "backward")
	var body lokiRange
	path := "/api/datasources/proxy/uid/" + l.datasource + "/loki/api/v1/query_range"
	if err := l.api.getJSON(path, params, &body); err != nil {
		return nil, err
	}
	return l.collect(body), nil
}

// QueryURL opens the query in the bundle's Grafana.
func (l *Loki) QueryURL(q LogQuery) string {
	pane := fmt.Sprintf(`{"l":{"datasource":%q,"queries":[{"expr":%q,"queryType":"range"}]}}`,
		l.datasource, l.queryQL(q))
	return l.grafana + "/explore?schemaVersion=1&panes=" + url.QueryEscape(pane) + "&orgId=1"
}
