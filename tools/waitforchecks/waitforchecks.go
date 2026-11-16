// Package waitforchecks blocks until every other check run on a commit has
// finished, so the PR review spends tokens only on a change the separate
// workflows (pr conventions, go-ci, code-scanners, ...) did not reject.
//
// Spec: specs/ci/pr-review-bot.feature
package waitforchecks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

const pageSize = 100

// maxBackoffShift caps the retry delay at Interval << 4.
const maxBackoffShift = 4

// Waiter polls a commit's check runs.
type Waiter struct {
	API        string // https://api.github.com
	Repository string // owner/name
	SHA        string
	Token      string
	// Exclude is the caller's own check run; waiting on it would deadlock.
	Exclude  string
	HTTP     *http.Client
	Interval time.Duration
	Timeout  time.Duration
	Log      io.Writer
}

type checkRun struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
	App        struct {
		ID int64 `json:"id"`
	} `json:"app"`
	CheckSuite struct {
		ID int64 `json:"id"`
	} `json:"check_suite"`
}

type checkRunsPage struct {
	CheckRuns []checkRun `json:"check_runs"`
}

type workflowRun struct {
	WorkflowID   int64 `json:"workflow_id"`
	CheckSuiteID int64 `json:"check_suite_id"`
}

type workflowRunsPage struct {
	WorkflowRuns []workflowRun `json:"workflow_runs"`
}

// checkKey names one check across reruns: the same app, the same workflow
// (or, when the workflow is unknown, the same check suite) and the same name.
// Names like "changes", "build" and "test" repeat across workflows, so the
// name alone would merge distinct checks and could hide a red one.
type checkKey struct {
	app      int64
	workflow int64
	suite    int64
	name     string
}

// latest keeps only the newest run (highest check run id) of each check. A
// newer run of the same workflow supersedes an older one (concurrency cancels
// it, or a re-run replaces it), so the older run must not fail the wait. A run
// whose suite is not in suiteWorkflow keys on its suite and is never merged
// with another suite's run.
func latest(runs []checkRun, suiteWorkflow map[int64]int64) []checkRun {
	newest := map[checkKey]checkRun{}
	var order []checkKey
	for _, run := range runs {
		key := checkKey{app: run.App.ID, name: run.Name}
		if workflow, ok := suiteWorkflow[run.CheckSuite.ID]; ok {
			key.workflow = workflow
		} else {
			key.suite = run.CheckSuite.ID
		}
		have, seen := newest[key]
		if !seen {
			order = append(order, key)
		}
		if !seen || run.ID > have.ID {
			newest[key] = run
		}
	}
	kept := make([]checkRun, 0, len(order))
	for _, key := range order {
		kept = append(kept, newest[key])
	}

	return kept
}

// statusError is a non-2xx answer from the API.
type statusError struct {
	Code        int
	Body        string
	RateLimited bool // Retry-After or X-RateLimit-Remaining: 0 came with it
}

// Error names the status code and the (truncated) body GitHub answered with.
func (e *statusError) Error() string {
	return fmt.Sprintf("GitHub API answered %d: %s", e.Code, e.Body)
}

// transient reports whether retrying could help: a network error, a 5xx, a 429,
// or a 403 that is a rate limit. GitHub answers rate limits with 403 as well,
// but a plain 403 (missing permission) never heals by waiting.
func transient(err error) bool {
	var status *statusError
	if !errors.As(err, &status) {
		return true
	}

	return status.Code >= 500 || status.Code == http.StatusTooManyRequests ||
		(status.Code == http.StatusForbidden && status.RateLimited)
}

// Validate reports every input Wait cannot run without, so a misconfigured job
// fails at once instead of polling until the deadline. Exclude is required:
// without it the job would wait on its own check run.
func (w Waiter) Validate() error {
	var missing []string
	if w.Repository == "" {
		missing = append(missing, "GITHUB_REPOSITORY")
	}
	if w.SHA == "" {
		missing = append(missing, "SHA")
	}
	if w.Token == "" {
		missing = append(missing, "GH_TOKEN")
	}
	if w.Exclude == "" {
		missing = append(missing, "EXCLUDE_CHECK")
	}
	if len(missing) == 0 {
		return nil
	}

	return fmt.Errorf("missing required input: %s", strings.Join(missing, ", "))
}

// summary is one poll's reading of the check runs.
type summary struct {
	total   int
	pending []string
	failed  []string
}

func summarize(runs []checkRun) summary {
	s := summary{total: len(runs)}
	for _, run := range runs {
		switch {
		case run.Status != "completed":
			s.pending = append(s.pending, run.Name)
		case run.Conclusion != "success" && run.Conclusion != "skipped" && run.Conclusion != "neutral":
			s.failed = append(s.failed, run.Name+" ("+run.Conclusion+")")
		}
	}
	sort.Strings(s.pending)
	sort.Strings(s.failed)

	return s
}

// Wait returns nil once no check is pending and none failed. It fails fast
// naming the failed checks, and at the deadline naming the pending ones. API
// errors that may pass are retried with backoff until the deadline.
func (w Waiter) Wait(ctx context.Context) error {
	if err := w.Validate(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, w.Timeout)
	defer cancel()

	p := &pollState{}
	for {
		delay, done, verdict := w.poll(ctx, p)
		if done {
			return verdict
		}

		select {
		case <-ctx.Done():
			return timeoutError(w.Timeout, p.last, p.lastErr)
		case <-time.After(delay):
		}
	}
}

// pollState is what Wait remembers between polls.
type pollState struct {
	last     summary
	lastErr  error
	failures int
}

// poll reads the check runs once and returns how long to sleep before the
// next read, or the final verdict.
func (w Waiter) poll(ctx context.Context, p *pollState) (delay time.Duration, done bool, verdict error) {
	runs, err := w.current(ctx)
	if err == nil {
		p.failures = 0
		p.lastErr = nil // a recovered error must not be blamed at the deadline
		p.last = summarize(runs)
		done, verdict = w.judge(p.last)

		return w.Interval, done, verdict
	}
	if ctx.Err() != nil {
		// The deadline cancelled the request: keep the last real answer for the report.
		return 0, false, nil //nolint:nilerr // deadline cancel is not a failure; the report keeps the last real answer
	}
	if !transient(err) {
		return 0, true, err
	}
	p.lastErr = err
	p.failures++
	delay = w.Interval << min(p.failures, maxBackoffShift)
	fmt.Fprintf(w.Log, "waitforchecks: %v; retrying in %s\n", err, delay)

	return delay, false, nil
}

// judge logs the poll and decides whether it is final.
func (w Waiter) judge(s summary) (bool, error) {
	fmt.Fprintf(w.Log, "waitforchecks: %d checks, %d pending, %d failed; pending: %s\n",
		s.total, len(s.pending), len(s.failed), strings.Join(s.pending, ", "))
	if len(s.failed) > 0 {
		return true, fmt.Errorf("another check failed: %s; fix it and push", strings.Join(s.failed, ", "))
	}

	return len(s.pending) == 0, nil
}

func timeoutError(timeout time.Duration, last summary, lastErr error) error {
	msg := fmt.Sprintf("checks were still running after %s", timeout)
	if len(last.pending) > 0 {
		msg += ": " + strings.Join(last.pending, ", ")
	}
	if lastErr != nil {
		msg += fmt.Sprintf(" (last API error: %v)", lastErr)
	}

	return errors.New(msg)
}

// current reads the commit's check runs and keeps the newest run of each check.
func (w Waiter) current(ctx context.Context) ([]checkRun, error) {
	runs, err := w.list(ctx)
	if err != nil || len(runs) == 0 {
		return runs, err
	}
	suiteWorkflow, err := w.workflows(ctx)
	if err != nil {
		return nil, err
	}

	return latest(runs, suiteWorkflow), nil
}

// workflows reads every page of the commit's workflow runs and maps each
// check suite to its workflow.
func (w Waiter) workflows(ctx context.Context) (map[int64]int64, error) {
	suiteWorkflow := map[int64]int64{}
	for page := 1; ; page++ {
		var got workflowRunsPage
		endpoint := fmt.Sprintf("%s/repos/%s/actions/runs?head_sha=%s&per_page=%d&page=%d",
			w.API, w.Repository, url.QueryEscape(w.SHA), pageSize, page)
		if err := w.get(ctx, endpoint, &got); err != nil {
			return nil, err
		}
		for _, run := range got.WorkflowRuns {
			suiteWorkflow[run.CheckSuiteID] = run.WorkflowID
		}
		if len(got.WorkflowRuns) < pageSize {
			return suiteWorkflow, nil
		}
	}
}

// list reads every page of the commit's check runs, minus Exclude.
func (w Waiter) list(ctx context.Context) ([]checkRun, error) {
	var runs []checkRun
	for page := 1; ; page++ {
		got, err := w.fetch(ctx, page)
		if err != nil {
			return nil, err
		}
		for _, run := range got.CheckRuns {
			if run.Name != w.Exclude {
				runs = append(runs, run)
			}
		}
		if len(got.CheckRuns) < pageSize {
			return runs, nil
		}
	}
}

func (w Waiter) fetch(ctx context.Context, page int) (checkRunsPage, error) {
	var got checkRunsPage
	endpoint := fmt.Sprintf("%s/repos/%s/commits/%s/check-runs?per_page=%d&page=%d",
		w.API, w.Repository, url.PathEscape(w.SHA), pageSize, page)
	err := w.get(ctx, endpoint, &got)

	return got, err
}

// get reads one GitHub API page into into.
func (w Waiter) get(ctx context.Context, endpoint string, into any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+w.Token)

	resp, err := w.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))

		return &statusError{
			Code:        resp.StatusCode,
			Body:        strings.TrimSpace(string(body)),
			RateLimited: resp.Header.Get("Retry-After") != "" || resp.Header.Get("X-RateLimit-Remaining") == "0",
		}
	}

	return json.NewDecoder(resp.Body).Decode(into)
}
