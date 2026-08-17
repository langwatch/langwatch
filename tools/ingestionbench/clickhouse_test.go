package ingestionbench

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFormatParam(t *testing.T) {
	t.Run("given a scalar", func(t *testing.T) {
		// ClickHouse parses param_ values as the type declared in the
		// {name:Type} placeholder, so scalars go over the wire bare.
		cases := []struct {
			name  string
			value any
			want  string
		}{
			{"passes a string through unquoted", "abc", "abc"},
			{"renders an int", 42, "42"},
			{"renders an int64", int64(1750000000000), "1750000000000"},
			{"renders a float without exponent notation", float64(1.5), "1.5"},
		}
		for _, c := range cases {
			t.Run(c.name, func(t *testing.T) {
				if got := formatParam(c.value); got != c.want {
					t.Errorf("got %q, want %q", got, c.want)
				}
			})
		}
	})

	t.Run("given a string array", func(t *testing.T) {
		t.Run("renders ClickHouse array literal syntax", func(t *testing.T) {
			got := formatParam([]string{"a", "b"})
			if got != "['a','b']" {
				t.Errorf("got %q, want %q", got, "['a','b']")
			}
		})

		t.Run("renders an empty array", func(t *testing.T) {
			if got := formatParam([]string{}); got != "[]" {
				t.Errorf("got %q, want %q", got, "[]")
			}
		})

		t.Run("escapes a quote so the literal cannot be closed early", func(t *testing.T) {
			// A trace id is hex in practice, but this is the boundary where a
			// hostile or corrupted id would become SQL injection.
			got := formatParam([]string{"a'b"})
			if got != `['a\'b']` {
				t.Errorf("got %q, want %q", got, `['a\'b']`)
			}
		})

		t.Run("escapes a backslash before it can escape the quote", func(t *testing.T) {
			got := formatParam([]string{`a\b`})
			if got != `['a\\b']` {
				t.Errorf("got %q, want %q", got, `['a\\b']`)
			}
		})
	})
}

func TestDecodeNDJSON(t *testing.T) {
	type row struct {
		TraceId   string `json:"TraceId"`
		SpanCount int    `json:"SpanCount"`
	}

	t.Run("given a JSONEachRow response", func(t *testing.T) {
		t.Run("decodes every line", func(t *testing.T) {
			var rows []row
			body := []byte("{\"TraceId\":\"a\",\"SpanCount\":2}\n{\"TraceId\":\"b\",\"SpanCount\":3}\n")
			if err := decodeNDJSON(body, &rows); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(rows) != 2 {
				t.Fatalf("got %d rows, want 2", len(rows))
			}
			if rows[1].TraceId != "b" || rows[1].SpanCount != 3 {
				t.Errorf("second row decoded as %+v", rows[1])
			}
		})

		t.Run("ignores blank lines", func(t *testing.T) {
			var rows []row
			if err := decodeNDJSON([]byte("\n{\"TraceId\":\"a\"}\n\n"), &rows); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(rows) != 1 {
				t.Errorf("got %d rows, want 1", len(rows))
			}
		})
	})

	t.Run("when the result set is empty", func(t *testing.T) {
		t.Run("yields no rows rather than an error", func(t *testing.T) {
			// An empty result is the normal answer to "did anything leak into
			// this tenant" — treating it as an error would fail every clean run.
			var rows []row
			if err := decodeNDJSON([]byte(""), &rows); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(rows) != 0 {
				t.Errorf("got %d rows, want 0", len(rows))
			}
		})
	})
}

func TestNewCHClient(t *testing.T) {
	t.Run("given a full DSN", func(t *testing.T) {
		client, err := newCHClient("http://default:secret@localhost:8123/langwatch_bench")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		t.Run("splits credentials, host, and database apart", func(t *testing.T) {
			if client.endpoint != "http://localhost:8123" {
				t.Errorf("endpoint is %q", client.endpoint)
			}
			if client.database != "langwatch_bench" {
				t.Errorf("database is %q", client.database)
			}
			if client.user != "default" || client.password != "secret" {
				t.Errorf("credentials are %q/%q", client.user, client.password)
			}
		})
	})

	t.Run("when the DSN is unusable", func(t *testing.T) {
		t.Run("rejects one with no host", func(t *testing.T) {
			if _, err := newCHClient("not-a-url"); err == nil {
				t.Error("expected an error for a DSN with no scheme or host")
			}
		})
	})
}

// queryJSON holds the error contract every verification query reads. A non-2xx
// that surfaced only its status code would turn a ClickHouse parse error into
// "the query failed", and the run would be diagnosed from the wrong end.
func TestQueryJSON(t *testing.T) {
	t.Run("given a server that answers", func(t *testing.T) {
		var gotQuery, gotRawQuery string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			gotQuery = string(body)
			gotRawQuery = r.URL.RawQuery
			_, _ = io.WriteString(w, `{"TraceId":"a","SpanCount":"3"}`+"\n"+
				`{"TraceId":"b","SpanCount":4}`+"\n")
		}))
		t.Cleanup(server.Close)

		client, err := newCHClient(server.URL + "/bench")
		if err != nil {
			t.Fatalf("could not build client: %v", err)
		}

		var rows []countRow
		err = queryJSON(context.Background(), client, chQuery{
			SQL:    "SELECT 1",
			Params: map[string]any{"tenantId": "p1", "fromMs": int64(7)},
			Into:   &rows,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		t.Run("sends the statement as the request body", func(t *testing.T) {
			if gotQuery != "SELECT 1" {
				t.Errorf("body is %q, want the statement", gotQuery)
			}
		})

		t.Run("binds every parameter under a param_ name", func(t *testing.T) {
			for _, want := range []string{"param_tenantId=p1", "param_fromMs=7"} {
				if !strings.Contains(gotRawQuery, want) {
					t.Errorf("query string %q is missing %q", gotRawQuery, want)
				}
			}
		})

		t.Run("puts the database on the query string", func(t *testing.T) {
			if !strings.Contains(gotRawQuery, "database=bench") {
				t.Errorf("query string %q is missing the database", gotRawQuery)
			}
		})

		t.Run("decodes both the quoted and bare integer shapes", func(t *testing.T) {
			if len(rows) != 2 {
				t.Fatalf("decoded %d rows, want 2", len(rows))
			}
			if rows[0].spans() != 3 || rows[1].spans() != 4 {
				t.Errorf("counts are %d and %d, want 3 and 4", rows[0].spans(), rows[1].spans())
			}
		})
	})

	t.Run("when ClickHouse refuses the query", func(t *testing.T) {
		t.Run("surfaces the body, not just the status", func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, "Code: 62. DB::Exception: Syntax error")
			}))
			t.Cleanup(server.Close)

			client, err := newCHClient(server.URL + "/bench")
			if err != nil {
				t.Fatalf("could not build client: %v", err)
			}

			var rows []countRow
			err = queryJSON(context.Background(), client, chQuery{SQL: "SELEC 1", Into: &rows})
			if err == nil {
				t.Fatal("expected an error for a 400")
			}
			// Without the body every failure would read alike, and a typo in a
			// query would be indistinguishable from ClickHouse being down.
			if !strings.Contains(err.Error(), "DB::Exception: Syntax error") {
				t.Errorf("error %q does not carry the ClickHouse message", err)
			}
			if !strings.Contains(err.Error(), "400") {
				t.Errorf("error %q does not carry the status code", err)
			}
		})
	})

	t.Run("when a count cannot be read as an integer", func(t *testing.T) {
		t.Run("fails rather than decoding it as zero", func(t *testing.T) {
			// A swallowed decode error used to become 0, which the violation
			// rules then reported as spans the projection had dropped.
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_, _ = io.WriteString(w, `{"TraceId":"a","SpanCount":"not-a-number"}`+"\n")
			}))
			t.Cleanup(server.Close)

			client, err := newCHClient(server.URL + "/bench")
			if err != nil {
				t.Fatalf("could not build client: %v", err)
			}

			var rows []countRow
			err = queryJSON(context.Background(), client, chQuery{SQL: "SELECT 1", Into: &rows})
			if err == nil {
				t.Fatal("expected an error for an unreadable count")
			}
		})
	})
}
