package codeblock_test

// Executes examples/shared_session_code_agent.py, the canonical shared-session
// code agent, through the real runner.py subprocess, against a stub login
// service, a stub protected API and a stub LangWatch API.
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
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

const (
	sharedSessionSecretName = "ACME_SESSION"
	sharedSessionProjectKey = "sk-lw-test-project-key"
)

// loadSharedSessionExample reads the committed example unmodified: the test
// runs the exact file the recipe teaches, no second copy.
func loadSharedSessionExample(t *testing.T) string {
	t.Helper()
	code, err := os.ReadFile(filepath.Join("examples", "shared_session_code_agent.py"))
	require.NoError(t, err)
	return string(code)
}

// sharedSessionExec builds an executor whose interpreter can import the two
// packages this example needs, `requests` and `langwatch`.
//
// The langwatch build under test is the one in this repository, not the one on
// PyPI, because the example calls SDK methods that ship with the next release.
// `LANGWATCH_CODEBLOCK_PYTHON` names an interpreter directly; otherwise the
// virtualenv `uv sync` creates under sdks/python is used, which holds the SDK
// as an editable install of the workspace source.
func sharedSessionExec(t *testing.T) *codeblock.Executor {
	t.Helper()

	candidates := []string{}
	if override := os.Getenv("LANGWATCH_CODEBLOCK_PYTHON"); override != "" {
		candidates = append(candidates, override)
	}
	candidates = append(candidates,
		filepath.Join("..", "..", "..", "..", "..", "..", "sdks", "python", ".venv", "bin", "python"),
		"python3",
	)

	for _, candidate := range candidates {
		resolved, err := exec.LookPath(candidate)
		if err != nil {
			continue
		}
		//nolint:gosec // the interpreter path comes from this test's own list or from the operator's env var
		if err := exec.Command(resolved, "-c", "import requests, langwatch").Run(); err != nil {
			continue
		}
		e, err := codeblock.New(codeblock.Options{Python: resolved})
		require.NoError(t, err)
		return e
	}

	t.Skip("no interpreter with `requests` and the workspace `langwatch`; run `uv sync` in sdks/python")
	return nil
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// sharedSessionStubs is a stub login service, a stub protected API and a stub
// LangWatch API. The login service mints a new session per login, and the
// protected API accepts every session it has minted, so a row that presents an
// earlier row's session is served rather than rejected.
type sharedSessionStubs struct {
	loginServer   *httptest.Server
	apiServer     *httptest.Server
	secretsServer *httptest.Server

	mu             sync.Mutex
	password       string
	loginRequests  []loginRequest
	mintedSessions []string
	apiSessions    []string
	valueReads     []string
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

// serveSecrets implements the four routes the SDK's secrets facade uses: list,
// create, update, and the value read by name. It answers 401 without the
// project API key, so a run that forgets to authenticate fails rather than
// passing quietly.
func (s *sharedSessionStubs) serveSecrets(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Auth-Token") != sharedSessionProjectKey {
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
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/secrets/by-name/"):
		name := strings.TrimSuffix(
			strings.TrimPrefix(r.URL.Path, "/api/secrets/by-name/"), "/value")
		s.valueReads = append(s.valueReads, name)
		secret, held := s.stored[name]
		if !held {
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprint(w, `{"error":"secret_not_found","message":"secret_not_found"}`)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{
			"name":      name,
			"value":     secret.value,
			"updatedAt": time.Now().UTC().Format(time.RFC3339),
		})

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
		id := "secret-" + body.Name
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
// platform reads when the row starts. It names the target system and the
// LangWatch project, and deliberately carries no session: the example reads
// that from the store while it runs.
func (s *sharedSessionStubs) rowRequest(t *testing.T, code string) codeblock.Request {
	t.Helper()
	return codeblock.Request{
		Code:            code,
		Inputs:          map[string]any{"message": "ping"},
		DeclaredOutputs: []string{"output"},
		Secrets: map[string]string{
			"ACME_LOGIN_URL":     s.loginServer.URL + "/login",
			"ACME_API_URL":       s.apiServer.URL + "/chat",
			"ACME_USERNAME":      "acme-robot",
			"ACME_PASSWORD":      s.password,
			"LANGWATCH_ENDPOINT": s.secretsServer.URL,
			"LANGWATCH_API_KEY":  sharedSessionProjectKey,
		},
	}
}

func (s *sharedSessionStubs) loginCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.loginRequests)
}

func (s *sharedSessionStubs) valueReadCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.valueReads)
}

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
