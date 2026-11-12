package waitforchecks_test

import (
	"context"
	"encoding/json"
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
