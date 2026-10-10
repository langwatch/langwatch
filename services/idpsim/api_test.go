package idpsim

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// apiRequest sends the console's JSON the way the app's fetch does.
func apiRequest(s *Server, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, testBase+path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	return do(s, req)
}

// The landing page's words and order are the console's (apps/idpsim-web); what
// the simulator owes it is the machine's own address and the tenant list.
//
// @scenario "The landing page says what to do before it lists the providers"
func TestIndexCarriesTheMachinesAddresses(t *testing.T) {
	s := newTestServer(t, 3)

	page := do(s, httptest.NewRequest(http.MethodGet, testBase+"/", nil))
	require.Equal(t, http.StatusOK, page.Code)
	assert.Contains(t, page.Body.String(), "idpsim console")

	index := getJSON(t, s, "/api/tenants")
	assert.Equal(t, testBase, index["baseUrl"], "the base address is there to copy")
	tenants := index["tenants"].([]any)
	require.Len(t, tenants, 3)
	first := tenants[0].(map[string]any)
	assert.InDelta(t, 1, first["id"], 0)
	assert.Equal(t, testBase+"/t/1", first["baseUrl"])
	assert.Equal(t, "acme1.test", first["domain"])
}

// @scenario "A provider that already has an application registered is marked as such"
func TestIndexCountsRegisteredApplications(t *testing.T) {
	s := newTestServer(t, 2)
	rec := apiRequest(s, http.MethodPost, "/api/t/2/apps", `{"name":"LangWatch","redirectUris":["`+testBase+`/cb"]}`)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())

	tenants := getJSON(t, s, "/api/tenants")["tenants"].([]any)
	assert.InDelta(t, 0, tenants[0].(map[string]any)["applications"], 0)
	assert.InDelta(t, 1, tenants[1].(map[string]any)["applications"], 0)
}

func TestRegisteringFromThePageReturnsTheCredentials(t *testing.T) {
	s := newTestServer(t, 1)
	rec := apiRequest(s, http.MethodPost, "/api/t/1/apps",
		`{"name":" LangWatch ","redirectUris":["https://app.example/cb\nhttps://app.example/cb2",""]}`)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	var app Application
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &app))
	assert.Equal(t, "LangWatch", app.Name)
	assert.NotEmpty(t, app.Secret)
	assert.Equal(t, []string{"https://app.example/cb", "https://app.example/cb2"}, app.RedirectURIs)

	refused := apiRequest(s, http.MethodPost, "/api/t/1/apps", `{"name":"  "}`)
	require.Equal(t, http.StatusBadRequest, refused.Code)
	assert.Contains(t, refused.Body.String(), "That application needs a name")

	removed := apiRequest(s, http.MethodDelete, "/api/t/1/apps/"+app.ClientID, "")
	require.Equal(t, http.StatusNoContent, removed.Code)
	tenant, _ := s.Tenant(1)
	assert.Empty(t, tenant.Applications(), "the refused one was never registered and the other is gone")
}

func TestPageActsRefuseInThePagesTerms(t *testing.T) {
	s := newTestServer(t, 1)

	for _, test := range []struct {
		name, method, path, body, title string
		status                          int
	}{
		{"an unknown tenant", http.MethodGet, "/api/t/9", "", "There is no tenant 9", http.StatusNotFound},
		{"a body that is not JSON", http.MethodPost, "/api/t/1/population", "users=5", "That request could not be read", http.StatusBadRequest},
		{"an oversized directory", http.MethodPost, "/api/t/1/population", `{"users":50001,"groups":6}`, "That is not a directory this simulator will generate", http.StatusBadRequest},
		{"a churn of nothing", http.MethodPost, "/api/t/1/churn", `{"join":0,"leave":-3}`, "Nothing to change", http.StatusBadRequest},
		{"a push with nowhere to go", http.MethodPost, "/api/t/1/provisioning/sync", "", "This tenant is not provisioning anywhere yet", http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			rec := apiRequest(s, test.method, test.path, test.body)
			require.Equal(t, test.status, rec.Code, rec.Body.String())
			var notice refusalNotice
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &notice))
			assert.Equal(t, test.title, notice.Title)
			assert.NotEmpty(t, notice.Hint, "a refusal says what to go and change")
		})
	}
}

func TestPopulationFromThePageKeepsANote(t *testing.T) {
	s := newTestServer(t, 1)
	rec := apiRequest(s, http.MethodPost, "/api/t/1/population", `{"users":40,"groups":3}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var scale scaleView
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &scale))
	assert.Equal(t, "generated 40 users across 3 groups", scale.Last)

	churned := apiRequest(s, http.MethodPost, "/api/t/1/churn", `{"deactivate":5}`)
	require.Equal(t, http.StatusOK, churned.Code, churned.Body.String())
	require.NoError(t, json.Unmarshal(churned.Body.Bytes(), &scale))
	assert.Contains(t, scale.Last, "5 deactivated")

	view := getJSON(t, s, "/api/t/1")
	assert.Equal(t, scale.Last, view["scale"].(map[string]any)["last"], "the note survives a reload")
}

func TestConsoleIsServedAtThePagesPaths(t *testing.T) {
	s := newTestServer(t, 1)

	for _, path := range []string{"/", "/t/1", "/t/1/"} {
		rec := do(s, httptest.NewRequest(http.MethodGet, testBase+path, nil))
		assert.Equal(t, http.StatusOK, rec.Code, path)
		assert.Contains(t, rec.Body.String(), "idpsim console", path)
	}

	unknown := do(s, httptest.NewRequest(http.MethodGet, testBase+"/t/7/", nil))
	assert.Equal(t, http.StatusNotFound, unknown.Code, "a tenant that does not exist says so in its status")
	assert.Contains(t, unknown.Body.String(), "idpsim console")

	missingAPI := do(s, httptest.NewRequest(http.MethodGet, testBase+"/api/nothing", nil))
	assert.Equal(t, http.StatusNotFound, missingAPI.Code)
	assert.NotContains(t, missingAPI.Body.String(), "idpsim console")
}

func TestUnbuiltConsoleNamesTheBuildCommand(t *testing.T) {
	s, err := newServer(Config{Addr: ":0", BaseURL: testBase, Tenants: 1}, fstest.MapFS{})
	require.NoError(t, err)

	page := do(s, httptest.NewRequest(http.MethodGet, testBase+"/", nil))
	assert.Equal(t, http.StatusServiceUnavailable, page.Code)
	assert.Contains(t, page.Body.String(), consoleBuildCommand)

	// A refused authorize still refuses in its status line without a bundle.
	app := registerApp(t, s, 1, `{"name":"LangWatch","redirectUris":["https://app.example/cb"]}`)
	refused := do(s, httptest.NewRequest(http.MethodGet, testBase+"/t/1/oauth/authorize?response_type=code&client_id="+
		app["clientId"].(string)+"&redirect_uri=https://elsewhere.example/cb", nil))
	assert.Equal(t, http.StatusBadRequest, refused.Code)
	assert.Contains(t, refused.Body.String(), consoleBuildCommand)
}
