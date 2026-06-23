package client

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// offsetPageHandler serves an offset-paginated { data, pagination } envelope
// backed by a fixed total of records, honouring the page/limit query params. It
// counts the requests it served so tests can assert how many pages were fetched.
type offsetPageHandler struct {
	total    int
	requests int32
}

func (h *offsetPageHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt32(&h.requests, 1)
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page <= 0 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = h.total
	}
	start := (page - 1) * limit
	end := start + limit
	if start > h.total {
		start = h.total
	}
	if end > h.total {
		end = h.total
	}
	rows := make([]string, 0, end-start)
	for i := start; i < end; i++ {
		rows = append(rows, fmt.Sprintf(`{"i":%d}`, i))
	}
	_, _ = fmt.Fprintf(w,
		`{"data":[%s],"pagination":{"page":%d,"limit":%d,"total":%d}}`,
		strings.Join(rows, ","), page, limit, h.total)
}

func TestDatasetsAllRecords(t *testing.T) {
	t.Run("given a result set spanning three pages", func(t *testing.T) {
		t.Run("when iterating with a small page size", func(t *testing.T) {
			// 7 records at 3/page -> pages of 3, 3, 1 (the short page ends it).
			h := &offsetPageHandler{total: 7}
			c := newTestClient(t, h.ServeHTTP)

			var got []int
			for rec, err := range c.Datasets.AllRecords(context.Background(), "ds", ListDatasetsParams{Limit: 3}) {
				require.NoError(t, err)
				got = append(got, int(rec["i"].(float64)))
			}

			assert.Equal(t, []int{0, 1, 2, 3, 4, 5, 6}, got, "yields every record in order")
			assert.Equal(t, int32(3), atomic.LoadInt32(&h.requests), "fetches exactly three pages")
		})
	})

	t.Run("given a full last page exactly on the total boundary", func(t *testing.T) {
		t.Run("when the running count reaches Total", func(t *testing.T) {
			// 6 records at 3/page -> pages of 3, 3; the second page is full, so the
			// short-page signal never fires and Total must stop the walk.
			h := &offsetPageHandler{total: 6}
			c := newTestClient(t, h.ServeHTTP)

			var count int
			for _, err := range c.Datasets.AllRecords(context.Background(), "ds", ListDatasetsParams{Limit: 3}) {
				require.NoError(t, err)
				count++
			}

			assert.Equal(t, 6, count)
			assert.Equal(t, int32(2), atomic.LoadInt32(&h.requests),
				"Total stops the walk without a wasted third request")
		})
	})

	t.Run("given a consumer that breaks early", func(t *testing.T) {
		t.Run("when it stops after the first element", func(t *testing.T) {
			h := &offsetPageHandler{total: 100}
			c := newTestClient(t, h.ServeHTTP)

			var got []int
			for rec, err := range c.Datasets.AllRecords(context.Background(), "ds", ListDatasetsParams{Limit: 10}) {
				require.NoError(t, err)
				got = append(got, int(rec["i"].(float64)))
				break
			}

			assert.Equal(t, []int{0}, got)
			assert.Equal(t, int32(1), atomic.LoadInt32(&h.requests),
				"breaking stops further page fetches")
		})
	})

	t.Run("given the page size is left unset", func(t *testing.T) {
		t.Run("when iterating", func(t *testing.T) {
			var gotLimit string
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				gotLimit = r.URL.Query().Get("limit")
				_, _ = w.Write([]byte(`{"data":[],"pagination":{"page":1,"limit":1000,"total":0}}`))
			})

			for range c.Datasets.AllRecords(context.Background(), "ds", ListDatasetsParams{}) {
			}

			assert.Equal(t, "1000", gotLimit, "defaults the page size to the server maximum")
		})
	})

	t.Run("given a page fetch fails mid-iteration", func(t *testing.T) {
		t.Run("when the second page errors", func(t *testing.T) {
			var calls int32
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if atomic.AddInt32(&calls, 1) == 1 {
					// A full first page so the walk wants a second one.
					_, _ = w.Write([]byte(`{"data":[{"i":0},{"i":1}],"pagination":{"page":1,"limit":2,"total":10}}`))
					return
				}
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"error":"boom"}`))
			}, WithMaxRetries(0))

			// Deliberately do NOT break on the error: the iterator must stop on its
			// own after a single (zero, err) yield, not keep refetching the failing
			// page.
			var recs []map[string]any
			var errs []error
			for rec, err := range c.Datasets.AllRecords(context.Background(), "ds", ListDatasetsParams{Limit: 2}) {
				recs = append(recs, rec)
				errs = append(errs, err)
			}

			require.Len(t, errs, 3, "two records, then one error pair, then it stops on its own")
			require.NoError(t, errs[0])
			require.NoError(t, errs[1])
			require.Error(t, errs[2], "the page error is surfaced as (zero, err)")
			assert.Nil(t, recs[2], "the value paired with the error is the zero map")
			assert.True(t, hasStatus(errs[2], http.StatusInternalServerError))
		})
	})

	t.Run("given the context is cancelled between pages", func(t *testing.T) {
		t.Run("when the first page has been consumed", func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var calls int32
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				atomic.AddInt32(&calls, 1)
				// Always a full page so the walk would continue but for cancellation.
				_, _ = w.Write([]byte(`{"data":[{"i":0},{"i":1}],"pagination":{"page":1,"limit":2,"total":100}}`))
			})

			var lastErr error
			seen := 0
			for _, err := range c.Datasets.AllRecords(ctx, "ds", ListDatasetsParams{Limit: 2}) {
				if err != nil {
					lastErr = err
					break
				}
				seen++
				if seen == 2 {
					cancel() // cancel after draining the first page
				}
			}

			require.Error(t, lastErr)
			assert.ErrorIs(t, lastErr, context.Canceled)
			assert.Equal(t, int32(1), atomic.LoadInt32(&calls),
				"cancellation prevents the second page fetch")
		})
	})
}

func TestDatasetsAll(t *testing.T) {
	t.Run("given datasets spanning two pages", func(t *testing.T) {
		t.Run("when iterating", func(t *testing.T) {
			var calls int32
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				switch atomic.AddInt32(&calls, 1) {
				case 1:
					_, _ = w.Write([]byte(`{"data":[{"id":"a","slug":"a"},{"id":"b","slug":"b"}],"pagination":{"page":1,"limit":2,"total":3}}`))
				default:
					_, _ = w.Write([]byte(`{"data":[{"id":"c","slug":"c"}],"pagination":{"page":2,"limit":2,"total":3}}`))
				}
			})

			var slugs []string
			for d, err := range c.Datasets.All(context.Background(), ListDatasetsParams{Limit: 2}) {
				require.NoError(t, err)
				slugs = append(slugs, d.Slug)
			}
			assert.Equal(t, []string{"a", "b", "c"}, slugs)
			assert.Equal(t, int32(2), atomic.LoadInt32(&calls))
		})
	})
}

func TestProjectsAll(t *testing.T) {
	t.Run("given projects on a single short page", func(t *testing.T) {
		t.Run("when iterating", func(t *testing.T) {
			var calls int32
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				atomic.AddInt32(&calls, 1)
				_, _ = w.Write([]byte(`{"data":[{"id":"project_1","name":"Prod"}],"pagination":{"page":1,"limit":1000,"total":1}}`))
			})

			var ids []string
			for p, err := range c.Projects.All(context.Background(), ListProjectsParams{}) {
				require.NoError(t, err)
				require.NotNil(t, p.Id)
				ids = append(ids, *p.Id)
			}
			assert.Equal(t, []string{"project_1"}, ids)
			assert.Equal(t, int32(1), atomic.LoadInt32(&calls), "a short first page ends the walk")
		})
	})
}

func TestTracesAll(t *testing.T) {
	t.Run("given trace search results spanning three pages", func(t *testing.T) {
		t.Run("when iterating by pageOffset", func(t *testing.T) {
			var offsets []int
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/traces/search", r.URL.Path)
				var body map[string]any
				raw, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(raw, &body)
				off := int(body["pageOffset"].(float64))
				offsets = append(offsets, off)
				assert.Equal(t, float64(2), body["pageSize"], "page size is carried on every request")

				switch off {
				case 0:
					_, _ = w.Write([]byte(`{"traces":[{"trace_id":"t0"},{"trace_id":"t1"}],"pagination":{"totalHits":5}}`))
				case 2:
					_, _ = w.Write([]byte(`{"traces":[{"trace_id":"t2"},{"trace_id":"t3"}],"pagination":{"totalHits":5}}`))
				default: // offset 4: the short final page
					_, _ = w.Write([]byte(`{"traces":[{"trace_id":"t4"}],"pagination":{"totalHits":5}}`))
				}
			})

			var ids []string
			for tr, err := range c.Traces.All(context.Background(), TraceSearchParams{Query: "x", PageSize: 2}) {
				require.NoError(t, err)
				require.NotNil(t, tr.TraceId)
				ids = append(ids, *tr.TraceId)
			}

			assert.Equal(t, []string{"t0", "t1", "t2", "t3", "t4"}, ids, "yields every trace in order")
			assert.Equal(t, []int{0, 2, 4}, offsets, "advances pageOffset until a short page")
		})
	})

	t.Run("given a single full page followed by an empty one", func(t *testing.T) {
		t.Run("when the result count is an exact multiple of the page size", func(t *testing.T) {
			var calls int32
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				switch atomic.AddInt32(&calls, 1) {
				case 1:
					_, _ = w.Write([]byte(`{"traces":[{"trace_id":"t0"},{"trace_id":"t1"}],"pagination":{"totalHits":2}}`))
				default:
					_, _ = w.Write([]byte(`{"traces":[],"pagination":{"totalHits":2}}`))
				}
			})

			var ids []string
			for tr, err := range c.Traces.All(context.Background(), TraceSearchParams{PageSize: 2}) {
				require.NoError(t, err)
				ids = append(ids, *tr.TraceId)
			}
			assert.Equal(t, []string{"t0", "t1"}, ids)
			assert.Equal(t, int32(2), atomic.LoadInt32(&calls), "an empty trailing page terminates the walk")
		})
	})
}

func TestScenariosAllRuns(t *testing.T) {
	t.Run("given cursor-paginated runs across three pages", func(t *testing.T) {
		t.Run("when iterating", func(t *testing.T) {
			var cursors []string
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				cur := r.URL.Query().Get("cursor")
				cursors = append(cursors, cur)
				switch cur {
				case "":
					_, _ = w.Write([]byte(`{"runs":[{"id":"r0"}],"hasMore":true,"nextCursor":"c1"}`))
				case "c1":
					_, _ = w.Write([]byte(`{"runs":[{"id":"r1"}],"hasMore":true,"nextCursor":"c2"}`))
				default: // c2: final page
					_, _ = w.Write([]byte(`{"runs":[{"id":"r2"}],"hasMore":false,"nextCursor":""}`))
				}
			})

			var ids []string
			for run, err := range c.Scenarios.AllRuns(context.Background(), SimulationRunsParams{}) {
				require.NoError(t, err)
				ids = append(ids, run["id"].(string))
			}

			assert.Equal(t, []string{"r0", "r1", "r2"}, ids, "yields every run in order")
			assert.Equal(t, []string{"", "c1", "c2"}, cursors, "advances by NextCursor then stops")
		})
	})

	t.Run("given the server reports hasMore but omits a cursor", func(t *testing.T) {
		t.Run("when iterating", func(t *testing.T) {
			var calls int32
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				atomic.AddInt32(&calls, 1)
				// hasMore true but no cursor: there is nothing to page past.
				_, _ = w.Write([]byte(`{"runs":[{"id":"r0"}],"hasMore":true,"nextCursor":""}`))
			})

			var ids []string
			for run, err := range c.Scenarios.AllRuns(context.Background(), SimulationRunsParams{}) {
				require.NoError(t, err)
				ids = append(ids, run["id"].(string))
			}
			assert.Equal(t, []string{"r0"}, ids)
			assert.Equal(t, int32(1), atomic.LoadInt32(&calls),
				"a missing cursor stops the walk rather than refetching")
		})
	})

	t.Run("given a page fetch fails", func(t *testing.T) {
		t.Run("when the first page errors", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusBadGateway)
			}, WithMaxRetries(0))

			var lastErr error
			n := 0
			for _, err := range c.Scenarios.AllRuns(context.Background(), SimulationRunsParams{}) {
				n++
				lastErr = err
			}
			assert.Equal(t, 1, n, "exactly one (nil, err) pair is yielded")
			require.Error(t, lastErr)
			assert.True(t, hasStatus(lastErr, http.StatusBadGateway))
		})
	})
}

func TestHasNextOffsetPage(t *testing.T) {
	cases := []struct {
		name                        string
		pageLen, limit, seen, total int
		want                        bool
	}{
		{"full page, total unknown", 1000, 1000, 1000, 0, true},
		{"short page ends it", 4, 1000, 4, 0, false},
		{"empty page ends it", 0, 1000, 0, 0, false},
		{"full page but total reached", 3, 3, 6, 6, false},
		{"full page, total not yet reached", 3, 3, 3, 9, true},
		{"full page exactly at total boundary continues if seen<total", 3, 3, 3, 6, true},
	}
	for _, tc := range cases {
		t.Run("given "+tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, hasNextOffsetPage(tc.pageLen, tc.limit, tc.seen, tc.total))
		})
	}
}
