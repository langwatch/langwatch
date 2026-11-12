package waitforchecks_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/waitforchecks"
)

type run = map[string]string

// fakeAPI answers each request with the next scripted response; the last one
// repeats. A response is a status code and, for 200, the check runs.
type fakeAPI struct {
	mu        sync.Mutex
	responses []response
	calls     int
	// errHeaders ride on every non-200 answer (Retry-After, X-RateLimit-Remaining).
	errHeaders map[string]string
}

type response struct {
	status int
	runs   []run
}

func (f *fakeAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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

// @scenario "The review waits for every other check on the head commit"
func TestWaitProceedsWhenEveryCheckPassed(t *testing.T) {
	skipped := run{"name": "s", "status": "completed", "conclusion": "skipped"}
	api := &fakeAPI{responses: []response{{200, []run{ok("a"), skipped}}}}

	require.NoError(t, waiter(t, api, time.Second).Wait(context.Background()))
}

// @scenario "The review waits for every other check on the head commit"
func TestWaitKeepsPollingWhileACheckIsPending(t *testing.T) {
	api := &fakeAPI{responses: []response{
		{200, []run{ok("a"), pending("b")}},
		{200, []run{ok("a"), ok("b")}},
	}}

	require.NoError(t, waiter(t, api, time.Second).Wait(context.Background()))
	assert.Equal(t, 2, api.calls)
}

// @scenario "a failed check fails the review job"
func TestWaitFailsNamingTheFailedCheck(t *testing.T) {
	api := &fakeAPI{responses: []response{{200, []run{ok("a"), failed("go-ci"), pending("b")}}}}

	err := waiter(t, api, time.Second).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "another check failed: go-ci (failure); fix it and push")
}

// @scenario "The review waits for every other check on the head commit"
func TestWaitTimeoutNamesThePendingChecks(t *testing.T) {
	api := &fakeAPI{responses: []response{{200, []run{ok("a"), pending("slow-one")}}}}

	err := waiter(t, api, 50*time.Millisecond).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "still running")
	assert.Contains(t, err.Error(), "slow-one")
}

// @scenario "The review waits for every other check on the head commit"
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

	err := waiter(t, api, 50*time.Millisecond).Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "500")
}

// @scenario "The review waits for every other check on the head commit"
func TestWaitExcludesTheReviewJobsOwnCheck(t *testing.T) {
	api := &fakeAPI{responses: []response{{200, []run{ok("a"), pending("review")}}}}

	require.NoError(t, waiter(t, api, time.Second).Wait(context.Background()))
}

// A full first page means more may follow; a failure only on page 2 must show.
// @scenario "a failed check fails the review job"
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

// @scenario "The review waits for every other check on the head commit"
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

	err := waiter(t, api, 50*time.Millisecond).Wait(context.Background())

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
