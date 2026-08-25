package codeblock_test

// Executes examples/shared_session_code_agent.py, the canonical shared-session
// code agent, through the real runner.py subprocess, against a stub login
// service, a stub protected API and a stub LangWatch secrets API.
//
// The tests assert on what the stubs RECEIVED: how many logins happened, which
// session the protected API was given, and what was written back to the secret
// store. A row that reuses a hardcoded token, or one that logs in every time,
// cannot pass them.
//
// Each row is executed as its own request with its own secrets map, which is
// what a row of an experiment or a dataset run gets: a snapshot of the project
// secrets read when that row starts.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

const sharedSessionSecretName = "ACME_SESSION"

// loadSharedSessionExample reads the committed example unmodified: the test
// runs the exact file the recipe teaches, no second copy.
func loadSharedSessionExample(t *testing.T) string {
	t.Helper()
	code, err := os.ReadFile(filepath.Join("examples", "shared_session_code_agent.py"))
	require.NoError(t, err)
	return string(code)
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// sharedSessionStubs is a stub login service, a stub protected API and a stub
// LangWatch secrets API. The login service mints a new session per login and
// the protected API rejects every session it did not mint most recently.
type sharedSessionStubs struct {
	loginServer   *httptest.Server
	apiServer     *httptest.Server
	secretsServer *httptest.Server

	mu             sync.Mutex
	password       string
	loginRequests  []loginRequest
	mintedSessions []string
	apiSessions    []string
	rejectLogin    bool
	rejectWrite    bool

	// stored mirrors the project secret store: name -> value.
	stored map[string]storedSecret
}

type storedSecret struct {
	id    string
	value string
}

func newSharedSessionStubs(t *testing.T, password string) *sharedSessionStubs {
	t.Helper()
	s := &sharedSessionStubs{password: password, stored: map[string]storedSecret{}}

	s.loginServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// No require/assert in handlers (testifylint go-require): a contract
		// violation surfaces as a 4xx, which fails the test at the caller.
		if r.Method != http.MethodPost || r.URL.Path != "/login" ||
			!strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var req loginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		s.mu.Lock()
		s.loginRequests = append(s.loginRequests, req)
		reject := s.rejectLogin
		minted := fmt.Sprintf("session-%d", len(s.loginRequests))
		if !reject && req.Password == s.password {
			s.mintedSessions = append(s.mintedSessions, minted)
		}
		s.mu.Unlock()
		if reject || req.Password != s.password {
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, `{"error":"invalid_credentials"}`)
			return
		}
		fmt.Fprintf(w, `{"session":%q,"expires_in":900}`, minted)
	}))
	t.Cleanup(s.loginServer.Close)

	s.apiServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/chat" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		presented := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		s.mu.Lock()
		s.apiSessions = append(s.apiSessions, presented)
		known := false
		for _, minted := range s.mintedSessions {
			if minted == presented {
				known = true
				break
			}
		}
		s.mu.Unlock()
		if !known {
			// An expired or invented session is rejected, the way the real
			// system rejects one.
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		fmt.Fprint(w, `{"reply":"hello from the protected api"}`)
	}))
	t.Cleanup(s.apiServer.Close)

	s.secretsServer = httptest.NewServer(http.HandlerFunc(s.serveSecrets))
	t.Cleanup(s.secretsServer.Close)

	return s
}

// serveSecrets implements the three routes the example uses on the LangWatch
// secrets API: list, create and update. It answers 401 without the project API
// key, so a run that forgets the header fails rather than passing quietly.
func (s *sharedSessionStubs) serveSecrets(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Auth-Token") != "sk-lw-test-project-key" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.rejectWrite && r.Method != http.MethodGet {
		w.WriteHeader(http.StatusForbidden)
		fmt.Fprint(w, `{"error":"forbidden"}`)
		return
	}

	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/secrets":
		listing := make([]map[string]string, 0, len(s.stored))
		for name, secret := range s.stored {
			listing = append(listing, map[string]string{"id": secret.id, "name": name})
		}
		_ = json.NewEncoder(w).Encode(listing)

	case r.Method == http.MethodPost && r.URL.Path == "/api/secrets":
		var body struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if _, exists := s.stored[body.Name]; exists {
			w.WriteHeader(http.StatusConflict)
			fmt.Fprint(w, `{"error":"Secret with this name already exists"}`)
			return
		}
		id := fmt.Sprintf("secret-%s", body.Name)
		s.stored[body.Name] = storedSecret{id: id, value: body.Value}
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintf(w, `{"id":%q,"name":%q}`, id, body.Name)

	case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/secrets/"):
		id := strings.TrimPrefix(r.URL.Path, "/api/secrets/")
		var body struct {
			Value string `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		for name, secret := range s.stored {
			if secret.id == id {
				s.stored[name] = storedSecret{id: id, value: body.Value}
				fmt.Fprintf(w, `{"id":%q,"name":%q}`, id, name)
				return
			}
		}
		w.WriteHeader(http.StatusNotFound)

	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// storedSession returns the value the example wrote back, or "" when it wrote
// nothing.
func (s *sharedSessionStubs) storedSession() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stored[sharedSessionSecretName].value
}

// seedSession puts a session in the store as if an earlier row had written it,
// issued the given number of seconds ago.
func (s *sharedSessionStubs) seedSession(t *testing.T, session string, ageSeconds int64) {
	t.Helper()
	value, err := json.Marshal(map[string]any{
		"session":   session,
		"issued_at": time.Now().Unix() - ageSeconds,
	})
	require.NoError(t, err)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stored[sharedSessionSecretName] = storedSecret{
		id:    "secret-" + sharedSessionSecretName,
		value: string(value),
	}
	// A seeded session must be one the protected API accepts, otherwise the
	// reuse assertions would pass for the incorrect reason.
	s.mintedSessions = append(s.mintedSessions, session)
}

// rowRequest builds one row's execution. The secrets map is the snapshot the
// platform reads when that row starts, which is why the stored session is
// passed in here rather than fetched by the example.
func (s *sharedSessionStubs) rowRequest(t *testing.T, code string) codeblock.Request {
	t.Helper()
	projectSecrets := map[string]string{
		"ACME_LOGIN_URL":     s.loginServer.URL + "/login",
		"ACME_API_URL":       s.apiServer.URL + "/chat",
		"ACME_USERNAME":      "acme-robot",
		"ACME_PASSWORD":      s.password,
		"LANGWATCH_ENDPOINT": s.secretsServer.URL,
		"LANGWATCH_API_KEY":  "sk-lw-test-project-key",
	}
	if stored := s.storedSession(); stored != "" {
		projectSecrets[sharedSessionSecretName] = stored
	}
	return codeblock.Request{
		Code:            code,
		Inputs:          map[string]any{"message": "ping"},
		DeclaredOutputs: []string{"output"},
		Secrets:         projectSecrets,
	}
}

func (s *sharedSessionStubs) loginCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.loginRequests)
}

// @scenario "The first row logs in and stores the session"
func TestSharedSessionCodeAgent_FirstRowLogsInAndStoresTheSession(t *testing.T) {
	requirePython(t)
	password := fmt.Sprintf("p4ssw0rd-must-not-leak-%d", os.Getpid())
	stubs := newSharedSessionStubs(t, password)
	code := loadSharedSessionExample(t)

	res, err := newExec(t).Execute(context.Background(), stubs.rowRequest(t, code))
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected success, got %+v", res.Error)

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
	requirePython(t)
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	stubs.seedSession(t, "session-from-an-earlier-row", 5)

	res, err := newExec(t).Execute(context.Background(),
		stubs.rowRequest(t, loadSharedSessionExample(t)))
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected success, got %+v", res.Error)

	assert.Equal(t, 0, stubs.loginCount(), "a fresh stored session means no login")
	require.Len(t, stubs.apiSessions, 1)
	assert.Equal(t, "session-from-an-earlier-row", stubs.apiSessions[0])
	assert.Equal(t, "hello from the protected api", res.Outputs["output"])
}

// @scenario "A row refreshes the session before it expires"
func TestSharedSessionCodeAgent_RowRefreshesBeforeTheSessionExpires(t *testing.T) {
	requirePython(t)
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	// The example's window is 15 minutes with a 60 second margin, so a session
	// issued 14 minutes and 30 seconds ago is stale while still being valid.
	stubs.seedSession(t, "session-about-to-expire", 14*60+30)

	res, err := newExec(t).Execute(context.Background(),
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

// @scenario "Two rows that start together each log in"
func TestSharedSessionCodeAgent_RowsThatStartTogetherEachLogIn(t *testing.T) {
	requirePython(t)
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	code := loadSharedSessionExample(t)

	// Both rows are built from the same empty snapshot, which is what a
	// parallel first wave sees. One of them creates the secret and the other
	// gets a 409 and overwrites it; both must still answer.
	first := stubs.rowRequest(t, code)
	second := stubs.rowRequest(t, code)

	executor := newExec(t)
	results := make([]*codeblock.Result, 2)
	errs := make([]error, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	for i, request := range []codeblock.Request{first, second} {
		go func(index int, req codeblock.Request) {
			defer wg.Done()
			results[index], errs[index] = executor.Execute(context.Background(), req)
		}(i, request)
	}
	wg.Wait()

	for i := range results {
		require.NoError(t, errs[i], "row %d", i)
		require.Nil(t, results[i].Error, "row %d: %+v", i, results[i].Error)
		assert.Equal(t, "hello from the protected api", results[i].Outputs["output"])
	}
	assert.Equal(t, 2, stubs.loginCount(),
		"a row cannot see a write made by a row running beside it")
	assert.NotEmpty(t, stubs.storedSession(), "one of the two wrote the session")
}

// @scenario "A rejected login names the failure and keeps the password out of it"
func TestSharedSessionCodeAgent_RejectedLoginFailsWithoutThePassword(t *testing.T) {
	requirePython(t)
	password := fmt.Sprintf("p4ssw0rd-must-not-leak-%d", os.Getpid())
	stubs := newSharedSessionStubs(t, password)
	stubs.rejectLogin = true

	res, err := newExec(t).Execute(context.Background(),
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
	requirePython(t)
	password := fmt.Sprintf("p4ssw0rd-must-not-leak-%d", os.Getpid())
	stubs := newSharedSessionStubs(t, password)
	stubs.rejectWrite = true

	res, err := newExec(t).Execute(context.Background(),
		stubs.rowRequest(t, loadSharedSessionExample(t)))
	require.NoError(t, err)
	require.Nil(t, res.Error, "a failed write must not fail the row: %+v", res.Error)

	assert.Equal(t, "hello from the protected api", res.Outputs["output"])
	assert.Contains(t, res.Stderr, sharedSessionSecretName)
	assert.Contains(t, res.Stderr, "the next row will log in again")
	assert.NotContains(t, res.Stderr, "session-1", "the report carries no session")
	assert.NotContains(t, res.Stderr, password)
}

// @scenario "A missing secret names the secret the project has to hold"
func TestSharedSessionCodeAgent_MissingSecretIsNamed(t *testing.T) {
	requirePython(t)
	stubs := newSharedSessionStubs(t, "p4ssw0rd")
	request := stubs.rowRequest(t, loadSharedSessionExample(t))
	delete(request.Secrets, "ACME_LOGIN_URL")

	res, err := newExec(t).Execute(context.Background(), request)
	require.NoError(t, err)

	require.NotNil(t, res.Error, "a missing secret must fail the row")
	assert.Contains(t, res.Error.Message, "ACME_LOGIN_URL")
	assert.Equal(t, 0, stubs.loginCount())
}
