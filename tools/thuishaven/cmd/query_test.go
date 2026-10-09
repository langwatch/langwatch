package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestScopeQueryForcesTheWorktreeIntoEverySelector(t *testing.T) {
	cases := []struct {
		name  string
		lang  queryLang
		query string
		want  string
	}{
		{"traceql empty spanset", langTraceQL, `{}`, `{ resource.langwatch.worktree = "wt" }`},
		{"traceql conditions", langTraceQL, `{ status = error } | count() > 1`,
			`{ resource.langwatch.worktree = "wt" && ( status = error ) } | count() > 1`},
		{"logql selector", langLogQL, `{service_name="api"} |= "boom"`,
			`{service_name="api"} | langwatch_worktree="wt" |= "boom"`},
		{"logql braces in a string are left alone", langLogQL, `{a="b"} | line_format "{{.x}}"`,
			`{a="b"} | langwatch_worktree="wt" | line_format "{{.x}}"`},
		{"promql braced", langPromQL, `rate(x{job="a"}[5m])`, `rate(x{langwatch_worktree="wt", job="a"}[5m])`},
		{"promql bare names and label lists", langPromQL, `sum by (service_name) (up) / on(job) down offset 5m`,
			`sum by (service_name) (up{langwatch_worktree="wt"}) / on(job) down{langwatch_worktree="wt"} offset 5m`},
		{"promql empty braces", langPromQL, `{__name__="up"} > bool 1`,
			`{langwatch_worktree="wt", __name__="up"} > bool 1`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := scopeQuery(tc.lang, tc.query, "wt"); got != tc.want {
				t.Errorf("got  %s\nwant %s", got, tc.want)
			}
		})
	}
}

func TestRawQueryRefusesAnUnknownLanguage(t *testing.T) {
	if _, err := rawQueryFrom(invocation{args: []string{"sql", "select 1"}}, "wt"); err == nil {
		t.Fatal("want an error for sql")
	}
}

// stubGrafana answers one proxy path and records the query it was asked.
func stubGrafana(t *testing.T, path, body string) (*httptest.Server, *string) {
	t.Helper()
	var asked string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != path {
			http.NotFound(w, r)
			return
		}
		asked = r.URL.Query().Get("query") + r.URL.Query().Get("q")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv, &asked
}

func TestLogQLReadPrintsLinesOldestFirstAndSendsTheScopedQuery(t *testing.T) {
	srv, asked := stubGrafana(t, "/api/datasources/proxy/uid/loki/loki/api/v1/query_range",
		`{"data":{"resultType":"streams","result":[{"stream":{"service_name":"api"},
		"values":[["1700000000000000002","second"],["1700000000000000001","first"]]}]}}`)
	q := rawQuery{lang: langLogQL, scoped: scopeQuery(langLogQL, `{a="b"}`, "wt"), window: time.Hour, limit: 10}
	var out bytes.Buffer
	if err := q.run(srv.URL, readOutput{w: &out}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(*asked, `langwatch_worktree="wt"`) {
		t.Errorf("asked %q", *asked)
	}
	got := out.String()
	if strings.Index(got, "first") > strings.Index(got, "second") || !strings.Contains(got, "grafana: ") {
		t.Errorf("out = %q", got)
	}
}

func TestPromQLJSONCarriesQueryAnswerAndLink(t *testing.T) {
	srv, _ := stubGrafana(t, "/api/datasources/proxy/uid/prometheus/api/v1/query_range",
		`{"data":{"resultType":"matrix","result":[{"metric":{"job":"a"},"values":[[1,"2"]]}]}}`)
	q := rawQuery{lang: langPromQL, scoped: "up", window: time.Hour, limit: 10}
	var out bytes.Buffer
	if err := q.run(srv.URL, readOutput{w: &out, asJSON: true}); err != nil {
		t.Fatal(err)
	}
	var got struct {
		Query   string          `json:"query"`
		Grafana string          `json:"grafana"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Query != "up" || !strings.HasPrefix(got.Grafana, srv.URL+"/explore") || !strings.Contains(string(got.Data), "matrix") {
		t.Errorf("got %+v", got)
	}
}

func TestTraceQLPlainListsTraces(t *testing.T) {
	srv, _ := stubGrafana(t, "/api/datasources/proxy/uid/tempo/api/search",
		`{"traces":[{"traceID":"abc","rootServiceName":"api","rootTraceName":"GET /","durationMs":7}]}`)
	q := rawQuery{lang: langTraceQL, scoped: "{}", window: time.Hour, limit: 10}
	var out bytes.Buffer
	if err := q.run(srv.URL, readOutput{w: &out}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "abc  api  GET /  7ms") {
		t.Errorf("out = %q", out.String())
	}
}

func TestQueryAgainstADownStackSaysHowToStartIt(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	base := srv.URL
	srv.Close()
	q := rawQuery{lang: langPromQL, scoped: "up", window: time.Hour, limit: 10}
	err := q.run(base, readOutput{w: &bytes.Buffer{}})
	if err == nil || !strings.Contains(err.Error(), "haven up") {
		t.Errorf("err = %v", err)
	}
}
