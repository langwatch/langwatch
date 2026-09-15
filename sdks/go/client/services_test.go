package client

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDatasets(t *testing.T) {
	t.Run("given a paginated dataset list", func(t *testing.T) {
		t.Run("when listing", func(t *testing.T) {
			// httptest runs the handler on its own goroutine, so anything it
			// captures is written and read back under mu.
			var mu sync.Mutex
			var gotQuery string
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/v1/dataset", r.URL.Path)
				mu.Lock()
				gotQuery = r.URL.Query().Encode()
				mu.Unlock()
				_, _ = w.Write([]byte(`{"data":[{"id":"ds_1","slug":"golden","name":"Golden"}],"pagination":{"page":1,"limit":50,"total":1}}`))
			})

			items, pg, err := c.Datasets.List(context.Background(), ListDatasetsParams{Page: 1, Limit: 50})
			require.NoError(t, err)
			mu.Lock()
			defer mu.Unlock()
			assert.Contains(t, gotQuery, "page=1")
			assert.Contains(t, gotQuery, "limit=50")
			require.Len(t, items, 1)
			assert.Equal(t, "ds_1", items[0].ID)
			assert.Equal(t, "golden", items[0].Slug)
			assert.Equal(t, 1, pg.Total)
			// Free-form fields are captured too.
			assert.Equal(t, "Golden", items[0].Fields["name"])
		})
	})

	t.Run("given a dataset", func(t *testing.T) {
		t.Run("when creating records", func(t *testing.T) {
			var mu sync.Mutex
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPost, r.Method)
				assert.Equal(t, "/api/v1/dataset/golden/records", r.URL.Path)
				raw, _ := io.ReadAll(r.Body)
				mu.Lock()
				_ = json.Unmarshal(raw, &gotBody)
				mu.Unlock()
				_, _ = w.Write([]byte(`{"success":true}`))
			})
			_, err := c.Datasets.CreateRecords(context.Background(), "golden", []map[string]any{
				{"input": "hi"},
			})
			require.NoError(t, err)
			mu.Lock()
			defer mu.Unlock()
			assert.Contains(t, gotBody, "entries")
		})
	})
}

func TestTraces(t *testing.T) {
	t.Run("given a trace search", func(t *testing.T) {
		t.Run("when searching", func(t *testing.T) {
			var mu sync.Mutex
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPost, r.Method)
				assert.Equal(t, "/api/v1/traces/search", r.URL.Path)
				raw, _ := io.ReadAll(r.Body)
				mu.Lock()
				_ = json.Unmarshal(raw, &gotBody)
				mu.Unlock()
				_, _ = w.Write([]byte(`{"traces":[{"trace_id":"trace_1"}],"pagination":{"totalHits":1,"scrollId":"c1"}}`))
			})

			res, err := c.Traces.Search(context.Background(), TraceSearchParams{
				Query:   "timeout",
				Filters: map[string][]string{"metadata.user_id": {"u_1"}},
			})
			require.NoError(t, err)
			mu.Lock()
			defer mu.Unlock()
			assert.Equal(t, "timeout", gotBody["query"])
			require.Len(t, res.Traces, 1)
			assert.Equal(t, "trace_1", *res.Traces[0].TraceId)
			assert.Equal(t, "c1", res.Pagination.ScrollID,
				"the cursor reaches the caller, which is what makes a manual scroll drivable")
			assert.Equal(t, 1, res.Pagination.TotalHits)
		})
	})

	t.Run("given a trace get", func(t *testing.T) {
		t.Run("when fetching by id", func(t *testing.T) {
			var mu sync.Mutex
			var gotQuery string
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/v1/traces/trace_1", r.URL.Path)
				mu.Lock()
				gotQuery = r.URL.Query().Encode()
				mu.Unlock()
				_, _ = w.Write([]byte(`{"trace_id":"trace_1","project_id":"p1"}`))
			})
			tr, err := c.Traces.Get(context.Background(), "trace_1")
			require.NoError(t, err)
			mu.Lock()
			defer mu.Unlock()
			assert.Contains(t, gotQuery, "format=json")
			require.NotNil(t, tr.TraceId)
			assert.Equal(t, "trace_1", *tr.TraceId)
		})
	})
}

func TestAnnotations(t *testing.T) {
	t.Run("given the API wraps annotations in a data envelope", func(t *testing.T) {
		// @scenario "Listing every annotation returns the annotations"
		t.Run("when listing every annotation", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/v1/annotations", r.URL.Path)
				_, _ = w.Write([]byte(`{"data":[{"id":"ann_1"},{"id":"ann_2"}]}`))
			})
			list, err := c.Annotations.List(context.Background())
			require.NoError(t, err)
			require.Len(t, list, 2)
			assert.Equal(t, "ann_1", list[0].Id)
		})

		// @scenario "Fetching one annotation returns the annotation"
		t.Run("when fetching one annotation by id", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/v1/annotations/ann_1", r.URL.Path)
				_, _ = w.Write([]byte(`{"data":{"id":"ann_1","comment":"Great"}}`))
			})
			a, err := c.Annotations.Get(context.Background(), "ann_1")
			require.NoError(t, err)
			assert.Equal(t, "ann_1", a.Id)
		})

		// @scenario "Listing a trace's annotations returns the annotations"
		t.Run("when listing the annotations on a trace", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/v1/annotations/trace/trace_1", r.URL.Path)
				_, _ = w.Write([]byte(`{"data":[{"id":"ann_1"}]}`))
			})
			list, err := c.Annotations.ListByTrace(context.Background(), "trace_1")
			require.NoError(t, err)
			require.Len(t, list, 1)
			assert.Equal(t, "ann_1", list[0].Id)
		})

		// @scenario "Creating an annotation returns the created annotation"
		t.Run("when attaching an annotation to a trace", func(t *testing.T) {
			var mu sync.Mutex
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPost, r.Method)
				assert.Equal(t, "/api/v1/annotations/trace/trace_1", r.URL.Path)
				raw, _ := io.ReadAll(r.Body)
				mu.Lock()
				_ = json.Unmarshal(raw, &gotBody)
				mu.Unlock()
				_, _ = w.Write([]byte(`{"data":{"id":"ann_1","traceId":"trace_1","comment":"Great","isThumbsUp":true}}`))
			})

			up := true
			a, err := c.Annotations.CreateForTrace(context.Background(), "trace_1", AnnotationParams{
				Comment:    "Great",
				IsThumbsUp: &up,
			})
			require.NoError(t, err)
			mu.Lock()
			defer mu.Unlock()
			assert.Equal(t, "Great", gotBody["comment"])
			assert.Equal(t, true, gotBody["isThumbsUp"])
			assert.Equal(t, "ann_1", a.Id)
		})

		// @scenario "Updating an annotation returns the updated annotation"
		t.Run("when updating an annotation", func(t *testing.T) {
			var mu sync.Mutex
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPatch, r.Method)
				assert.Equal(t, "/api/v1/annotations/ann_1", r.URL.Path)
				raw, _ := io.ReadAll(r.Body)
				mu.Lock()
				_ = json.Unmarshal(raw, &gotBody)
				mu.Unlock()
				_, _ = w.Write([]byte(`{"data":{"id":"ann_1","comment":"Edited","isThumbsUp":false}}`))
			})

			down := false
			a, err := c.Annotations.Update(context.Background(), "ann_1", AnnotationParams{
				Comment:    "Edited",
				IsThumbsUp: &down,
			})
			require.NoError(t, err)
			mu.Lock()
			defer mu.Unlock()
			// The API requires both fields on a patch, so both must reach the wire.
			assert.Equal(t, "Edited", gotBody["comment"])
			assert.Equal(t, false, gotBody["isThumbsUp"])
			require.NotNil(t, a.Comment)
			assert.Equal(t, "Edited", *a.Comment)
		})
	})

	t.Run("given a project with no annotations", func(t *testing.T) {
		// @scenario "A project with no annotations yields an empty list"
		t.Run("when listing annotations", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodGet, r.Method)
				assert.Equal(t, "/api/v1/annotations", r.URL.Path)
				_, _ = w.Write([]byte(`{"data":[]}`))
			})
			list, err := c.Annotations.List(context.Background())
			require.NoError(t, err)
			assert.Empty(t, list)
		})
	})

	t.Run("given a server that answers without the envelope", func(t *testing.T) {
		// A 2xx in some other shape decodes cleanly, because JSON ignores keys it
		// was not asked for. Without the nil check in decodeAnnotationEnvelope
		// every one of these would hand back a zero-valued Annotation and no
		// error, which is the failure the envelope handling exists to prevent.
		// @scenario "A read that carries no annotation fails"
		t.Run("when a read returns the bare value", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{"id":"ann_1","comment":"Great"}`))
			})
			a, err := c.Annotations.Get(context.Background(), "ann_1")
			require.Error(t, err)
			assert.Nil(t, a)
			assert.Contains(t, err.Error(), "data")
		})

		// @scenario "A list that carries no annotations fails"
		t.Run("when a list returns an unrelated object", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{"annotations":[{"id":"ann_1"}]}`))
			})
			list, err := c.Annotations.List(context.Background())
			require.Error(t, err)
			assert.Nil(t, list)
		})

		// @scenario "A write answered with an empty body fails"
		t.Run("when a write returns an empty body", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			})
			up := true
			a, err := c.Annotations.CreateForTrace(context.Background(), "trace_1", AnnotationParams{
				Comment:    "Great",
				IsThumbsUp: &up,
			})
			require.Error(t, err)
			assert.Nil(t, a)
		})
	})

	t.Run("given the API rejects the request", func(t *testing.T) {
		// @scenario "A rejected read is reported as not found"
		t.Run("when the annotation does not exist", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"message":"not found"}`))
			})
			a, err := c.Annotations.Get(context.Background(), "ann_missing")
			require.Error(t, err)
			assert.Nil(t, a)
			assert.True(t, IsNotFound(err))
		})
	})
}

func TestTriggersService(t *testing.T) {
	t.Run("given triggers exist", func(t *testing.T) {
		t.Run("when listing", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/v1/triggers", r.URL.Path)
				_, _ = w.Write([]byte(`[{"id":"trig_1","name":"Alert","active":true,"action":"send_email","actionParams":{},"filters":{},"platformUrl":"https://x","createdAt":"","updatedAt":""}]`))
			})
			triggers, err := c.Triggers.List(context.Background())
			require.NoError(t, err)
			require.Len(t, triggers, 1)
			assert.Equal(t, "trig_1", triggers[0].ID)
			assert.True(t, triggers[0].Active)
			assert.Equal(t, "send_email", triggers[0].Action)
		})
	})
}

func TestMonitorsService(t *testing.T) {
	t.Run("given a monitor", func(t *testing.T) {
		t.Run("when toggling", func(t *testing.T) {
			var mu sync.Mutex
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPost, r.Method)
				assert.Equal(t, "/api/v1/monitors/mon_1/toggle", r.URL.Path)
				raw, _ := io.ReadAll(r.Body)
				mu.Lock()
				_ = json.Unmarshal(raw, &gotBody)
				mu.Unlock()
				_, _ = w.Write([]byte(`{"success":true}`))
			})
			_, err := c.Monitors.Toggle(context.Background(), "mon_1", false)
			require.NoError(t, err)
			mu.Lock()
			defer mu.Unlock()
			assert.Equal(t, false, gotBody["enabled"])
		})

		t.Run("when listing", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`[{"id":"mon_1","name":"PII","slug":"pii","enabled":true,"checkType":"pii","executionMode":"ON_MESSAGE","level":"trace","sample":1,"platformUrl":"https://x","createdAt":"","updatedAt":""}]`))
			})
			monitors, err := c.Monitors.List(context.Background())
			require.NoError(t, err)
			require.Len(t, monitors, 1)
			assert.True(t, monitors[0].Enabled)
		})
	})
}

func TestScenariosService(t *testing.T) {
	t.Run("given cursor-paginated simulation runs", func(t *testing.T) {
		t.Run("when listing runs", func(t *testing.T) {
			var mu sync.Mutex
			var gotQuery string
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/v1/simulation-runs", r.URL.Path)
				mu.Lock()
				gotQuery = r.URL.Query().Encode()
				mu.Unlock()
				_, _ = w.Write([]byte(`{"runs":[{"scenarioRunId":"sr_1"}],"hasMore":true,"nextCursor":"cur_2"}`))
			})

			page, err := c.Scenarios.ListRuns(context.Background(), SimulationRunsParams{Limit: 25, Cursor: "cur_1"})
			require.NoError(t, err)
			mu.Lock()
			defer mu.Unlock()
			assert.Contains(t, gotQuery, "limit=25")
			assert.Contains(t, gotQuery, "cursor=cur_1")
			require.Len(t, page.Runs, 1)
			assert.True(t, page.HasMore)
			assert.Equal(t, "cur_2", page.NextCursor)
		})
	})
}

func TestProjectsService(t *testing.T) {
	t.Run("given an admin-scoped key", func(t *testing.T) {
		t.Run("when listing projects", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/projects", r.URL.Path)
				_, _ = w.Write([]byte(`{"data":[{"id":"project_1","name":"Prod","slug":"prod"}],"pagination":{"page":1,"limit":10,"total":1}}`))
			})
			projects, pg, err := c.Projects.List(context.Background(), ListProjectsParams{})
			require.NoError(t, err)
			require.Len(t, projects, 1)
			require.NotNil(t, projects[0].Id)
			assert.Equal(t, "project_1", *projects[0].Id)
			assert.Equal(t, 1, pg.Total)
		})
	})
}
