package slacknotify_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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

	// legs are this run attempt's jobs by name and conclusion; nil fails the lookup.
	legs map[string]string
	// refuse is a leg name whose post Slack rejects.
	refuse string
	// slow delays every GitHub read, to use up the caller's deadline.
	slow time.Duration
}

func (f *fake) start(t *testing.T) slacknotify.Notifier {
	t.Helper()
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(f.slow):
		case <-r.Context().Done():
			return
		}
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
		case r.URL.Path == "/repos/langwatch/langwatch/actions/runs/30/attempts/2/jobs" && f.legs != nil:
			var jobs []map[string]any
			for name, conclusion := range f.legs {
				jobs = append(jobs, map[string]any{"name": name, "conclusion": conclusion})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"jobs": jobs})
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
		if f.refuse != "" && strings.Contains(string(raw), f.refuse) {
			http.Error(w, "no", http.StatusInternalServerError)
			return
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

var legs = slacknotify.Legs{Attempt: 2, Prefix: "package-suites (", Fallback: job}

// posted is the leg each Slack post names, in post order.
func (f *fake) posted() []string {
	var names []string
	for _, raw := range f.raw {
		for _, name := range []string{job, "package-suites (browser)", "package-suites (2/8)"} {
			if strings.Contains(raw, "*Job:* "+name+"\\n") {
				names = append(names, name)
			}
		}
	}

	return names
}

// @scenario "A red main posts once per red package-suites leg"
func TestARedMainPostsOncePerRedLeg(t *testing.T) {
	for name, tc := range map[string]struct {
		legs map[string]string
		want []string
	}{
		"two red legs post once each": {
			legs: map[string]string{job: "failure", "package-suites (browser)": "cancelled", "lint": "failure"},
			want: []string{job, "package-suites (browser)"},
		},
		"only the red one of two legs posts": {
			legs: map[string]string{job: "success", "package-suites (browser)": "failure"},
			want: []string{"package-suites (browser)"},
		},
		"a failed jobs lookup posts as the fallback leg": {
			legs: nil,
			want: []string{job},
		},
		"no red leg posts as the fallback leg": {
			legs: map[string]string{job: "success", "lint": "failure"},
			want: []string{job},
		},
	} {
		t.Run(name, func(t *testing.T) {
			f := &fake{legs: tc.legs}
			results, err := f.start(t).NotifyRedLegs(context.Background(), failing, legs)

			require.NoError(t, err)
			assert.ElementsMatch(t, tc.want, f.posted())
			require.Len(t, results, len(tc.want))
			for _, result := range results {
				assert.True(t, result.Posted, result.Reason)
				assert.Contains(t, tc.want, result.Job)
			}
		})
	}
}

// @scenario "A red main posts once per red package-suites leg"
func TestOneRejectedPostStillPostsTheOtherLegs(t *testing.T) {
	f := &fake{
		legs:   map[string]string{job: "failure", "package-suites (browser)": "failure", "package-suites (2/8)": "failure"},
		refuse: "package-suites (browser)",
	}

	_, err := f.start(t).NotifyRedLegs(context.Background(), failing, legs)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "package-suites (browser)")
	assert.ElementsMatch(t, []string{job, "package-suites (2/8)"}, f.posted())
}

// @scenario "A red main posts once per red package-suites leg"
func TestAFailedLegLookupStillPostsAndSaysWhy(t *testing.T) {
	for name, attempt := range map[string]int64{"a jobs lookup that fails": 2, "no run attempt": 0} {
		t.Run(name, func(t *testing.T) {
			f := &fake{}
			noAttempt := legs
			noAttempt.Attempt = attempt
			results, err := f.start(t).NotifyRedLegs(context.Background(), failing, noAttempt)

			require.NoError(t, err)
			assert.Equal(t, []string{job}, f.posted())
			require.Len(t, results, 1)
			assert.Contains(t, results[0].Reason, "jobs lookup failed")
		})
	}
}

// @scenario "A red main posts once per red package-suites leg"
func TestWithNoWebhookAFailedLegLookupStillSaysWhy(t *testing.T) {
	n := (&fake{}).start(t)
	n.Webhook = ""
	results, err := n.NotifyRedLegs(context.Background(), failing, legs)

	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Contains(t, results[0].Reason, "no webhook set")
	assert.Contains(t, results[0].Reason, "jobs lookup failed")
}

// @scenario "A red main posts once per red package-suites leg"
func TestAFailedLegLookupPostsTheFallbackEvenIfItWasRedBefore(t *testing.T) {
	f := &fake{previous: "failure"}

	results, err := f.start(t).NotifyRedLegs(context.Background(), failing, legs)

	require.NoError(t, err)
	assert.Equal(t, []string{job}, f.posted())
	require.Len(t, results, 1)
	assert.True(t, results[0].Posted, results[0].Reason)
}

// @scenario "A red main posts once per red package-suites leg"
func TestAFailedFallbackPostNamesTheFailedLookup(t *testing.T) {
	f := &fake{refuse: job}

	_, err := f.start(t).NotifyRedLegs(context.Background(), failing, legs)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "jobs lookup failed")
}

// @scenario "A red package-suites run on main posts to Slack"
func TestALookupThatUsesUpTheDeadlineStillPosts(t *testing.T) {
	f := &fake{previous: "success", slow: 200 * time.Millisecond}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	result, err := f.start(t).Notify(ctx, failing)

	require.NoError(t, err)
	assert.True(t, result.Posted, result.Reason)
	require.Len(t, f.raw, 1)
}

// @scenario "A red main posts once per red package-suites leg"
func TestAModeNeedsOneJobOrAPrefixWithAFallback(t *testing.T) {
	for name, tc := range map[string]struct {
		mode slacknotify.Mode
		ok   bool
	}{
		"one job":                     {slacknotify.Mode{Job: "typecheck"}, true},
		"a prefix with a fallback":    {slacknotify.Mode{Legs: slacknotify.Legs{Prefix: "package-suites (", Fallback: job}}, true},
		"nothing":                     {slacknotify.Mode{}, false},
		"a job and a prefix":          {slacknotify.Mode{Job: "typecheck", Legs: slacknotify.Legs{Prefix: "package-suites (", Fallback: job}}, false},
		"a prefix without a fallback": {slacknotify.Mode{Legs: slacknotify.Legs{Prefix: "package-suites ("}}, false},
		"a fallback without a prefix": {slacknotify.Mode{Job: "typecheck", Legs: slacknotify.Legs{Fallback: job}}, false},
	} {
		t.Run(name, func(t *testing.T) {
			err := tc.mode.Check()
			if tc.ok {
				assert.NoError(t, err)
			} else {
				assert.Error(t, err)
			}
		})
	}
}

// @scenario "A red main posts once per red package-suites leg"
func TestNotifyModePostsOneJobOrEachRedLeg(t *testing.T) {
	one := &fake{previous: "success"}
	results, err := one.start(t).NotifyMode(context.Background(), failing, slacknotify.Mode{Job: job})
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, []string{job}, one.posted())

	red := &fake{legs: map[string]string{job: "failure", "package-suites (browser)": "failure"}}
	results, err = red.start(t).NotifyMode(context.Background(), failing, slacknotify.Mode{Legs: slacknotify.Legs{Prefix: legs.Prefix, Fallback: job, Attempt: 2}})
	require.NoError(t, err)
	require.Len(t, results, 2)
	assert.ElementsMatch(t, []string{job, "package-suites (browser)"}, red.posted())

	_, err = red.start(t).NotifyMode(context.Background(), failing, slacknotify.Mode{})
	assert.Error(t, err)
}
