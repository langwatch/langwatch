// Package slacknotify posts a CI job's failure on main to Slack, once: a job
// that was already red in the previous finished run on main posts nothing.
// Spec: specs/ci/package-suite-integration-lane.feature.
package slacknotify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Run is the failing run and job.
type Run struct {
	Repository string // owner/name
	Workflow   string // workflow file name, e.g. langwatch-app-ci.yml
	RunID      int64
	Job        string // the job's display name
	SHA        string
	Subject    string // the commit's first line
	Author     string
}

// Notifier reads the previous run from GitHub and posts to Slack.
type Notifier struct {
	API     string // https://api.github.com
	Token   string
	Webhook string
	HTTP    *http.Client
}

// Result says what Notify did and why.
type Result struct {
	Posted bool
	Reason string
}

// Notify posts unless the same job was red in the last finished main run that ran it.
// A failed lookup posts anyway: a duplicate alert beats a silent red main.
func (n Notifier) Notify(ctx context.Context, run Run) (Result, error) {
	if n.Webhook == "" {
		return Result{Reason: "no webhook set"}, nil
	}
	repeat, why := n.wasRed(ctx, run)
	if repeat {
		return Result{Reason: why}, nil
	}
	if err := n.post(ctx, run); err != nil {
		return Result{}, err
	}

	return Result{Posted: true, Reason: why}, nil
}

type runsPage struct {
	Runs []struct {
		ID int64 `json:"id"`
	} `json:"workflow_runs"`
}

type jobsPage struct {
	Jobs []struct {
		Name       string `json:"name"`
		Conclusion string `json:"conclusion"`
	} `json:"jobs"`
}

// wasRed reports whether run.Job failed or was cancelled (a timeout) in the
// newest earlier finished run on main that ran the job. A run cancelled before
// it started holds no such job, so it is passed over rather than read as green.
func (n Notifier) wasRed(ctx context.Context, run Run) (bool, string) {
	var runs runsPage
	q := url.Values{"branch": {"main"}, "event": {"push"}, "status": {"completed"}, "per_page": {"10"}}
	path := fmt.Sprintf("/repos/%s/actions/workflows/%s/runs?%s", run.Repository, url.PathEscape(run.Workflow), q.Encode())
	if err := n.get(ctx, path, &runs); err != nil {
		return false, "could not read earlier runs, posting: " + err.Error()
	}
	for _, r := range runs.Runs {
		if r.ID == run.RunID {
			continue
		}
		conclusion, ran, err := n.jobConclusion(ctx, run, r.ID)
		if err != nil {
			return false, "could not read run " + strconv.FormatInt(r.ID, 10) + ", posting: " + err.Error()
		}
		if ran {
			return verdict(run.Job, conclusion, r.ID)
		}
	}

	return false, "no earlier finished run on main ran " + run.Job
}

func verdict(job, conclusion string, id int64) (bool, string) {
	if conclusion == "failure" || conclusion == "cancelled" {
		return true, fmt.Sprintf("%s was already %s in run %d", job, conclusion, id)
	}

	return false, fmt.Sprintf("%s was not red in run %d", job, id)
}

// jobConclusion is run.Job's conclusion in the given run, and whether it ran there.
func (n Notifier) jobConclusion(ctx context.Context, run Run, id int64) (string, bool, error) {
	var jobs jobsPage
	if err := n.get(ctx, fmt.Sprintf("/repos/%s/actions/runs/%d/jobs?filter=latest&per_page=100", run.Repository, id), &jobs); err != nil {
		return "", false, err
	}
	for _, j := range jobs.Jobs {
		if j.Name == run.Job {
			return j.Conclusion, true, nil
		}
	}

	return "", false, nil
}

func (n Notifier) get(ctx context.Context, path string, into any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, n.API+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if n.Token != "" {
		req.Header.Set("Authorization", "Bearer "+n.Token)
	}
	resp, err := n.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: %s", path, resp.Status)
	}

	return json.NewDecoder(resp.Body).Decode(into)
}

// mrkdwn escapes Slack's control characters, so a commit subject holding
// <!channel> reads as text rather than pinging the channel.
var mrkdwn = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")

// message is the Slack payload: a header, the job, commit and author, and a button to the run.
func message(run Run) map[string]any {
	short := run.SHA
	if len(short) > 7 {
		short = short[:7]
	}
	runURL := fmt.Sprintf("https://github.com/%s/actions/runs/%d", run.Repository, run.RunID)
	text := fmt.Sprintf("*Job:* %s\n*Commit:* %#q - %s\n*Author:* %s", run.Job, short, mrkdwn.Replace(run.Subject), mrkdwn.Replace(run.Author))

	return map[string]any{"blocks": []any{
		map[string]any{"type": "header", "text": map[string]any{"type": "plain_text", "text": "🚨 CI Job Failed on main", "emoji": true}},
		map[string]any{"type": "section", "text": map[string]any{"type": "mrkdwn", "text": text}},
		map[string]any{"type": "actions", "elements": []any{map[string]any{
			"type": "button", "text": map[string]any{"type": "plain_text", "text": "View Run", "emoji": true}, "url": runURL,
		}}},
	}}
}

func (n Notifier) post(ctx context.Context, run Run) error {
	body, err := json.Marshal(message(run))
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.Webhook, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.HTTP.Do(req)
	if err != nil {
		// A *url.Error names the URL, and the webhook URL is the secret.
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			err = urlErr.Err
		}
		return fmt.Errorf("post to Slack: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("post to Slack: %s: %s", resp.Status, detail)
	}

	return nil
}
