package codeblock_test

// Executes examples/shared_session_code_agent.py, the canonical shared-session
// code agent, through the real runner.py subprocess. The stubs it runs against
// are in shared_session_stubs_test.go.
//
// The tests assert on what the stubs RECEIVED: how many logins happened, which
// session the protected API was given, and what was written into the cache. A
// row that reuses a hardcoded token, or one that logs in every time, cannot
// pass them.
//
// Each row is executed as its own request with its own secrets map, which is
// what a row of an experiment or a dataset run gets. The session is NOT in that
// map: the example reads it from the agent cache, so a row picks up whatever
// the cache holds when the row runs rather than what it held when the row was
// prepared.

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// @scenario "The first row logs in and stores the session"
func TestSharedSessionCodeAgent_FirstRowLogsInAndStoresTheSession(t *testing.T) {
	password := fmt.Sprintf("p4ssw0rd-must-not-leak-%d", os.Getpid())
	stubs := newSharedSessionStubs(t, password)
	code := loadSharedSessionExample(t)

	res, err := sharedSessionExec(t, stubs.cacheServer.URL).
		Execute(context.Background(), stubs.rowRequest(code))
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected success, got %+v", res.Error)

	// The row asked the cache before it logged in.
	require.Equal(t, []string{sharedSessionEntryName}, stubs.cacheReads)
	require.Equal(t, 1, stubs.loginCount(), "the first row logs in exactly once")
	assert.Equal(t, "acme-robot", stubs.loginRequests[0].Username)
	assert.Equal(t, password, stubs.loginRequests[0].Password)

	// The session reached the protected API, and the answer came back.
	require.Len(t, stubs.apiSessions, 1)
	assert.Equal(t, "session-1", stubs.apiSessions[0])
	assert.Equal(t, "hello from the protected api", res.Outputs["output"])

	// The session was written back for less than the target system promises,
	// so the next row never sends one that is about to lapse.
	writes := stubs.writes()
	require.Len(t, writes, 1)
	assert.Equal(t, sharedSessionEntryName, writes[0].Name)
	assert.Equal(t, 15*60-60, writes[0].TTLSeconds)
	assert.Equal(t, "session-1", stubs.storedSession())

	// The password appears in no captured output stream.
	assert.NotContains(t, res.Stdout, password)
	assert.NotContains(t, res.Stderr, password)
}

// @scenario "A later row reuses the stored session"
func TestSharedSessionCodeAgent_LaterRowReusesTheStoredSession(t *testing.T) {
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	stubs.seedSession("session-from-an-earlier-row", time.Minute)

	res, err := sharedSessionExec(t, stubs.cacheServer.URL).
		Execute(context.Background(), stubs.rowRequest(loadSharedSessionExample(t)))
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected success, got %+v", res.Error)

	// The row holds no session in its own snapshot, so a reuse can only come
	// from the cache read.
	assert.Equal(t, 1, stubs.cacheReadCount())
	assert.Equal(t, 0, stubs.loginCount(), "a live cache entry means no login")
	assert.Empty(t, stubs.writes(), "a reused session is not written again")
	require.Len(t, stubs.apiSessions, 1)
	assert.Equal(t, "session-from-an-earlier-row", stubs.apiSessions[0])
	assert.Equal(t, "hello from the protected api", res.Outputs["output"])
}

// @scenario "A row logs in again once the stored session has lapsed"
func TestSharedSessionCodeAgent_RowLogsInAgainOnceTheEntryHasLapsed(t *testing.T) {
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	// The lifetime is the only thing that decides freshness, so an entry
	// written with a lifetime that has passed reads exactly as an absent one.
	stubs.seedSession("session-that-has-lapsed", -time.Second)

	res, err := sharedSessionExec(t, stubs.cacheServer.URL).
		Execute(context.Background(), stubs.rowRequest(loadSharedSessionExample(t)))
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected success, got %+v", res.Error)

	assert.Equal(t, 1, stubs.loginCount(), "a lapsed entry means a fresh login")
	require.Len(t, stubs.apiSessions, 1)
	assert.Equal(t, "session-1", stubs.apiSessions[0], "the fresh session is used")
	assert.Equal(t, "session-1", stubs.storedSession(), "the entry was replaced")
}

// @scenario "A row reads a session stored after its own row started"
func TestSharedSessionCodeAgent_RowReadsASessionStoredAfterItStarted(t *testing.T) {
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	// The request is built first, so the row's snapshot is taken before the
	// session exists. The cache gains it only afterwards, which is what an
	// earlier row of the same wave does.
	request := stubs.rowRequest(loadSharedSessionExample(t))
	stubs.seedSession("session-written-after-the-snapshot", time.Minute)

	res, err := sharedSessionExec(t, stubs.cacheServer.URL).
		Execute(context.Background(), request)
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected success, got %+v", res.Error)

	assert.Equal(t, 0, stubs.loginCount(), "the row reads the cache rather than logging in")
	require.Len(t, stubs.apiSessions, 1)
	assert.Equal(t, "session-written-after-the-snapshot", stubs.apiSessions[0])
}

// @scenario "Rows that race each other log in at most once each"
func TestSharedSessionCodeAgent_RacingRowsLogInAtMostOnceEach(t *testing.T) {
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	code := loadSharedSessionExample(t)

	executor := sharedSessionExec(t, stubs.cacheServer.URL)
	results := make([]*codeblock.Result, 2)
	errs := make([]error, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	for i := range results {
		go func(index int) {
			defer wg.Done()
			results[index], errs[index] = executor.Execute(
				context.Background(), stubs.rowRequest(code))
		}(i)
	}
	wg.Wait()

	for i := range results {
		require.NoError(t, errs[i], "row %d", i)
		require.Nil(t, results[i].Error, "row %d: %+v", i, results[i].Error)
		assert.Equal(t, "hello from the protected api", results[i].Outputs["output"])
	}
	// Both rows read the cache first. Whether the second one finds a session
	// depends on how far the first got, so the count is bounded rather than
	// fixed: never more than one login per row, and never zero.
	assert.Equal(t, 2, stubs.cacheReadCount())
	assert.LessOrEqual(t, stubs.loginCount(), 2, "no row logs in twice")
	assert.GreaterOrEqual(t, stubs.loginCount(), 1, "an empty cache means at least one login")
	assert.NotEmpty(t, stubs.storedSession(), "the session was written")
}

// @scenario "A rejected login names the failure and keeps the password out of it"
func TestSharedSessionCodeAgent_RejectedLoginFailsWithoutThePassword(t *testing.T) {
	password := fmt.Sprintf("p4ssw0rd-must-not-leak-%d", os.Getpid())
	stubs := newSharedSessionStubs(t, password)
	stubs.rejectLogin = true

	res, err := sharedSessionExec(t, stubs.cacheServer.URL).
		Execute(context.Background(), stubs.rowRequest(loadSharedSessionExample(t)))
	require.NoError(t, err)

	require.NotNil(t, res.Error, "a rejected login must fail the row")
	assert.Contains(t, res.Error.Message, "401")
	assert.Contains(t, res.Error.Message, "/login")
	assert.Empty(t, res.Outputs["output"], "no empty success")

	combined := strings.Join(
		[]string{res.Error.Message, res.Error.Traceback, res.Stdout, res.Stderr}, "\n")
	assert.NotContains(t, combined, password)
}

// @scenario "A row still answers when the session cannot be stored"
func TestSharedSessionCodeAgent_RowStillAnswersWhenTheSessionCannotBeStored(t *testing.T) {
	password := fmt.Sprintf("p4ssw0rd-must-not-leak-%d", os.Getpid())
	stubs := newSharedSessionStubs(t, password)
	stubs.rejectWrite = true

	res, err := sharedSessionExec(t, stubs.cacheServer.URL).
		Execute(context.Background(), stubs.rowRequest(loadSharedSessionExample(t)))
	require.NoError(t, err)
	require.Nil(t, res.Error, "a failed write must not fail the row: %+v", res.Error)

	assert.Equal(t, "hello from the protected api", res.Outputs["output"])
	assert.Contains(t, res.Stderr, sharedSessionEntryName)
	assert.Contains(t, res.Stderr, "the next row will log in again")
	assert.NotContains(t, res.Stderr, "session-1", "the report carries no session")
	assert.NotContains(t, res.Stderr, password)
}

// @scenario "A row still answers when the cache cannot be read"
func TestSharedSessionCodeAgent_RowStillAnswersWhenTheCacheCannotBeRead(t *testing.T) {
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	stubs.failCache = true

	res, err := sharedSessionExec(t, stubs.cacheServer.URL).
		Execute(context.Background(), stubs.rowRequest(loadSharedSessionExample(t)))
	require.NoError(t, err)
	require.Nil(t, res.Error, "a cache that answers 500 must not fail the row: %+v", res.Error)

	assert.Equal(t, "hello from the protected api", res.Outputs["output"])
	assert.Equal(t, 1, stubs.loginCount(), "an unreadable cache reads as a miss")
	assert.Contains(t, res.Stderr, "this row logs in")
}

// @scenario "A cache failure never prints the run's credential"
func TestSharedSessionCodeAgent_CacheFailureNeverPrintsTheCredential(t *testing.T) {
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	stubs.failCache = true

	res, err := sharedSessionExec(t, stubs.cacheServer.URL).
		Execute(context.Background(), stubs.rowRequest(loadSharedSessionExample(t)))
	require.NoError(t, err)

	combined := strings.Join([]string{res.Stdout, res.Stderr}, "\n")
	if res.Error != nil {
		combined = strings.Join(
			[]string{combined, res.Error.Message, res.Error.Traceback}, "\n")
	}
	assert.NotContains(t, combined, sharedSessionSandboxKey,
		"a failure report must never carry the run's credential")
}

// @scenario "A missing secret names the secret the project has to hold"
func TestSharedSessionCodeAgent_MissingSecretIsNamed(t *testing.T) {
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	request := stubs.rowRequest(loadSharedSessionExample(t))
	delete(request.Secrets, "ACME_LOGIN_URL")

	res, err := sharedSessionExec(t, stubs.cacheServer.URL).
		Execute(context.Background(), request)
	require.NoError(t, err)

	require.NotNil(t, res.Error, "a missing secret must fail the row")
	assert.Contains(t, res.Error.Message, "ACME_LOGIN_URL")
	assert.Equal(t, 0, stubs.loginCount())
}

// @scenario "A run with no credential does its work once per row"
func TestSharedSessionCodeAgent_NoCredentialMeansALoginPerRow(t *testing.T) {
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	code := loadSharedSessionExample(t)
	executor := sharedSessionExec(t, stubs.cacheServer.URL)

	for range 2 {
		request := stubs.rowRequest(code)
		request.SandboxAPIKey = ""

		res, err := executor.Execute(context.Background(), request)
		require.NoError(t, err)
		require.Nil(t, res.Error, "a run with no credential still answers: %+v", res.Error)
		assert.Equal(t, "hello from the protected api", res.Outputs["output"])
	}

	assert.Equal(t, 2, stubs.loginCount(), "each row does its own work")
	assert.Empty(t, stubs.cacheReads, "no credential means no call to the cache")
}
