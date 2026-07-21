package ingestionbench

import (
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
