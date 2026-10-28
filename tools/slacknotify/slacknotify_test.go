package slacknotify_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/slacknotify"
)

const job = "package-suites (1/1)"

var failing = slacknotify.Run{
	Repository: "langwatch/langwatch", Workflow: "langwatch-app-ci.yml", RunID: 30, Job: job,
	SHA: "abcdef1234567890", Subject: "fix: something", Author: "someone",
}

// fake serves the runs and jobs endpoints and records Slack posts. previous is
// the job conclusion in the newest earlier finished run, "" for no earlier run.
type fake struct {
	previous string
	broken   bool
	posts    []map[string]any
}

func (f *fake) start(t *testing.T) slacknotify.Notifier {
	t.Helper()
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if f.broken {
			http.Error(w, "boom", http.StatusBadGateway)
			return
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/actions/workflows/langwatch-app-ci.yml/runs"):
			q := r.URL.Query()
			assert.Equal(t, "main", q.Get("branch"))
			assert.Equal(t, "completed", q.Get("status"))
			runs := []map[string]any{}
			if f.previous != "" {
				runs = append(runs, map[string]any{"id": 20})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"workflow_runs": runs})
		case r.URL.Path == "/repos/langwatch/langwatch/actions/runs/20/jobs":
			_ = json.NewEncoder(w).Encode(map[string]any{"jobs": []map[string]any{
				{"name": "lint", "conclusion": "success"},
				{"name": job, "conclusion": f.previous},
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(gh.Close)
	slack := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("Slack got a body that is not JSON: %v", err)
		}
		f.posts = append(f.posts, body)
	}))
	t.Cleanup(slack.Close)

	return slacknotify.Notifier{API: gh.URL, Webhook: slack.URL, HTTP: http.DefaultClient}
}

// @scenario "A red package-suites run on main posts to Slack"
func TestANewRedRunPostsToSlack(t *testing.T) {
	for name, previous := range map[string]string{
		"the job passed in the run before": "success",
		"there is no earlier finished run": "",
	} {
		t.Run(name, func(t *testing.T) {
			f := &fake{previous: previous}
			result, err := f.start(t).Notify(context.Background(), failing)

			require.NoError(t, err)
			assert.True(t, result.Posted, result.Reason)
			require.Len(t, f.posts, 1)
			raw, _ := json.Marshal(f.posts[0])
			assert.Contains(t, string(raw), job)
			assert.Contains(t, string(raw), "abcdef1")
			assert.Contains(t, string(raw), "/actions/runs/30")
		})
	}
}

// @scenario "A repeat failure or timeout on main posts once"
func TestARepeatFailureOrTimeoutDoesNotPostAgain(t *testing.T) {
	for _, previous := range []string{"failure", "cancelled"} {
		t.Run("the job was "+previous+" in the run before", func(t *testing.T) {
			f := &fake{previous: previous}
			result, err := f.start(t).Notify(context.Background(), failing)

			require.NoError(t, err)
			assert.False(t, result.Posted)
			assert.Contains(t, result.Reason, previous)
			assert.Empty(t, f.posts)
		})
	}
}

// @scenario "A red package-suites run on main posts to Slack"
func TestAnUnreadableHistoryStillPosts(t *testing.T) {
	f := &fake{broken: true}
	result, err := f.start(t).Notify(context.Background(), failing)

	require.NoError(t, err)
	assert.True(t, result.Posted)
	assert.Len(t, f.posts, 1)
}

func TestNoWebhookPostsNothing(t *testing.T) {
	f := &fake{previous: "success"}
	n := f.start(t)
	n.Webhook = ""

	result, err := n.Notify(context.Background(), failing)

	require.NoError(t, err)
	assert.False(t, result.Posted)
	assert.Empty(t, f.posts)
}

func TestAPostErrorNeverNamesTheWebhook(t *testing.T) {
	f := &fake{previous: "success"}
	n := f.start(t)
	n.Webhook = "http://127.0.0.1:1/secret-hook-path"

	_, err := n.Notify(context.Background(), failing)

	require.Error(t, err)
	assert.NotContains(t, err.Error(), "secret-hook-path")
}
