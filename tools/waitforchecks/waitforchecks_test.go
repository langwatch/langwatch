package waitforchecks_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/waitforchecks"
)

type run = map[string]any

// fakeAPI answers each request with the next scripted response; the last one
// repeats. A response is a status code and, for 200, the check runs.
type fakeAPI struct {
	mu        sync.Mutex
	responses []response
	calls     int
	// errHeaders ride on every non-200 answer (Retry-After, X-RateLimit-Remaining).
	errHeaders map[string]string
	// workflowRuns are the /actions/runs pages, served in order (the last
	// repeats); none means no workflow runs. They do not count in calls.
	workflowRuns  [][]run
	workflowCalls int
	// rules are the branch's required status check names; statuses the
	// commit statuses (context and state). Neither counts in calls.
	rules    []string
	statuses []run
}

type response struct {
	status int
	runs   []run
}

func (f *fakeAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.Contains(r.URL.Path, "/rules/branches/") {
		checks := make([]run, 0, len(f.rules))
		for _, name := range f.rules {
			checks = append(checks, run{"context": name})
		}
		_ = json.NewEncoder(w).Encode([]run{
			{"type": "pull_request"},
			{"type": "required_status_checks", "parameters": run{"required_status_checks": checks}},
		})

		return
	}
	if strings.HasSuffix(r.URL.Path, "/status") {
		_ = json.NewEncoder(w).Encode(map[string]any{"statuses": f.statuses})

		return
	}
	if strings.HasSuffix(r.URL.Path, "/actions/runs") {
		f.mu.Lock()
		var page []run
		if len(f.workflowRuns) > 0 {
			page = f.workflowRuns[min(f.workflowCalls, len(f.workflowRuns)-1)]
		}
		f.workflowCalls++
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"total_count": len(page), "workflow_runs": page})

		return
	}
	f.mu.Lock()
	idx := min(f.calls, len(f.responses)-1)
	f.calls++
	f.mu.Unlock()

	resp := f.responses[idx]
	if resp.status != http.StatusOK {
		for k, v := range f.errHeaders {
			w.Header().Set(k, v)
		}
		http.Error(w, "boom", resp.status)

		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"total_count": len(resp.runs), "check_runs": resp.runs})
}

func waiter(t *testing.T, api *fakeAPI, timeout time.Duration) waitforchecks.Waiter {
	t.Helper()
	server := httptest.NewServer(api)
	t.Cleanup(server.Close)

	return waitforchecks.Waiter{
		API: server.URL, Repository: "o/r", SHA: "abc", Token: "t", Exclude: "review",
		HTTP: server.Client(), Interval: time.Millisecond, Timeout: timeout, Log: io.Discard,
	}
}

func ok(name string) run      { return run{"name": name, "status": "completed", "conclusion": "success"} }
func pending(name string) run { return run{"name": name, "status": "in_progress"} }
func failed(name string) run {
	return run{"name": name, "status": "completed", "conclusion": "failure"}
}
func cancelled(name string) run {
	return run{"name": name, "status": "completed", "conclusion": "cancelled"}
}

// in places a check run in a GitHub Actions check suite, with its run id.
func in(r run, id, suite int64) run {
	r["id"] = id
	r["app"] = map[string]any{"id": 15368}
	r["check_suite"] = map[string]any{"id": suite}

	return r
}

func workflowRun(workflow, suite int64) run {
	return run{"workflow_id": workflow, "check_suite_id": suite}
}

// @scenario "The review waits for every required check on the head commit"
func TestWaitProceedsWhenEveryCheckPassed(t *testing.T) {
	skipped := run{"name": "s", "status": "completed", "conclusion": "skipped"}
	api := &fakeAPI{responses: []response{{200, []run{ok("a"), skipped}}}}

	require.NoError(t, waiter(t, api, time.Second).Wait(context.Background()))
}

// @scenario "The review waits for every required check on the head commit"
func TestWaitKeepsPollingWhileACheckIsPending(t *testing.T) {
	api := &fakeAPI{responses: []response{
		{200, []run{ok("a"), pending("b")}},
		{200, []run{ok("a"), ok("b")}},
	}}

	require.NoError(t, waiter(t, api, time.Second).Wait(context.Background()))
	assert.Equal(t, 2, api.calls)
}

// @scenario "A failed required check fails the review job"
func TestWaitFailsNamingTheFailedCheck(t *testing.T) {
	api := &fakeAPI{responses: []response{{200, []run{ok("a"), failed("go-ci"), pending("b")}}}}

	err := waiter(t, api, time.Second).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "another check failed: go-ci (failure); fix it and push")
}

// @scenario "The review waits for every required check on the head commit"
func TestWaitTimeoutNamesThePendingChecks(t *testing.T) {
	api := &fakeAPI{responses: []response{{200, []run{ok("a"), pending("slow-one")}}}}

	err := waiter(t, api, 300*time.Millisecond).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "still running")
	assert.Contains(t, err.Error(), "slow-one")
}

// @scenario "The review waits for every required check on the head commit"
func TestWaitRetriesATransientAPIError(t *testing.T) {
	api := &fakeAPI{responses: []response{
		{status: http.StatusBadGateway},
		{status: http.StatusTooManyRequests},
		{200, []run{ok("a")}},
	}}

	require.NoError(t, waiter(t, api, time.Second).Wait(context.Background()))
	assert.Equal(t, 3, api.calls)
}

func TestWaitFailsAtOnceOnANonTransientAPIError(t *testing.T) {
	api := &fakeAPI{responses: []response{{status: http.StatusUnauthorized}}}

	err := waiter(t, api, time.Second).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "401")
	assert.Equal(t, 1, api.calls)
}

func TestWaitFailsWhenAPIErrorsPersistPastTheDeadline(t *testing.T) {
	api := &fakeAPI{responses: []response{{status: http.StatusInternalServerError}}}

	err := waiter(t, api, 300*time.Millisecond).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "500")
}

// @scenario "The review waits for every required check on the head commit"
func TestWaitExcludesTheReviewJobsOwnCheck(t *testing.T) {
	api := &fakeAPI{responses: []response{{200, []run{ok("a"), pending("review")}}}}

	require.NoError(t, waiter(t, api, time.Second).Wait(context.Background()))
}

// A full first page means more may follow; a failure only on page 2 must show.
// @scenario "A failed required check fails the review job"
func TestWaitReadsEveryPageOfCheckRuns(t *testing.T) {
	full := make([]run, 100)
	for i := range full {
		full[i] = ok(fmt.Sprintf("check-%d", i))
	}
	api := &fakeAPI{responses: []response{{200, full}, {200, []run{failed("late-check")}}}}

	err := waiter(t, api, time.Second).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "late-check (failure)")
	assert.Equal(t, 2, api.calls)
}

// @scenario "The review waits for every required check on the head commit"
func TestWaitRetriesAForbiddenThatIsARateLimit(t *testing.T) {
	for name, headers := range map[string]map[string]string{
		"retry-after": {"Retry-After": "1"},
		"remaining 0": {"X-RateLimit-Remaining": "0"},
	} {
		t.Run(name, func(t *testing.T) {
			api := &fakeAPI{
				responses:  []response{{status: http.StatusForbidden}, {200, []run{ok("a")}}},
				errHeaders: headers,
			}

			require.NoError(t, waiter(t, api, time.Second).Wait(context.Background()))
			assert.Equal(t, 2, api.calls)
		})
	}
}

func TestWaitFailsAtOnceOnAPlainForbidden(t *testing.T) {
	api := &fakeAPI{responses: []response{{status: http.StatusForbidden}}}

	err := waiter(t, api, time.Second).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "403")
	assert.Equal(t, 1, api.calls)
}

func TestWaitTimeoutDoesNotBlameAnErrorThatRecovered(t *testing.T) {
	api := &fakeAPI{responses: []response{
		{status: http.StatusBadGateway},
		{200, []run{pending("slow-one")}},
	}}

	err := waiter(t, api, 300*time.Millisecond).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "slow-one")
	assert.NotContains(t, err.Error(), "502")
}

func TestWaitRefusesToStartWithoutEveryInput(t *testing.T) {
	cases := map[string]func(*waitforchecks.Waiter){
		"GITHUB_REPOSITORY": func(w *waitforchecks.Waiter) { w.Repository = "" },
		"SHA":               func(w *waitforchecks.Waiter) { w.SHA = "" },
		"GH_TOKEN":          func(w *waitforchecks.Waiter) { w.Token = "" },
		"EXCLUDE_CHECK":     func(w *waitforchecks.Waiter) { w.Exclude = "" },
	}
	for name, blank := range cases {
		t.Run(name, func(t *testing.T) {
			api := &fakeAPI{responses: []response{{200, []run{ok("a")}}}}
			w := waiter(t, api, time.Second)
			blank(&w)

			err := w.Wait(context.Background())

			require.Error(t, err)
			assert.Contains(t, err.Error(), name)
			assert.Zero(t, api.calls)
		})
	}
}

// The f352a9d0bc8 shape: one workflow ran twice and its first run was cancelled.
// @scenario "A check that ran twice counts only its newest run"
func TestWaitIgnoresASupersededRunOfTheSameWorkflow(t *testing.T) {
	api := &fakeAPI{
		responses: []response{{200, []run{
			in(cancelled("pr conventions"), 1, 10),
			in(ok("pr conventions"), 2, 11),
		}}},
		workflowRuns: [][]run{{workflowRun(7, 10), workflowRun(7, 11)}},
	}

	require.NoError(t, waiter(t, api, time.Second).Wait(context.Background()))
}

// @scenario "A cancelled check that a newer run of its workflow renamed does not block the review"
func TestWaitIgnoresACancelledCheckFromASupersededRunUnderAnotherName(t *testing.T) {
	api := &fakeAPI{
		responses: []response{{200, []run{
			in(cancelled("app / test-unit"), 1, 10),
			in(ok("app / test-unit (worker)"), 2, 11),
			in(ok("app / test-unit (ui)"), 3, 11),
		}}},
		workflowRuns: [][]run{{workflowRun(7, 10), workflowRun(7, 11)}},
	}

	require.NoError(t, waiter(t, api, time.Second).Wait(context.Background()))
}

// @scenario "A failed check from an older run of the workflow still blocks the review"
func TestWaitKeepsAFailedCheckFromAnOlderRunOfTheWorkflow(t *testing.T) {
	api := &fakeAPI{
		responses: []response{{200, []run{
			in(failed("lint"), 1, 10),
			in(ok("app / test-unit (worker)"), 2, 11),
		}}},
		workflowRuns: [][]run{{workflowRun(7, 10), workflowRun(7, 11)}},
	}

	err := waiter(t, api, time.Second).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "lint (failure)")
}

// @scenario "Same-named checks from different workflows are counted separately"
func TestWaitKeepsSameNamedChecksFromDifferentWorkflows(t *testing.T) {
	api := &fakeAPI{
		responses: []response{{200, []run{
			in(failed("test"), 1, 10),
			in(ok("test"), 2, 11),
		}}},
		workflowRuns: [][]run{{workflowRun(7, 10), workflowRun(8, 11)}},
	}

	err := waiter(t, api, time.Second).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "test (failure)")
}

// @scenario "A check whose workflow run is unknown is never merged with another"
func TestWaitKeysACheckWithAnUnknownSuiteOnItsSuite(t *testing.T) {
	api := &fakeAPI{
		responses: []response{{200, []run{
			in(failed("lint"), 1, 10),
			in(ok("lint"), 2, 11),
		}}},
		// Neither suite is in the workflow runs, so both fall back to their suite.
		workflowRuns: [][]run{{workflowRun(7, 99)}},
	}

	err := waiter(t, api, time.Second).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "lint (failure)")
}

// A full first page of workflow runs means more may follow; the run that ties
// the cancelled check to its newer run is only on page 2.
// @scenario "A check that ran twice counts only its newest run"
func TestWaitReadsEveryPageOfWorkflowRuns(t *testing.T) {
	full := make([]run, 100)
	for i := range full {
		full[i] = workflowRun(int64(1000+i), int64(1000+i))
	}
	api := &fakeAPI{
		responses: []response{{200, []run{
			in(cancelled("pr conventions"), 1, 10),
			in(ok("pr conventions"), 2, 11),
		}}},
		workflowRuns: [][]run{full, {workflowRun(7, 10), workflowRun(7, 11)}},
	}

	require.NoError(t, waiter(t, api, time.Second).Wait(context.Background()))
	assert.Equal(t, 2, api.workflowCalls)
}
func onBranch(w waitforchecks.Waiter) waitforchecks.Waiter {
	w.Branch = "main"

	return w
}

func status(context, state string) run { return run{"context": context, "state": state} }

// @scenario "A check the branch does not require never holds the review"
func TestWaitIgnoresChecksTheBranchDoesNotRequire(t *testing.T) {
	api := &fakeAPI{
		responses: []response{{200, []run{ok("pr conventions"), pending("lighthouse"), failed("go-ci")}}},
		rules:     []string{"pr conventions", "review"},
	}

	require.NoError(t, onBranch(waiter(t, api, time.Second)).Wait(context.Background()))
	assert.Equal(t, 1, api.calls)
}

// @scenario "A required check that has not reported yet keeps the review waiting"
func TestWaitKeepsWaitingForARequiredCheckThatHasNotReported(t *testing.T) {
	api := &fakeAPI{
		responses: []response{{200, []run{ok("ci-complete")}}},
		rules:     []string{"ci-complete", "pr conventions"},
	}

	err := onBranch(waiter(t, api, 300*time.Millisecond)).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "pr conventions (not reported yet)")
}

// @scenario "A required check that has not reported yet keeps the review waiting"
func TestWaitProceedsOnceTheRequiredCheckReports(t *testing.T) {
	api := &fakeAPI{
		responses: []response{{200, []run{}}, {200, []run{pending("pr conventions")}}, {200, []run{ok("pr conventions")}}},
		rules:     []string{"pr conventions"},
	}

	require.NoError(t, onBranch(waiter(t, api, time.Second)).Wait(context.Background()))
	assert.Equal(t, 3, api.calls)
}

// @scenario "A required check posted as a commit status counts"
func TestWaitReadsARequiredCommitStatus(t *testing.T) {
	api := &fakeAPI{
		responses: []response{{200, []run{ok("ci-complete")}}},
		rules:     []string{"ci-complete", "codeql-complete"},
		statuses:  []run{status("codeql-complete", "success"), status("optional", "failure")},
	}

	require.NoError(t, onBranch(waiter(t, api, time.Second)).Wait(context.Background()))
}

// @scenario "A required check posted as a commit status counts"
// @scenario "A failed required check fails the review job"
func TestWaitFailsOnAFailedRequiredCommitStatus(t *testing.T) {
	api := &fakeAPI{
		responses: []response{{200, []run{ok("ci-complete")}}},
		rules:     []string{"ci-complete", "codeql-complete"},
		statuses:  []run{status("codeql-complete", "failure")},
	}

	err := onBranch(waiter(t, api, time.Second)).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "another check failed: codeql-complete (failure); fix it and push")
}

// @scenario "With no required checks to read, the review waits for every check"
func TestWaitFallsBackToEveryCheckWhenTheBranchRequiresNone(t *testing.T) {
	api := &fakeAPI{responses: []response{{200, []run{ok("a"), failed("go-ci")}}}}

	err := onBranch(waiter(t, api, time.Second)).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "go-ci (failure)")
}

// @scenario "A check the branch does not require never holds the review"
func TestWaitWaitsForNothingWhenTheBranchRequiresOnlyTheReview(t *testing.T) {
	api := &fakeAPI{
		responses: []response{{200, []run{pending("lighthouse"), failed("go-ci")}}},
		rules:     []string{"review"},
	}

	require.NoError(t, onBranch(waiter(t, api, time.Second)).Wait(context.Background()))
}
