package clickhouseprobe

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// answeringServer stands in for clickhouse-server's HTTP interface, recording
// what the probe asked so the test can check it never wrote anything.
func answeringServer(t *testing.T, status int, body string) (*httptest.Server, *recorded) {
	t.Helper()
	rec := &recorded{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sent, _ := io.ReadAll(r.Body)
		rec.sql = string(sent)
		rec.path = r.URL.Path
		rec.user, rec.password, rec.hadAuth = r.BasicAuth()
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv, rec
}

type recorded struct {
	sql      string
	path     string
	user     string
	password string
	hadAuth  bool
}

// @scenario "An absent memory ceiling is read as absent, not as zero"
func TestProbeCeiling(t *testing.T) {
	t.Run("given a server that sets no ceiling of its own", func(t *testing.T) {
		// What a stock clickhouse-server actually answers: the setting is
		// present and zero. Zero is the hazard — it reads as "no limit
		// configured" and behaves as the ratio.
		body := "max_server_memory_usage\t0\nmax_server_memory_usage_to_ram_ratio\t0.9\n"
		srv, rec := answeringServer(t, http.StatusOK, body)

		t.Run("when the probe reads it", func(t *testing.T) {
			got, err := New().Ceiling(context.Background(), srv.URL)
			if err != nil {
				t.Fatalf("probe failed: %v", err)
			}

			t.Run("carries the absent ceiling through as absent", func(t *testing.T) {
				if !got.Implicit() {
					t.Errorf("got %+v, want an implicit ceiling", got)
				}
			})

			t.Run("keeps the ratio that actually decides", func(t *testing.T) {
				if got.RAMRatio != 0.9 {
					t.Errorf("got ratio %v, want 0.9", got.RAMRatio)
				}
			})

			t.Run("reads only, and only the settings table", func(t *testing.T) {
				if !strings.HasPrefix(strings.TrimSpace(rec.sql), "SELECT") {
					t.Errorf("probe sent a non-SELECT: %s", rec.sql)
				}
				if !strings.Contains(rec.sql, "system.server_settings") {
					t.Errorf("probe did not read system.server_settings: %s", rec.sql)
				}
			})

			t.Run("asks the server root, not the pinned database", func(t *testing.T) {
				if rec.path != "/" {
					t.Errorf("got path %q, want /", rec.path)
				}
			})
		})
	})

	t.Run("given a server with an explicit ceiling", func(t *testing.T) {
		body := "max_server_memory_usage\t1449551462\nmax_server_memory_usage_to_ram_ratio\t0.9\n"
		srv, _ := answeringServer(t, http.StatusOK, body)

		t.Run("when the probe reads it", func(t *testing.T) {
			got, err := New().Ceiling(context.Background(), srv.URL)
			if err != nil {
				t.Fatalf("probe failed: %v", err)
			}

			t.Run("reports the explicit number", func(t *testing.T) {
				if got.MaxServerMemoryUsage != 1449551462 || got.Implicit() {
					t.Errorf("got %+v, want the explicit ceiling", got)
				}
			})
		})
	})

	t.Run("given credentials on the URL", func(t *testing.T) {
		srv, rec := answeringServer(t, http.StatusOK, "max_server_memory_usage\t0\n")
		authed := strings.Replace(srv.URL, "http://", "http://default:langwatch@", 1)

		t.Run("when the probe reads it", func(t *testing.T) {
			if _, err := New().Ceiling(context.Background(), authed+"/lw_main"); err != nil {
				t.Fatalf("probe failed: %v", err)
			}

			t.Run("authenticates with them", func(t *testing.T) {
				if !rec.hadAuth || rec.user != "default" || rec.password != "langwatch" {
					t.Errorf("got %q/%q (auth %v), want the URL's credentials", rec.user, rec.password, rec.hadAuth)
				}
			})
		})
	})

	t.Run("given a server that refuses the query", func(t *testing.T) {
		srv, _ := answeringServer(t, http.StatusForbidden, "not for you")

		t.Run("when the probe reads it", func(t *testing.T) {
			_, err := New().Ceiling(context.Background(), strings.Replace(srv.URL, "http://", "http://user:hunter2@", 1))

			t.Run("fails", func(t *testing.T) {
				if err == nil {
					t.Fatal("a refused query did not fail")
				}
			})

			t.Run("keeps the password out of the error", func(t *testing.T) {
				if strings.Contains(err.Error(), "hunter2") {
					t.Errorf("error leaked the password: %v", err)
				}
			})
		})
	})

	t.Run("given a server that answers without the settings", func(t *testing.T) {
		srv, _ := answeringServer(t, http.StatusOK, "some_other_setting\t7\n")

		t.Run("when the probe reads it", func(t *testing.T) {
			t.Run("fails rather than reporting a zero ceiling", func(t *testing.T) {
				got, err := New().Ceiling(context.Background(), srv.URL)
				if err == nil {
					t.Fatalf("got %+v, want an error", got)
				}
			})
		})
	})
}

// @scenario "The ceiling check does not depend on who manages the server"
func TestProbeFeedsTheSameVerdict(t *testing.T) {
	t.Run("given the uncapped server that panicked the laptop", func(t *testing.T) {
		body := "max_server_memory_usage\t0\nmax_server_memory_usage_to_ram_ratio\t0.9\n"
		srv, _ := answeringServer(t, http.StatusOK, body)

		t.Run("when its reading is judged against that machine", func(t *testing.T) {
			ceiling, err := New().Ceiling(context.Background(), srv.URL)
			if err != nil {
				t.Fatalf("probe failed: %v", err)
			}
			verdict := domain.AssessClickHouseCeiling(ceiling, 19327352832)

			t.Run("fails the check end to end", func(t *testing.T) {
				if verdict.Safe {
					t.Errorf("got %+v, want an unsafe verdict", verdict)
				}
			})

			t.Run("produces a warning naming the server", func(t *testing.T) {
				if msg := verdict.Warning("the ClickHouse at " + domain.SafeDisplayURL(srv.URL)); !strings.Contains(msg, "127.0.0.1") {
					t.Errorf("warning did not name the server: %s", msg)
				}
			})
		})
	})
}
