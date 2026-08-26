package codeblock_test

// The stubs and the interpreter resolver the shared-session example tests run
// against: a stub login service, a stub protected API and a stub LangWatch
// agent cache. The scenarios themselves are in shared_session_example_test.go.

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
	sharedSessionEntryName = "ACME_SESSION"
	// The credential the platform mints for one run. It is not the project
	// key: the cache stub accepts this and nothing else.
	sharedSessionSandboxKey = "sk-lw-test-sandbox-run-key"
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
// packages this example needs, `requests` and `langwatch`, and which injects
// the run's credential against the given cache endpoint.
//
// The langwatch build under test is the one in this repository, not the one on
// PyPI, because the example calls SDK methods that ship with the next release.
// `LANGWATCH_CODEBLOCK_PYTHON` names an interpreter directly; otherwise the
// virtualenv `uv sync` creates under sdks/python is used, which holds the SDK
// as an editable install of the workspace source.
func sharedSessionExec(t *testing.T, endpoint string) *codeblock.Executor {
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
		e, err := codeblock.New(codeblock.Options{
			Python:          resolved,
			SandboxEndpoint: endpoint,
		})
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

// cacheWrite is one PUT the example made, as the platform received it.
type cacheWrite struct {
	Name       string
	TTLSeconds int
}

// sharedSessionStubs is a stub login service, a stub protected API and a stub
// agent cache. The login service mints a new session per login, and the
// protected API accepts every session it has minted, so a row that presents an
// earlier row's session is served rather than rejected.
type sharedSessionStubs struct {
	loginServer *httptest.Server
	apiServer   *httptest.Server
	cacheServer *httptest.Server

	mu             sync.Mutex
	password       string
	loginRequests  []loginRequest
	mintedSessions []string
	apiSessions    []string
	cacheReads     []string
	cacheWrites    []cacheWrite
	rejectLogin    bool
	rejectWrite    bool
	failCache      bool

	// stored mirrors the agent cache: name -> entry, each with its own expiry.
	stored map[string]cacheEntry
}

type cacheEntry struct {
	value     string
	expiresAt time.Time
}

func newSharedSessionStubs(t *testing.T, password string) *sharedSessionStubs {
	t.Helper()
	s := &sharedSessionStubs{password: password, stored: map[string]cacheEntry{}}

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

	s.cacheServer = httptest.NewServer(http.HandlerFunc(s.serveCache))
	t.Cleanup(s.cacheServer.Close)

	return s
}

// serveCache implements the three routes the SDK's cache facade uses. It
// answers 401 without the run's own credential, so a run that authenticates
// with anything else fails rather than passing quietly, and it expires an
// entry on read rather than pretending a lifetime was honored.
func (s *sharedSessionStubs) serveCache(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Auth-Token") != sharedSessionSandboxKey {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/api/agent-cache/") {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/api/agent-cache/")

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.failCache {
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprint(w, `{"error":{"type":"internal_error","code":"internal_error","message":"internal_error"}}`)
		return
	}
	if s.rejectWrite && r.Method != http.MethodGet {
		w.WriteHeader(http.StatusForbidden)
		fmt.Fprint(w, `{"error":{"type":"permission_denied","code":"insufficient_permissions","message":"insufficient_permissions"}}`)
		return
	}

	switch r.Method {
	case http.MethodGet:
		s.cacheReads = append(s.cacheReads, name)
		entry, held := s.stored[name]
		if !held || !time.Now().Before(entry.expiresAt) {
			delete(s.stored, name)
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprint(w, `{"error":{"type":"not_found","code":"cache_entry_not_found","message":"cache_entry_not_found"}}`)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{
			"name":  name,
			"value": entry.value,
		})

	case http.MethodPut:
		var body struct {
			Value      string `json:"value"`
			TTLSeconds *int   `json:"ttl_seconds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		ttl := 15 * 60
		if body.TTLSeconds != nil {
			ttl = *body.TTLSeconds
		}
		s.cacheWrites = append(s.cacheWrites, cacheWrite{Name: name, TTLSeconds: ttl})
		s.stored[name] = cacheEntry{
			value:     body.Value,
			expiresAt: time.Now().Add(time.Duration(ttl) * time.Second),
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"name": name, "ttl_seconds": ttl,
		})

	case http.MethodDelete:
		delete(s.stored, name)
		_ = json.NewEncoder(w).Encode(map[string]any{"name": name, "deleted": true})

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// storedSession returns the session the example wrote back, or "" when it
// wrote nothing.
func (s *sharedSessionStubs) storedSession() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stored[sharedSessionEntryName].value
}

// seedSession puts a session in the cache as if an earlier row had written it,
// good for the given lifetime.
func (s *sharedSessionStubs) seedSession(session string, ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stored[sharedSessionEntryName] = cacheEntry{
		value:     session,
		expiresAt: time.Now().Add(ttl),
	}
	// A seeded session must be one the protected API accepts, otherwise the
	// reuse assertions would pass for the incorrect reason.
	s.mintedSessions = append(s.mintedSessions, session)
}

// seedForgottenSession puts a session in the cache that the protected API will
// refuse, which is what an earlier row's session looks like after the target
// system restarts, an operator closes the session, or the password changes.
// The entry itself is live: only the target has moved on.
func (s *sharedSessionStubs) seedForgottenSession(session string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stored[sharedSessionEntryName] = cacheEntry{
		value:     session,
		expiresAt: time.Now().Add(time.Minute),
	}
}

// rowRequest builds one row's execution. The secrets map is the snapshot the
// platform reads when the row starts. It names the target system only: the
// LangWatch credential arrives in the sandbox environment, and the session is
// read from the cache while the row runs.
func (s *sharedSessionStubs) rowRequest(code string) codeblock.Request {
	return codeblock.Request{
		Code:            code,
		Inputs:          map[string]any{"message": "ping"},
		DeclaredOutputs: []string{"output"},
		SandboxAPIKey:   sharedSessionSandboxKey,
		Secrets: map[string]string{
			"ACME_LOGIN_URL": s.loginServer.URL + "/login",
			"ACME_API_URL":   s.apiServer.URL + "/chat",
			"ACME_USERNAME":  "acme-robot",
			"ACME_PASSWORD":  s.password,
		},
	}
}

func (s *sharedSessionStubs) loginCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.loginRequests)
}

func (s *sharedSessionStubs) cacheReadCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.cacheReads)
}

func (s *sharedSessionStubs) writes() []cacheWrite {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]cacheWrite(nil), s.cacheWrites...)
}
