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
// the job conclusion in the newest earlier run that ran it, "" for none.
type fake struct {
	previous   string
	superseded bool // a newer run cancelled before it ran the job sits in front

	broken bool
	raw    []string
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
			runs := []map[string]any{{"id": 30}}
			if f.superseded {
				runs = append(runs, map[string]any{"id": 25})
			}
			if f.previous != "" {
				runs = append(runs, map[string]any{"id": 20})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"workflow_runs": runs})
		case r.URL.Path == "/repos/langwatch/langwatch/actions/runs/25/jobs":
			_ = json.NewEncoder(w).Encode(map[string]any{"jobs": []map[string]any{}})
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
		if !json.Valid(raw) {
			t.Errorf("Slack got a body that is not JSON: %s", raw)
		}
		f.raw = append(f.raw, string(raw))
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
			require.Len(t, f.raw, 1)
			assert.Contains(t, f.raw[0], job)
			assert.Contains(t, f.raw[0], "abcdef1")
			assert.Contains(t, f.raw[0], "/actions/runs/30")
		})
	}
}

// @scenario "A repeat failure or timeout on main posts once"
func TestARepeatFailureOrTimeoutDoesNotPostAgain(t *testing.T) {
	for _, tc := range []struct {
		previous   string
		superseded bool
	}{{"failure", false}, {"cancelled", false}, {"failure", true}} {
		name := "the job was " + tc.previous + " in the run before"
		if tc.superseded {
			name += ", behind a run cancelled before it started"
		}
		t.Run(name, func(t *testing.T) {
			previous := tc.previous
			f := &fake{previous: previous, superseded: tc.superseded}
			result, err := f.start(t).Notify(context.Background(), failing)

			require.NoError(t, err)
			assert.False(t, result.Posted)
			assert.Contains(t, result.Reason, previous)
			assert.Empty(t, f.raw)
		})
	}
}

// @scenario "A red package-suites run on main posts to Slack"
func TestAnUnreadableHistoryStillPosts(t *testing.T) {
	f := &fake{broken: true}
	result, err := f.start(t).Notify(context.Background(), failing)

	require.NoError(t, err)
	assert.True(t, result.Posted)
	assert.Len(t, f.raw, 1)
}

func TestNoWebhookPostsNothing(t *testing.T) {
	f := &fake{previous: "success"}
	n := f.start(t)
	n.Webhook = ""

	result, err := n.Notify(context.Background(), failing)

	require.NoError(t, err)
	assert.False(t, result.Posted)
	assert.Empty(t, f.raw)
}

func TestAPostErrorNeverNamesTheWebhook(t *testing.T) {
	f := &fake{previous: "success"}
	n := f.start(t)
	n.Webhook = "http://127.0.0.1:1/secret-hook-path"

	_, err := n.Notify(context.Background(), failing)

	require.Error(t, err)
	assert.NotContains(t, err.Error(), "secret-hook-path")
}

func TestACommitSubjectCannotPingTheChannel(t *testing.T) {
	f := &fake{previous: "success"}
	run := failing
	run.Subject = "fix: <!channel> & co"

	_, err := f.start(t).Notify(context.Background(), run)

	require.NoError(t, err)
	require.Len(t, f.raw, 1)
	var body struct {
		Blocks []struct {
			Text struct{ Text string } `json:"text"`
		} `json:"blocks"`
	}
	require.NoError(t, json.Unmarshal([]byte(f.raw[0]), &body))
	var texts []string
	for _, b := range body.Blocks {
		texts = append(texts, b.Text.Text)
	}
	posted := strings.Join(texts, "\n")
	assert.NotContains(t, posted, "<!channel>")
	assert.Contains(t, posted, "&lt;!channel&gt; &amp; co")
}
