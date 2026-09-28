package idpsim

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func persistentServer(t *testing.T, dir string, count int) *Server {
	t.Helper()
	s, err := NewServer(Config{BaseURL: testBase, Tenants: count, DataDir: dir})
	require.NoError(t, err)
	s.now = func() time.Time { return time.Unix(1_700_000_000, 0).UTC() }
	return s
}

func stateRequest(t *testing.T, s *Server, method, path, body string, status int) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, testBase+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer idpsim-scim-token-1")
	rec := do(s, req)
	require.Equal(t, status, rec.Code, rec.Body.String())
	return rec
}

// @scenario "IdP setup and directory changes survive a simulator restart"
func TestStateSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	s := persistentServer(t, dir, 2)
	registration := stateRequest(t, s, "POST", "/control/t/1/apps",
		`{"name":"LangWatch","redirectUris":["https://app.example/callback"]}`, http.StatusCreated)
	var app Application
	require.NoError(t, json.Unmarshal(registration.Body.Bytes(), &app))
	stateRequest(t, s, "POST", "/control/t/1/users", `{"id":"custom-user","email":"someone@acme1.test"}`, http.StatusCreated)
	stateRequest(t, s, "POST", "/t/1/scim/v2/Groups",
		`{"displayName":"Engineering","members":[{"value":"custom-user"}]}`, http.StatusCreated)
	stateRequest(t, s, "PATCH", "/t/1/scim/v2/Users/t1-user-member",
		`{"Operations":[{"op":"replace","path":"active","value":false}]}`, http.StatusOK)
	stateRequest(t, s, "PUT", "/control/t/1/scim-target",
		`{"baseUrl":"https://app.example/scim/v2","token":"application-issued-secret"}`, http.StatusOK)
	stateRequest(t, s, "POST", "/control/t/1/config", `{"samlpSubjects":true}`, http.StatusOK)
	stateRequest(t, s, "PUT", "/control/dns/txt", `{"domain":"_proof.acme1.test","values":["my-proof"]}`, http.StatusOK)
	stateRequest(t, s, "PUT", "/control/verification", `{"domain":"acme1.test","token":"my-proof"}`, http.StatusOK)
	before := getJSON(t, s, "/control/state")
	keys := getJSON(t, s, "/t/1/oauth/jwks")
	tenant, _ := s.Tenant(1)
	certificate := tenant.CertificatePEM()

	// No shutdown/save call: acknowledged writes must already be on disk.
	restarted := persistentServer(t, dir, 2)
	assert.Equal(t, before, getJSON(t, restarted, "/control/state"))
	assert.Equal(t, keys, getJSON(t, restarted, "/t/1/oauth/jwks"))
	reloaded, _ := restarted.Tenant(1)
	assert.Equal(t, certificate, reloaded.CertificatePEM())
	assert.Equal(t, tenant.Provisioning(), reloaded.Provisioning())
	assert.Equal(t, tenant.Activity(), reloaded.Activity())
	result := completeCodeFlow(t, restarted, url.Values{
		"client_id": {app.ClientID}, "redirect_uri": {"https://app.example/callback"},
	}, url.Values{"client_id": {app.ClientID}, "client_secret": {app.Secret}})
	assert.Equal(t, http.StatusOK, result["_status"], result)
	info, err := os.Stat(filepath.Join(dir, "state.json"))
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
}

// @scenario "Deleted IdP state stays deleted after restarting"
func TestDeletedStateStaysDeleted(t *testing.T) {
	dir := t.TempDir()
	s := persistentServer(t, dir, 1)
	registration := stateRequest(t, s, "POST", "/control/t/1/apps", `{"name":"temporary"}`, http.StatusCreated)
	var app Application
	require.NoError(t, json.Unmarshal(registration.Body.Bytes(), &app))
	stateRequest(t, s, "POST", "/t/1/apps/"+app.ClientID+"/delete", "", http.StatusSeeOther)
	stateRequest(t, s, "DELETE", "/t/1/scim/v2/Users/t1-user-member", "", http.StatusNoContent)
	stateRequest(t, s, "DELETE", "/control/dns/txt", `{"domain":"acme1.test"}`, http.StatusNoContent)
	stateRequest(t, s, "DELETE", "/control/verification", `{"domain":"acme1.test"}`, http.StatusNoContent)
	restarted := persistentServer(t, dir, 1)
	tenant, _ := restarted.Tenant(1)
	assert.Empty(t, tenant.Applications())
	assert.Len(t, tenant.Users(), 1)
	_, present := restarted.verification.TXT("acme1.test")
	assert.False(t, present)
	_, present = restarted.verification.Token("acme1.test")
	assert.False(t, present)
	stateRequest(t, restarted, "POST", "/control/t/1/reset", "", http.StatusOK)
	afterReset := persistentServer(t, dir, 1)
	resetTenant, _ := afterReset.Tenant(1)
	assert.Len(t, resetTenant.Users(), 2)
}

// @scenario "Temporarily reducing the IdP tenant range preserves hidden tenants"
func TestTenantRangePreservesState(t *testing.T) {
	dir := t.TempDir()
	s := persistentServer(t, dir, 2)
	stateRequest(t, s, "POST", "/control/t/2/apps", `{"name":"second tenant"}`, http.StatusCreated)
	second, _ := s.Tenant(2)
	reduced := persistentServer(t, dir, 1)
	_, exists := reduced.Tenant(2)
	assert.False(t, exists)
	stateRequest(t, reduced, "POST", "/control/t/1/users", `{"email":"extra@acme1.test"}`, http.StatusCreated)
	expanded := persistentServer(t, dir, 3)
	restored, _ := expanded.Tenant(2)
	assert.Equal(t, second.Applications(), restored.Applications())
	assert.Equal(t, second.CertificatePEM(), restored.CertificatePEM())
	third, exists := expanded.Tenant(3)
	require.True(t, exists)
	assert.Len(t, third.Users(), 2)
	assert.Equal(t, "http://idp.example/t/3", third.BaseURL)
	newOrigin, err := NewServer(Config{DataDir: dir, Tenants: 3, BaseURL: "https://new-port.example:1355"})
	require.NoError(t, err)
	assert.Equal(t, "https://new-port.example:1355/t/1", getJSON(t, newOrigin, "/t/1/.well-known/openid-configuration")["issuer"])
}

// @scenario "Unreadable IdP state is refused without reseeding over it"
func TestInvalidStateRefusesStartup(t *testing.T) {
	for _, raw := range []string{`{`, `{"version":99}`, `{"version":1,"tenants":[{}],"txt":{},"tokens":{}}`} {
		t.Run(raw, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "state.json")
			require.NoError(t, os.WriteFile(path, []byte(raw), 0o600))
			_, err := NewServer(Config{DataDir: dir, Tenants: 1, BaseURL: testBase})
			require.Error(t, err)
			after, err := os.ReadFile(path)
			require.NoError(t, err)
			assert.Equal(t, raw, string(after))
		})
	}
}

// @scenario "An IdP change is not acknowledged when it cannot be saved"
func TestStateWriteFailureRefusesSuccess(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "idp")
	s := persistentServer(t, dir, 1)
	require.NoError(t, os.Rename(dir, dir+"-offline"))
	stateRequest(t, s, "POST", "/control/t/1/apps", `{"name":"unsaved"}`, http.StatusInternalServerError)
	previous := persistentServer(t, dir+"-offline", 1)
	tenant, _ := previous.Tenant(1)
	assert.Empty(t, tenant.Applications())
}

func TestConcurrentChangesSurviveRestart(t *testing.T) {
	dir := t.TempDir()
	s := persistentServer(t, dir, 1)
	var pending sync.WaitGroup
	for i := range 10 {
		pending.Go(func() {
			req := httptest.NewRequest(http.MethodPost, testBase+"/control/t/1/users",
				strings.NewReader(fmt.Sprintf(`{"email":"person%d@acme1.test"}`, i)))
			assert.Equal(t, http.StatusCreated, do(s, req).Code)
			patch := httptest.NewRequest(http.MethodPatch, testBase+"/t/1/scim/v2/Users/t1-user-member",
				strings.NewReader(`{"Operations":[{"op":"replace","path":"active","value":false}]}`))
			patch.Header.Set("Authorization", "Bearer idpsim-scim-token-1")
			assert.Equal(t, http.StatusOK, do(s, patch).Code)
		})
	}
	pending.Wait()
	restored := persistentServer(t, dir, 1)
	tenant, _ := restored.Tenant(1)
	assert.Len(t, tenant.Users(), 12)
	member, found := tenant.UserByID("t1-user-member")
	require.True(t, found)
	assert.False(t, member.Active)
}

func TestLoadConfigIncludesStateDirectory(t *testing.T) {
	t.Setenv("IDPSIM_DATA_DIR", t.TempDir())
	cfg, err := LoadConfig()
	require.NoError(t, err)
	assert.Equal(t, os.Getenv("IDPSIM_DATA_DIR"), cfg.DataDir)
}
