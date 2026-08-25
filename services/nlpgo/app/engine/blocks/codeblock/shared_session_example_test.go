package codeblock_test

// Executes examples/shared_session_code_agent.py, the canonical shared-session
// code agent, through the real runner.py subprocess. The stubs it runs against
// are in shared_session_stubs_test.go.
//
// The tests assert on what the stubs RECEIVED: how many logins happened, which
// session the protected API was given, and what was written back to the secret
// store. A row that reuses a hardcoded token, or one that logs in every time,
// cannot pass them.
//
// Each row is executed as its own request with its own secrets map, which is
// what a row of an experiment or a dataset run gets. The session is NOT in that
// map: the example reads it from the LangWatch API, so a row picks up whatever
// the store holds when the row runs rather than what it held when the row was
// prepared.

import (
	"context"
	"encoding/json"
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

	res, err := sharedSessionExec(t).Execute(context.Background(), stubs.rowRequest(t, code))
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected success, got %+v", res.Error)

	// The row asked the store before it logged in.
	require.Equal(t, []string{sharedSessionSecretName}, stubs.valueReads)
	require.Equal(t, 1, stubs.loginCount(), "the first row logs in exactly once")
	assert.Equal(t, "acme-robot", stubs.loginRequests[0].Username)
	assert.Equal(t, password, stubs.loginRequests[0].Password)

	// The session reached the protected API, and the answer came back.
	require.Len(t, stubs.apiSessions, 1)
	assert.Equal(t, "session-1", stubs.apiSessions[0])
	assert.Equal(t, "hello from the protected api", res.Outputs["output"])

	// The session was written back with the time it was issued.
	var stored struct {
		Session  string `json:"session"`
		IssuedAt int64  `json:"issued_at"`
	}
	require.NoError(t, json.Unmarshal([]byte(stubs.storedSession()), &stored))
	assert.Equal(t, "session-1", stored.Session)
	assert.InDelta(t, time.Now().Unix(), stored.IssuedAt, 60)

	// The password appears in no captured output stream.
	assert.NotContains(t, res.Stdout, password)
	assert.NotContains(t, res.Stderr, password)
}

// @scenario "A later row reuses the stored session"
func TestSharedSessionCodeAgent_LaterRowReusesTheStoredSession(t *testing.T) {
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	stubs.seedSession(t, "session-from-an-earlier-row", 5)

	res, err := sharedSessionExec(t).Execute(context.Background(),
		stubs.rowRequest(t, loadSharedSessionExample(t)))
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected success, got %+v", res.Error)

	// The row holds no session in its own snapshot, so a reuse can only come
	// from the value read.
	assert.Equal(t, 1, stubs.valueReadCount())
	assert.Equal(t, 0, stubs.loginCount(), "a fresh stored session means no login")
	require.Len(t, stubs.apiSessions, 1)
	assert.Equal(t, "session-from-an-earlier-row", stubs.apiSessions[0])
	assert.Equal(t, "hello from the protected api", res.Outputs["output"])
}

// @scenario "A row refreshes the session before it expires"
func TestSharedSessionCodeAgent_RowRefreshesBeforeTheSessionExpires(t *testing.T) {
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	// The example's window is 15 minutes with a 60 second margin, so a session
	// issued 14 minutes and 30 seconds ago is stale while still being valid.
	stubs.seedSession(t, "session-about-to-expire", 14*60+30)

	res, err := sharedSessionExec(t).Execute(context.Background(),
		stubs.rowRequest(t, loadSharedSessionExample(t)))
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected success, got %+v", res.Error)

	assert.Equal(t, 1, stubs.loginCount(), "a session inside the margin is refreshed")
	require.Len(t, stubs.apiSessions, 1)
	assert.Equal(t, "session-1", stubs.apiSessions[0], "the refreshed session is used")

	var stored struct {
		Session string `json:"session"`
	}
	require.NoError(t, json.Unmarshal([]byte(stubs.storedSession()), &stored))
	assert.Equal(t, "session-1", stored.Session, "the stored session was replaced")
}

// @scenario "A row reads a session stored after its own row started"
func TestSharedSessionCodeAgent_RowReadsASessionStoredAfterItStarted(t *testing.T) {
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	// The request is built first, so the row's snapshot is taken before the
	// session exists. The store gains it only afterwards, which is what an
	// earlier row of the same wave does.
	request := stubs.rowRequest(t, loadSharedSessionExample(t))
	stubs.seedSession(t, "session-written-after-the-snapshot", 5)

	res, err := sharedSessionExec(t).Execute(context.Background(), request)
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected success, got %+v", res.Error)

	assert.Equal(t, 0, stubs.loginCount(), "the row reads the store rather than logging in")
	require.Len(t, stubs.apiSessions, 1)
	assert.Equal(t, "session-written-after-the-snapshot", stubs.apiSessions[0])
}

// @scenario "Rows that race each other log in at most once each"
func TestSharedSessionCodeAgent_RacingRowsLogInAtMostOnceEach(t *testing.T) {
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	code := loadSharedSessionExample(t)

	executor := sharedSessionExec(t)
	results := make([]*codeblock.Result, 2)
	errs := make([]error, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	for i := range results {
		go func(index int) {
			defer wg.Done()
			results[index], errs[index] = executor.Execute(
				context.Background(), stubs.rowRequest(t, code))
		}(i)
	}
	wg.Wait()

	for i := range results {
		require.NoError(t, errs[i], "row %d", i)
		require.Nil(t, results[i].Error, "row %d: %+v", i, results[i].Error)
		assert.Equal(t, "hello from the protected api", results[i].Outputs["output"])
	}
	// Both rows read the store first. Whether the second one finds a session
	// depends on how far the first got, so the count is bounded rather than
	// fixed: never more than one login per row, and never zero.
	assert.Equal(t, 2, stubs.valueReadCount())
	assert.LessOrEqual(t, stubs.loginCount(), 2, "no row logs in twice")
	assert.GreaterOrEqual(t, stubs.loginCount(), 1, "an empty store means at least one login")
	assert.NotEmpty(t, stubs.storedSession(), "the session was written")
}

// @scenario "A stored entry that holds no usable session is a miss"
func TestSharedSessionCodeAgent_UnusableStoredEntryIsAMiss(t *testing.T) {
	now := time.Now().Unix()
	for name, stored := range map[string]string{
		"an empty session": fmt.Sprintf(`{"session":"","issued_at":%d}`, now),
		"a session that is not a string": fmt.Sprintf(
			`{"session":1234,"issued_at":%d}`, now),
		"an issued_at in the future": fmt.Sprintf(
			`{"session":"from-the-future","issued_at":%d}`, now+3600),
		"an issued_at that is not a number":   `{"session":"whenever","issued_at":"soon"}`,
		"a value that is not an entry at all": `plain text somebody typed`,
	} {
		t.Run(name, func(t *testing.T) {
			stubs := newSharedSessionStubs(t, "p4ssw0rd")
			stubs.storeRaw(sharedSessionSecretName, stored)

			res, err := sharedSessionExec(t).Execute(context.Background(),
				stubs.rowRequest(t, loadSharedSessionExample(t)))
			require.NoError(t, err)
			require.Nil(t, res.Error, "an unusable entry must not fail the row: %+v", res.Error)

			// The row logged in rather than sending the stored value as a token.
			assert.Equal(t, 1, stubs.loginCount())
			require.Len(t, stubs.apiSessions, 1)
			assert.Equal(t, "session-1", stubs.apiSessions[0])
			assert.Equal(t, "hello from the protected api", res.Outputs["output"])
		})
	}
}

// @scenario "A rejected login names the failure and keeps the password out of it"
func TestSharedSessionCodeAgent_RejectedLoginFailsWithoutThePassword(t *testing.T) {
	password := fmt.Sprintf("p4ssw0rd-must-not-leak-%d", os.Getpid())
	stubs := newSharedSessionStubs(t, password)
	stubs.rejectLogin = true

	res, err := sharedSessionExec(t).Execute(context.Background(),
		stubs.rowRequest(t, loadSharedSessionExample(t)))
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

	res, err := sharedSessionExec(t).Execute(context.Background(),
		stubs.rowRequest(t, loadSharedSessionExample(t)))
	require.NoError(t, err)
	require.Nil(t, res.Error, "a failed write must not fail the row: %+v", res.Error)

	assert.Equal(t, "hello from the protected api", res.Outputs["output"])
	assert.Contains(t, res.Stderr, sharedSessionSecretName)
	assert.Contains(t, res.Stderr, "the next row will log in again")
	assert.NotContains(t, res.Stderr, "session-1", "the report carries no session")
	assert.NotContains(t, res.Stderr, password)
}

// @scenario "A store failure never prints the LangWatch API key"
func TestSharedSessionCodeAgent_StoreFailureNeverPrintsTheLangWatchKey(t *testing.T) {
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	request := stubs.rowRequest(t, loadSharedSessionExample(t))
	// A key with a newline in it cannot go in a header. The HTTP client says
	// so in a message that quotes the key, which is why the example reports
	// the type of a failure and never its message.
	leakyKey := "sk-lw-must-not-leak\nsentinel"
	request.Secrets["LANGWATCH_API_KEY"] = leakyKey

	res, err := sharedSessionExec(t).Execute(context.Background(), request)
	require.NoError(t, err)

	combined := strings.Join([]string{res.Stdout, res.Stderr}, "\n")
	if res.Error != nil {
		combined = strings.Join(
			[]string{combined, res.Error.Message, res.Error.Traceback}, "\n")
	}
	assert.NotContains(t, combined, "must-not-leak",
		"a failure report must never carry the LangWatch API key")
}

// @scenario "A missing secret names the secret the project has to hold"
func TestSharedSessionCodeAgent_MissingSecretIsNamed(t *testing.T) {
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	request := stubs.rowRequest(t, loadSharedSessionExample(t))
	delete(request.Secrets, "ACME_LOGIN_URL")

	res, err := sharedSessionExec(t).Execute(context.Background(), request)
	require.NoError(t, err)

	require.NotNil(t, res.Error, "a missing secret must fail the row")
	assert.Contains(t, res.Error.Message, "ACME_LOGIN_URL")
	assert.Equal(t, 0, stubs.loginCount())
}
