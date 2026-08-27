package idpsim

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeServiceProvider stands in for the application's SCIM endpoints: it takes
// creates, remembers them, and lists them back — enough for both halves of a
// provisioning run to be exercised against something that behaves like the
// receiving side rather than a recorder.
type fakeServiceProvider struct {
	mu       sync.Mutex
	requests []string
	tokens   []string
	users    []map[string]any
	groups   []map[string]any
	// refuse makes every request fail, which is how a target the simulator
	// cannot read is told apart from one holding nothing.
	refuse bool
}

func (f *fakeServiceProvider) start(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(server.Close)
	return server
}

func (f *fakeServiceProvider) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, r.Method+" "+r.URL.Path)
	f.tokens = append(f.tokens, r.Header.Get("Authorization"))
	if f.refuse {
		http.Error(w, "nope", http.StatusUnauthorized)
		return
	}
	collection := &f.users
	label := "userName"
	if strings.HasSuffix(r.URL.Path, "/Groups") {
		collection, label = &f.groups, "displayName"
	}
	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, map[string]any{"Resources": *collection})
		return
	}
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	created := map[string]any{"id": fmt.Sprintf("sp-%d", len(*collection)+1), label: body[label]}
	*collection = append(*collection, created)
	writeJSON(w, http.StatusCreated, created)
}

func (f *fakeServiceProvider) seen() ([]string, []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.requests...), append([]string(nil), f.tokens...)
}

func postForm(t *testing.T, s *Server, path string, form url.Values) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, testBase+path, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return do(s, req)
}

// connect points tenant 1 at a service provider through the control API.
func connect(t *testing.T, s *Server, base, token string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, testBase+"/control/t/1/scim-target",
		strings.NewReader(fmt.Sprintf(`{"baseUrl":%q,"token":%q}`, base, token)))
	rec := do(s, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

// provisioningOf reads a tenant's connection out of the state dump.
func provisioningOf(t *testing.T, s *Server) map[string]any {
	t.Helper()
	state := getJSON(t, s, "/control/state")
	tenant := state["tenants"].([]any)[0].(map[string]any)
	if tenant["provisioning"] == nil {
		return nil
	}
	return tenant["provisioning"].(map[string]any)
}

// @scenario "A tenant is given the address and token of the application it provisions into"
func TestProvisioningConnect(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	const token = "langwatch-scim-token-thirty-two-plus"

	// renderPage swallows template errors, which on a half-rendered page looks
	// like a missing panel rather than a fault — so the unconnected page is
	// checked for the form and for having run to the end.
	before := do(s, httptest.NewRequest(http.MethodGet, testBase+"/t/1/", nil))
	require.Equal(t, http.StatusOK, before.Code)
	assert.Contains(t, before.Body.String(), "Provision into LangWatch")
	assert.Contains(t, before.Body.String(), `action="`+tenant.BaseURL+`/provisioning"`)
	assert.True(t, strings.HasSuffix(strings.TrimSpace(before.Body.String()), "</html>"))

	// The endpoint somebody was last looking at works as well as the base.
	rec := postForm(t, s, "/t/1/provisioning", url.Values{
		"target": {"https://app.example.langwatch.localhost/api/scim/v2/Users"},
		"token":  {token},
	})
	require.Equal(t, http.StatusSeeOther, rec.Code, rec.Body.String())

	assert.Equal(t, ProvisioningTarget{
		BaseURL: "https://app.example.langwatch.localhost/api/scim/v2", Token: token,
	}, tenant.Provisioning())

	stored := provisioningOf(t, s)
	assert.Equal(t, "https://app.example.langwatch.localhost/api/scim/v2", stored["baseUrl"])
	shown := stored["token"].(string)
	assert.NotEqual(t, token, shown, "the whole token is not ours to hand back")
	assert.Contains(t, shown, token[:6], "enough of it to tell which one was pasted")

	page := do(s, httptest.NewRequest(http.MethodGet, testBase+"/t/1/", nil))
	assert.Contains(t, page.Body.String(), "app.example.langwatch.localhost/api/scim/v2")
	assert.NotContains(t, page.Body.String(), token)
	assert.True(t, strings.HasSuffix(strings.TrimSpace(page.Body.String()), "</html>"))

	refused := postForm(t, s, "/t/1/provisioning", url.Values{
		"target": {"app.example.langwatch.localhost"}, "token": {token},
	})
	assert.Equal(t, http.StatusBadRequest, refused.Code)
	assert.Contains(t, refused.Body.String(), "not an address this tenant can reach")
	assert.Equal(t, "https://app.example.langwatch.localhost/api/scim/v2",
		tenant.Provisioning().BaseURL, "a refused paste leaves the connection alone")
}

// @scenario "The tenant's own SCIM token is refused as the token to provision with"
func TestProvisioningRefusesTheTenantsOwnToken(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)

	rec := postForm(t, s, "/t/1/provisioning", url.Values{
		"target": {"https://app.example.langwatch.localhost/api/scim/v2"},
		"token":  {tenant.SCIMToken},
	})
	require.Equal(t, http.StatusBadRequest, rec.Code)
	body := rec.Body.String()
	// The page HTML-escapes apostrophes, so the assertions take the halves
	// without one rather than the escape sequence.
	assert.Contains(t, body, "token, not LangWatch")
	assert.Contains(t, body, "guards the simulator")
	assert.False(t, tenant.Provisioning().Configured())
}

// @scenario "A connected tenant pushes its directory without being told where again"
func TestProvisioningPushUsesTheConnection(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	tenant.AddGroup(&Group{ID: "g1", Name: "Everyone", MemberIDs: []string{"t1-user-admin"}})
	target := (&fakeServiceProvider{}).start(t)
	connect(t, s, target.URL+"/scim/v2", "langwatch-scim-token-thirty-two-plus")

	rec := postForm(t, s, "/t/1/provisioning/push", nil)
	require.Equal(t, http.StatusSeeOther, rec.Code, rec.Body.String())

	outcome := tenant.LastProvisioning()
	require.NotNil(t, outcome)
	assert.Equal(t, "push", outcome.Kind)
	assert.False(t, outcome.Refused)
	assert.Contains(t, outcome.Summary, "pushed 2 users and 1 group into ")

	feed := getJSON(t, s, "/control/t/1/activity")
	events := feed["events"].([]any)
	latest := events[0].(map[string]any)
	assert.Equal(t, "scim.push", latest["kind"])
	assert.Equal(t, OutcomeOK, latest["outcome"])
	assert.Contains(t, latest["detail"], "2 users and 1 group")
}

// @scenario "What the application ended up holding can be read back"
func TestProvisioningReadBack(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	tenant.AddGroup(&Group{ID: "g1", Name: "Everyone", MemberIDs: []string{"t1-user-admin"}})
	provider := &fakeServiceProvider{}
	target := provider.start(t)
	connect(t, s, target.URL+"/scim/v2", "langwatch-scim-token-thirty-two-plus")

	require.Equal(t, http.StatusSeeOther, postForm(t, s, "/t/1/provisioning/push", nil).Code)
	require.Equal(t, http.StatusSeeOther, postForm(t, s, "/t/1/provisioning/pull", nil).Code)

	outcome := tenant.LastProvisioning()
	require.NotNil(t, outcome)
	assert.Equal(t, "pull", outcome.Kind)
	assert.False(t, outcome.Refused)
	assert.Equal(t, []string{"admin@acme1.test", "member@acme1.test"}, outcome.Users)
	assert.Equal(t, []string{"Everyone"}, outcome.Groups)

	_, tokens := provider.seen()
	for _, token := range tokens {
		assert.Equal(t, "Bearer langwatch-scim-token-thirty-two-plus", token)
	}

	// A target that will not answer is not a target holding nothing.
	provider.mu.Lock()
	provider.refuse = true
	provider.mu.Unlock()
	require.Equal(t, http.StatusSeeOther, postForm(t, s, "/t/1/provisioning/pull", nil).Code)
	refusedOutcome := tenant.LastProvisioning()
	require.NotNil(t, refusedOutcome)
	assert.True(t, refusedOutcome.Refused)
	assert.Contains(t, refusedOutcome.Summary, "could not read")
	assert.Empty(t, refusedOutcome.Users)
}

// @scenario "Resetting a tenant's users does not forget where it provisions"
func TestProvisioningSurvivesReset(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	connect(t, s, "https://app.example.langwatch.localhost/api/scim/v2", "langwatch-scim-token-thirty-two-plus")

	rec := do(s, httptest.NewRequest(http.MethodPost, testBase+"/control/t/1/reset", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	assert.True(t, tenant.Provisioning().Configured())
	assert.Equal(t, "https://app.example.langwatch.localhost/api/scim/v2", tenant.Provisioning().BaseURL)
}
