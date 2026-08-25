package idpsim

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// registerApp registers a relying party through the JSON control API and
// returns the credentials it minted.
func registerApp(t *testing.T, s *Server, tenant int, body string) map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/control/t/%d/apps", testBase, tenant), strings.NewReader(body))
	rec := do(s, req)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	return out
}

// authorize drives one authorization request and returns the recorder, so a
// test can look at either the redirect or the refusal page.
func authorize(s *Server, tenant int, params url.Values) *httptest.ResponseRecorder {
	target := fmt.Sprintf("%s/t/%d/oauth/authorize?%s", testBase, tenant, params.Encode())
	return do(s, httptest.NewRequest(http.MethodGet, target, nil))
}

// exchange posts one token request.
func exchange(s *Server, tenant int, form url.Values) (int, map[string]any) {
	req := httptest.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/t/%d/oauth/token", testBase, tenant), strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := do(s, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// @scenario "Registering an application hands back what the setup wizard asks for"
func TestRegisterApplicationReturnsWizardValues(t *testing.T) {
	s := newTestServer(t, 1)
	first := registerApp(t, s, 1, `{"name":"LangWatch","redirectUris":["https://app.example/cb"]}`)

	assert.Equal(t, "LangWatch", first["name"])
	assert.Equal(t, testBase+"/t/1", first["issuer"], "the issuer address is the tenant's own")
	assert.NotEmpty(t, first["clientId"])
	assert.NotEmpty(t, first["clientSecret"])

	second := registerApp(t, s, 1, `{"name":"LangWatch staging","redirectUris":["https://staging.example/cb"]}`)
	assert.NotEqual(t, first["clientId"], second["clientId"])
	assert.NotEqual(t, first["clientSecret"], second["clientSecret"])
}

// The address LangWatch shows before a connection exists carries a
// {connection} placeholder, and the real id only appears once the connection
// has been created — which cannot happen until the identity provider is set
// up. Registering the address exactly as shown has to work, or the two systems
// deadlock waiting for each other.
//
// @scenario "A redirect address can be registered before the connection exists"
func TestPlaceholderRedirectMatchesRealConnection(t *testing.T) {
	s := newTestServer(t, 1)
	app := registerApp(t, s, 1,
		`{"name":"LangWatch","redirectUris":["https://app.example/api/auth/sso/callback/{connection}"]}`)
	clientID := app["clientId"].(string)

	params := func(redirect string) url.Values {
		return url.Values{
			"response_type": {"code"}, "client_id": {clientID},
			"redirect_uri": {redirect}, "login_hint": {"admin@acme1.test"},
		}
	}

	t.Run("when a real connection id fills the placeholder", func(t *testing.T) {
		rec := authorize(s, 1, params("https://app.example/api/auth/sso/callback/ssoc_2xR9"))
		require.Equal(t, http.StatusFound, rec.Code, rec.Body.String())
		loc, err := url.Parse(rec.Header().Get("Location"))
		require.NoError(t, err)
		assert.NotEmpty(t, loc.Query().Get("code"))
	})

	t.Run("when the rest of the address differs, it is still refused", func(t *testing.T) {
		rec := authorize(s, 1, params("https://evil.example/api/auth/sso/callback/ssoc_2xR9"))
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("when the placeholder segment is empty, it is refused", func(t *testing.T) {
		rec := authorize(s, 1, params("https://app.example/api/auth/sso/callback/"))
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})
}

// @scenario "A registered application must present its client secret"
func TestRegisteredClientMustPresentItsSecret(t *testing.T) {
	s := newTestServer(t, 1)
	app := registerApp(t, s, 1, `{"name":"LangWatch","redirectUris":["https://app.example/cb"]}`)
	clientID, secret := app["clientId"].(string), app["clientSecret"].(string)

	rec := authorize(s, 1, url.Values{
		"response_type": {"code"}, "client_id": {clientID},
		"redirect_uri": {"https://app.example/cb"}, "login_hint": {"admin@acme1.test"},
	})
	require.Equal(t, http.StatusFound, rec.Code)
	loc, _ := url.Parse(rec.Header().Get("Location"))
	code := loc.Query().Get("code")
	require.NotEmpty(t, code)

	form := url.Values{
		"grant_type": {"authorization_code"}, "code": {code},
		"client_id": {clientID}, "redirect_uri": {"https://app.example/cb"},
	}

	t.Run("when the secret is wrong", func(t *testing.T) {
		wrong := url.Values{"client_secret": {"not-the-secret"}}
		for k, v := range form {
			wrong[k] = v
		}
		status, body := exchange(s, 1, wrong)
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, "invalid_client", body["error"])
	})

	// The code must survive a failed client authentication: burning it would
	// turn one clear "wrong secret" into a second, misleading "already used".
	t.Run("when the secret is then right, the code is still good", func(t *testing.T) {
		right := url.Values{"client_secret": {secret}}
		for k, v := range form {
			right[k] = v
		}
		status, body := exchange(s, 1, right)
		require.Equal(t, http.StatusOK, status, body)
		assert.NotEmpty(t, body["id_token"])
	})
}

// @scenario "A registered application may only be sent back to a registered address"
func TestRegisteredClientRedirectIsEnforced(t *testing.T) {
	s := newTestServer(t, 1)
	app := registerApp(t, s, 1, `{"name":"LangWatch","redirectUris":["https://app.example/cb"]}`)
	clientID := app["clientId"].(string)

	rec := authorize(s, 1, url.Values{
		"response_type": {"code"}, "client_id": {clientID},
		"redirect_uri": {"https://elsewhere.example/cb"}, "login_hint": {"admin@acme1.test"},
	})

	// Never bounced to the unregistered address: that is the one move a real
	// identity provider must refuse, and a page explaining it is more use.
	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Empty(t, rec.Header().Get("Location"))
	body := rec.Body.String()
	assert.Contains(t, body, "LangWatch")
	assert.Contains(t, body, "https://elsewhere.example/cb")
}

// @scenario "A client the tenant does not know still works"
func TestUnregisteredClientStillWorks(t *testing.T) {
	s := newTestServer(t, 1)
	registerApp(t, s, 1, `{"name":"LangWatch","redirectUris":["https://app.example/cb"]}`)

	out := completeCodeFlow(t, s, nil, nil) // client_id "test-client", registered nowhere
	assert.Equal(t, http.StatusOK, out["_status"], out)
	assert.NotEmpty(t, out["id_token"])
}

// The verification DNS listener wants a fixed port so a resolver can be
// pointed at it, which is exactly what makes it collidable — a second stack, or
// an earlier run that outlived its parent. Losing DNS costs the DNS half of
// domain verification; refusing to start costs OIDC, SAML, SCIM and the HTTP
// half as well, which is the worse trade every time.
//
// @scenario "A busy verification DNS port does not stop the simulator"
func TestBusyDNSPortDoesNotStopTheSimulator(t *testing.T) {
	var lc net.ListenConfig
	busy, err := lc.ListenPacket(t.Context(), "udp", "127.0.0.1:0")
	require.NoError(t, err)
	defer func() { _ = busy.Close() }()

	s, err := NewServer(Config{
		Addr: "127.0.0.1:0", BaseURL: testBase, Tenants: 1,
		DNSAddr: busy.LocalAddr().String(),
	})
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	errCh := make(chan error, 1)
	go func() { errCh <- s.Serve(ctx) }()

	select {
	case err := <-errCh:
		t.Fatalf("the simulator refused to start because the DNS port was busy: %v", err)
	case <-time.After(250 * time.Millisecond):
	}
	assert.NotEmpty(t, s.DNSAddr(), "it should say where it put the DNS listener instead")
	assert.NotEqual(t, busy.LocalAddr().String(), s.DNSAddr())

	cancel()
	assert.NoError(t, <-errCh)
}

// activityOf reads a tenant's feed through the control API.
func activityOf(t *testing.T, s *Server, tenant int) []map[string]any {
	t.Helper()
	doc := getJSON(t, s, fmt.Sprintf("/control/t/%d/activity", tenant))
	raw, _ := doc["events"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, ev := range raw {
		out = append(out, ev.(map[string]any))
	}
	return out
}

func findEvent(events []map[string]any, kind string) (map[string]any, bool) {
	for _, ev := range events {
		if ev["kind"] == kind {
			return ev, true
		}
	}
	return nil, false
}

// @scenario "A tenant records what it has been asked to do"
func TestTenantActivityRecordsWhatHappened(t *testing.T) {
	s := newTestServer(t, 1)
	app := registerApp(t, s, 1, `{"name":"LangWatch","redirectUris":["https://app.example/cb"]}`)
	clientID := app["clientId"].(string)

	rec := authorize(s, 1, url.Values{
		"response_type": {"code"}, "client_id": {clientID},
		"redirect_uri": {"https://app.example/cb"}, "login_hint": {"admin@acme1.test"},
	})
	require.Equal(t, http.StatusFound, rec.Code)
	loc, _ := url.Parse(rec.Header().Get("Location"))
	exchange(s, 1, url.Values{
		"grant_type": {"authorization_code"}, "code": {loc.Query().Get("code")},
		"client_id": {clientID}, "client_secret": {"wrong"},
	})

	events := activityOf(t, s, 1)
	require.NotEmpty(t, events)

	t.Run("lists the successful authorization", func(t *testing.T) {
		ev, ok := findEvent(events, "oidc.authorize")
		require.True(t, ok, "no authorize event in %v", events)
		assert.Equal(t, OutcomeOK, ev["outcome"])
		assert.Equal(t, "admin@acme1.test", ev["subject"])
		assert.Contains(t, ev["detail"], "admin@acme1.test")
	})

	t.Run("lists the refusal with its reason", func(t *testing.T) {
		ev, ok := findEvent(events, "oidc.token")
		require.True(t, ok, "no token event in %v", events)
		assert.Equal(t, OutcomeRefused, ev["outcome"])
		assert.Contains(t, ev["detail"], "secret")
	})

	t.Run("is newest-first", func(t *testing.T) {
		assert.Equal(t, "oidc.token", events[0]["kind"],
			"the most recent thing that happened must be at the top")
	})
}

// @scenario "Directory and domain-verification traffic is recorded too"
func TestActivityCoversDirectoryAndVerification(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)

	created := do(s, scimRequest(http.MethodPost, "/t/1/scim/v2/Users", tenant.SCIMToken,
		`{"userName":"newhire@acme1.test"}`))
	require.Equal(t, http.StatusCreated, created.Code)

	fetched := do(s, httptest.NewRequest(http.MethodGet,
		"http://acme1.test/.well-known/langwatch-verification.txt", nil))
	require.Equal(t, http.StatusOK, fetched.Code)

	events := activityOf(t, s, 1)
	scim, ok := findEvent(events, "scim.user.create")
	require.True(t, ok, "no SCIM event in %v", events)
	assert.Contains(t, scim["detail"], "newhire@acme1.test")

	verification, ok := findEvent(events, "verification.http")
	require.True(t, ok, "no verification event in %v", events)
	assert.Equal(t, OutcomeOK, verification["outcome"])
}

// The tenant page is the thing a developer actually opens, so it has to carry
// the values the setup wizard asks to have pasted into it.
//
// @scenario "Registering an application hands back what the setup wizard asks for"
func TestTenantPageCarriesTheSetupValues(t *testing.T) {
	s := newTestServer(t, 1)
	app := registerApp(t, s, 1, `{"name":"LangWatch","redirectUris":["https://app.example/cb"]}`)

	rec := do(s, httptest.NewRequest(http.MethodGet, testBase+"/t/1/", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	body := rec.Body.String()

	for _, want := range []string{
		"Issuer address", testBase + "/t/1", // OIDC
		"Sign-in address", testBase + "/t/1/saml/sso", // SAML
		"Entity id", "Signing certificate",
		app["clientId"].(string), app["clientSecret"].(string),
		"admin@acme1.test", // its users
		"Activity",         // the live feed
		"{connection}",     // the placeholder explanation
	} {
		assert.Contains(t, body, want)
	}
}
