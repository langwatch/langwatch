package client

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDatasets(t *testing.T) {
	t.Run("given a paginated dataset list", func(t *testing.T) {
		t.Run("when listing", func(t *testing.T) {
			var gotQuery string
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/dataset", r.URL.Path)
				gotQuery = r.URL.Query().Encode()
				_, _ = w.Write([]byte(`{"data":[{"id":"ds_1","slug":"golden","name":"Golden"}],"pagination":{"page":1,"limit":50,"total":1}}`))
			})

			items, pg, err := c.Datasets.List(context.Background(), ListDatasetsParams{Page: 1, Limit: 50})
			require.NoError(t, err)
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
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPost, r.Method)
				assert.Equal(t, "/api/dataset/golden/records", r.URL.Path)
				raw, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(raw, &gotBody)
				_, _ = w.Write([]byte(`{"success":true}`))
			})
			_, err := c.Datasets.CreateRecords(context.Background(), "golden", []map[string]any{
				{"input": "hi"},
			})
			require.NoError(t, err)
			assert.Contains(t, gotBody, "entries")
		})
	})
}

func TestTraces(t *testing.T) {
	t.Run("given a trace search", func(t *testing.T) {
		t.Run("when searching", func(t *testing.T) {
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPost, r.Method)
				assert.Equal(t, "/api/traces/search", r.URL.Path)
				raw, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(raw, &gotBody)
				_, _ = w.Write([]byte(`{"traces":[{"trace_id":"trace_1"}],"pagination":{"page":1,"limit":10,"total":1}}`))
			})

			res, err := c.Traces.Search(context.Background(), TraceSearchParams{
				Query:   "timeout",
				Filters: map[string][]string{"metadata.user_id": {"u_1"}},
			})
			require.NoError(t, err)
			assert.Equal(t, "timeout", gotBody["query"])
			require.NotNil(t, res.Traces)
			require.Len(t, *res.Traces, 1)
			assert.Equal(t, "trace_1", *(*res.Traces)[0].TraceId)
		})
	})

	t.Run("given a trace get", func(t *testing.T) {
		t.Run("when fetching by id", func(t *testing.T) {
			var gotQuery string
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/traces/trace_1", r.URL.Path)
				gotQuery = r.URL.Query().Encode()
				_, _ = w.Write([]byte(`{"trace_id":"trace_1","project_id":"p1"}`))
			})
			tr, err := c.Traces.Get(context.Background(), "trace_1")
			require.NoError(t, err)
			assert.Contains(t, gotQuery, "format=json")
			require.NotNil(t, tr.TraceId)
			assert.Equal(t, "trace_1", *tr.TraceId)
		})
	})
}

func TestAnnotations(t *testing.T) {
	t.Run("given a trace", func(t *testing.T) {
		t.Run("when creating an annotation", func(t *testing.T) {
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPost, r.Method)
				assert.Equal(t, "/api/annotations/trace/trace_1", r.URL.Path)
				raw, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(raw, &gotBody)
				_, _ = w.Write([]byte(`{"id":"ann_1","traceId":"trace_1","comment":"Great","isThumbsUp":true}`))
			})

			up := true
			a, err := c.Annotations.CreateForTrace(context.Background(), "trace_1", AnnotationParams{
				Comment:    "Great",
				IsThumbsUp: &up,
			})
			require.NoError(t, err)
			assert.Equal(t, "Great", gotBody["comment"])
			assert.Equal(t, true, gotBody["isThumbsUp"])
			require.NotNil(t, a.Id)
			assert.Equal(t, "ann_1", *a.Id)
		})

		t.Run("when listing by trace", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/annotations/trace/trace_1", r.URL.Path)
				_, _ = w.Write([]byte(`[{"id":"ann_1"}]`))
			})
			list, err := c.Annotations.ListByTrace(context.Background(), "trace_1")
			require.NoError(t, err)
			require.Len(t, list, 1)
		})
	})
}

func TestTriggersService(t *testing.T) {
	t.Run("given triggers exist", func(t *testing.T) {
		t.Run("when listing", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/triggers", r.URL.Path)
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
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPost, r.Method)
				assert.Equal(t, "/api/monitors/mon_1/toggle", r.URL.Path)
				raw, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(raw, &gotBody)
				_, _ = w.Write([]byte(`{"success":true}`))
			})
			_, err := c.Monitors.Toggle(context.Background(), "mon_1", false)
			require.NoError(t, err)
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
			var gotQuery string
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/simulation-runs", r.URL.Path)
				gotQuery = r.URL.Query().Encode()
				_, _ = w.Write([]byte(`{"runs":[{"scenarioRunId":"sr_1"}],"hasMore":true,"nextCursor":"cur_2"}`))
			})

			page, err := c.Scenarios.ListRuns(context.Background(), SimulationRunsParams{Limit: 25, Cursor: "cur_1"})
			require.NoError(t, err)
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
