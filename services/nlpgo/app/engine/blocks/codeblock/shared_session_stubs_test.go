package codeblock_test

// The stubs and the interpreter resolver the shared-session example tests run
// against: a stub login service, a stub protected API and a stub LangWatch API.
// The scenarios themselves are in shared_session_example_test.go.

import (
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

// storeRaw puts a value in the store exactly as given, for the entries a hand
// edit or an older agent can leave behind.
func (s *sharedSessionStubs) storeRaw(name, value string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stored[name] = storedSecret{id: "secret-" + name, value: value}
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
