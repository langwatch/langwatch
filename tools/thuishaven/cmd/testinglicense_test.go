package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	testCloudToken = "tlt-personal-secret-token-0001"
	testServiceKey = "tlt-service-secret-token-0002"
	testLicenseKey = "eyJ.test-license-key.secret"
	testSession    = "session-cookie-secret"
)

// fakeCloud stands in for LangWatch Cloud's testing-license issuing route.
type fakeCloud struct {
	srv       *httptest.Server
	mu        sync.Mutex
	auths     []string
	bodies    []map[string]any
	status    int
	code      string
	expiresAt time.Time
}

func newFakeCloud(t *testing.T) *fakeCloud {
	t.Helper()
	c := &fakeCloud{expiresAt: time.Now().Add(5 * 24 * time.Hour).UTC().Truncate(time.Second)}
	c.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.mu.Lock()
		defer c.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/api/licensing/testing-licenses" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		c.auths = append(c.auths, r.Header.Get("Authorization"))
		c.bodies = append(c.bodies, body)
		if c.status != 0 && c.status != http.StatusCreated {
			w.WriteHeader(c.status)
			_, _ = w.Write([]byte(`{"code":"` + c.code + `"}`))
			return
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"licenseKey":"` + testLicenseKey + `","issuedLicenseId":"il_1","expiresAt":"` + c.expiresAt.Format(time.RFC3339Nano) + `"}`))
	}))
	t.Cleanup(c.srv.Close)
	return c
}

func (c *fakeCloud) asked() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.auths)
}

// fakeLicenseStack stands in for a local stack's sign-in and the tRPC procedures haven calls.
type fakeLicenseStack struct {
	srv       *httptest.Server
	mu        sync.Mutex
	hits      int
	uploaded  []map[string]any
	held      bool
	expiresAt string
}

func newFakeStack(t *testing.T) *fakeLicenseStack {
	t.Helper()
	s := &fakeLicenseStack{}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.hits++
		w.Header().Set("Content-Type", "application/json")
		answer := func(data string) { _, _ = w.Write([]byte(`{"result":{"data":` + data + `}}`)) }
		if r.URL.Path == "/api/auth/sign-in/email" {
			http.SetCookie(w, &http.Cookie{Name: "session", Value: testSession, Path: "/"})
			_, _ = w.Write([]byte(`{}`))
			return
		}
		if cookie, err := r.Cookie("session"); err != nil || cookie.Value != testSession {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"UNAUTHORIZED"}}`))
			return
		}
		switch r.URL.Path {
		case "/api/trpc/organization.getAll":
			answer(`[{"id":"org_other","slug":"someone-else"},{"id":"org_local","slug":"local-dev-org"}]`)
		case "/api/trpc/license.getInstanceId":
			answer(`{"instanceId":"inst_local"}`)
		case "/api/trpc/license.getStatus":
			if !s.held {
				answer(`{"hasLicense":false,"valid":false}`)
				return
			}
			answer(`{"hasLicense":true,"valid":true,"connected":false,"plan":"enterprise","planName":"Enterprise","organizationName":"Local","expiresAt":"` + s.expiresAt + `"}`)
		case "/api/trpc/license.upload":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			s.uploaded = append(s.uploaded, body)
			answer(`{"success":true,"planInfo":{}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(s.srv.Close)
	return s
}

func (s *fakeLicenseStack) requests() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.hits
}

func (s *fakeLicenseStack) uploads() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]map[string]any(nil), s.uploaded...)
}

func newTestLicenser(stack *fakeLicenseStack, state cloudState, env map[string]string, out *bytes.Buffer) testingLicenser {
	return testingLicenser{
		state:  state,
		getenv: func(key string) string { return env[key] },
		now:    time.Now,
		sleep:  func(context.Context, time.Duration) error { return nil },
		out:    out,
		stack:  licenseStack{Slug: "feat-x", App: stack.srv.URL, Email: "admin@mail.langwatch.localhost", Password: "dev-password"},
	}
}

func writeTestLogin(t *testing.T, state cloudState, cloudURL, token string) {
	t.Helper()
	login := cloudLogin{CloudURL: cloudURL, Token: token, ExpiresAt: time.Now().Add(72 * time.Hour)}
	if err := state.write(state.loginPath(), login); err != nil {
		t.Fatal(err)
	}
}

func writeTestHeld(t *testing.T, state cloudState, expires time.Time) heldLicense {
	t.Helper()
	held := heldLicense{OrganizationID: "org_local", InstanceID: "inst_local", IssuedLicenseID: "il_0", LifetimeHours: 48, ExpiresAt: expires.UTC().Truncate(time.Second)}
	if err := state.write(state.heldPath("feat-x"), held); err != nil {
		t.Fatal(err)
	}
	return held
}

// @scenario "haven asks for a testing license only when told to"
func TestHavenContactsNobodyUnlessAskedOrHoldingALicense(t *testing.T) {
	cloud, stack := newFakeCloud(t), newFakeStack(t)
	t.Setenv("LANGWATCH_PORTLESS_HOME", t.TempDir())
	t.Setenv(testingLicenseTokenKnob, testServiceKey)
	t.Setenv(cloudURLKnob, cloud.srv.URL)

	plain, err := parse(specByName(t, "up"), nil)
	if err != nil {
		t.Fatal(err)
	}
	testingLicenseAfterUp(context.Background(), deps{target: "feat-x"}, plain)()

	if cloud.asked() != 0 || stack.requests() != 0 {
		t.Errorf("a plain up with a token to hand contacted Cloud %d times and the stack %d times", cloud.asked(), stack.requests())
	}
	for _, args := range [][]string{{"--testing-license"}, {"--testing-license=36h"}} {
		inv, err := parse(specByName(t, "up"), args)
		if err != nil || !inv.has("--testing-license") {
			t.Fatalf("up %v did not parse as asking for a license: %v", args, err)
		}
	}
	bare, _ := parse(specByName(t, "up"), []string{"--testing-license", "+llm"})
	if bare.value("--testing-license") != "" || len(bare.args) != 1 || bare.args[0] != "+llm" {
		t.Errorf("a bare --testing-license took the next argument: flags %v args %v", bare.flags, bare.args)
	}
}

// @scenario "Signing haven in once is enough"
func TestSignedInHavenStoresTheLicenseWithoutPrintingTheToken(t *testing.T) {
	cloud, stack := newFakeCloud(t), newFakeStack(t)
	state, out := cloudState{dir: t.TempDir()}, &bytes.Buffer{}
	writeTestLogin(t, state, cloud.srv.URL, testCloudToken)

	if err := newTestLicenser(stack, state, nil, out).ask(context.Background(), 0); err != nil {
		t.Fatal(err)
	}

	if cloud.asked() != 1 || cloud.auths[0] != "Bearer "+testCloudToken {
		t.Fatalf("Cloud was asked %d times with %v, want once with the stored token", cloud.asked(), cloud.auths)
	}
	if body := cloud.bodies[0]; body["instanceId"] != "inst_local" || body["organizationId"] != "org_local" || body["lifetimeHours"] != nil {
		t.Errorf("Cloud was asked for %v, want the stack's instance and its local organization, default lifetime", body)
	}
	uploads := stack.uploads()
	if len(uploads) != 1 || uploads[0]["licenseKey"] != testLicenseKey || uploads[0]["organizationId"] != "org_local" {
		t.Errorf("the stack received %v, want the issued key for the local organization", uploads)
	}
	held, ok, err := state.held("feat-x")
	if err != nil || !ok || !held.ExpiresAt.Equal(cloud.expiresAt) || held.InstanceID != "inst_local" {
		t.Errorf("haven recorded %+v (found %v, err %v), want the issued license's expiry and instance", held, ok, err)
	}
	for _, secret := range []string{testCloudToken, testLicenseKey, testSession} {
		if strings.Contains(out.String(), secret) {
			t.Errorf("haven printed a secret: %q", out.String())
		}
	}
}

// @scenario "Signing haven in once is enough"
func TestAskedLifetimeReachesCloudInWholeHours(t *testing.T) {
	cloud, stack := newFakeCloud(t), newFakeStack(t)
	state := cloudState{dir: t.TempDir()}
	writeTestLogin(t, state, cloud.srv.URL, testCloudToken)

	lifetime, err := parseLifetime("36h")
	if err != nil {
		t.Fatal(err)
	}
	if err := newTestLicenser(stack, state, nil, &bytes.Buffer{}).ask(context.Background(), lifetime); err != nil {
		t.Fatal(err)
	}
	if hours, _ := cloud.bodies[0]["lifetimeHours"].(float64); hours != 36 {
		t.Errorf("Cloud was asked for %v hours, want 36", cloud.bodies[0]["lifetimeHours"])
	}
	if days, err := parseLifetime("5d"); err != nil || days != 120*time.Hour {
		t.Errorf("5d parsed as %v, %v, want 120h", days, err)
	}
	if _, err := parseLifetime("soon"); err == nil {
		t.Error("a lifetime that is no duration was accepted")
	}
}

// @scenario "haven renews a testing license before it expires"
func TestRenewalAsksForTheSameInstanceBeforeTheLicenseEnds(t *testing.T) {
	cloud, stack := newFakeCloud(t), newFakeStack(t)
	state, out := cloudState{dir: t.TempDir()}, &bytes.Buffer{}
	writeTestLogin(t, state, cloud.srv.URL, testCloudToken)
	held := writeTestHeld(t, state, time.Now().Add(2*time.Hour))
	stack.held, stack.expiresAt = true, held.ExpiresAt.Format(time.RFC3339Nano)

	if err := newTestLicenser(stack, state, nil, out).renew(context.Background()); err != nil {
		t.Fatal(err)
	}

	if cloud.asked() != 1 || cloud.bodies[0]["instanceId"] != "inst_local" || cloud.bodies[0]["organizationId"] != "org_local" {
		t.Fatalf("renewal asked Cloud %d times for %v, want once for the same instance and organization", cloud.asked(), cloud.bodies)
	}
	if hours, _ := cloud.bodies[0]["lifetimeHours"].(float64); hours != 48 {
		t.Errorf("renewal asked for %v hours, want the 48 the first license had", cloud.bodies[0]["lifetimeHours"])
	}
	if len(stack.uploads()) != 1 {
		t.Errorf("the stack received %d licenses, want the renewed one", len(stack.uploads()))
	}
	renewed, _, _ := state.held("feat-x")
	if !renewed.ExpiresAt.Equal(cloud.expiresAt) {
		t.Errorf("haven recorded %v, want the new license's expiry %v", renewed.ExpiresAt, cloud.expiresAt)
	}
}

// @scenario "haven renews a testing license before it expires"
func TestRenewalLeavesAFreshOrForeignLicenseAlone(t *testing.T) {
	for name, tc := range map[string]struct {
		ends     time.Duration
		recorded time.Duration
	}{
		"ends in ten days":              {ends: 240 * time.Hour, recorded: 240 * time.Hour},
		"is not the license haven made": {ends: 2 * time.Hour, recorded: 100 * time.Hour},
	} {
		t.Run(name, func(t *testing.T) {
			cloud, stack := newFakeCloud(t), newFakeStack(t)
			state := cloudState{dir: t.TempDir()}
			writeTestLogin(t, state, cloud.srv.URL, testCloudToken)
			writeTestHeld(t, state, time.Now().Add(tc.recorded))
			stack.held, stack.expiresAt = true, time.Now().Add(tc.ends).UTC().Format(time.RFC3339Nano)

			if err := newTestLicenser(stack, state, nil, &bytes.Buffer{}).renew(context.Background()); err != nil {
				t.Fatal(err)
			}
			if cloud.asked() != 0 || len(stack.uploads()) != 0 {
				t.Errorf("renewal asked Cloud %d times and uploaded %d, want neither", cloud.asked(), len(stack.uploads()))
			}
		})
	}
}

// @scenario "haven renews a testing license before it expires"
func TestRenewalNeedsASignInAndSaysSo(t *testing.T) {
	cloud, stack := newFakeCloud(t), newFakeStack(t)
	state := cloudState{dir: t.TempDir()}
	held := writeTestHeld(t, state, time.Now().Add(time.Hour))
	stack.held, stack.expiresAt = true, held.ExpiresAt.Format(time.RFC3339Nano)

	err := newTestLicenser(stack, state, nil, &bytes.Buffer{}).renew(context.Background())

	if !errors.Is(err, errNotSignedIn) || !strings.Contains(licenseSignInHint(err), "`haven login`") {
		t.Errorf("renewing with no sign-in gave %v, want not-signed-in naming haven login", err)
	}
	if cloud.asked() != 0 || len(stack.uploads()) != 0 {
		t.Error("renewal went on without a token")
	}
}

// @scenario "haven renews a testing license before it expires"
func TestRenewalContactsNobodyForAStackHavenNeverLicensed(t *testing.T) {
	cloud, stack := newFakeCloud(t), newFakeStack(t)
	state, out := cloudState{dir: t.TempDir()}, &bytes.Buffer{}
	writeTestLogin(t, state, cloud.srv.URL, testCloudToken)

	if err := newTestLicenser(stack, state, nil, out).renew(context.Background()); err != nil {
		t.Fatal(err)
	}
	if cloud.asked() != 0 || stack.requests() != 0 || !strings.Contains(out.String(), "`haven license`") {
		t.Errorf("renewal on an unlicensed stack contacted Cloud %d and the stack %d times, said %q", cloud.asked(), stack.requests(), out.String())
	}
}

// @scenario "A haven that is not signed in still starts the stack"
func TestNotSignedInHavenAsksNobodyAndNamesTheCommand(t *testing.T) {
	cloud, stack := newFakeCloud(t), newFakeStack(t)
	state := cloudState{dir: t.TempDir()}

	err := newTestLicenser(stack, state, nil, &bytes.Buffer{}).ask(context.Background(), 0)

	if !errors.Is(err, errNotSignedIn) {
		t.Fatalf("asking with no sign-in gave %v, want not signed in", err)
	}
	if hint := licenseSignInHint(err); !strings.Contains(hint, "`haven login`") || !strings.Contains(hint, "open-source plan") {
		t.Errorf("the hint %q does not name haven login and the open-source plan", hint)
	}
	if cloud.asked() != 0 || stack.requests() != 0 {
		t.Error("an unsigned haven contacted Cloud or the stack")
	}

	t.Setenv("LANGWATCH_PORTLESS_HOME", t.TempDir())
	t.Setenv(testingLicenseTokenKnob, "")
	inv, _ := parse(specByName(t, "up"), []string{"--testing-license"})
	if err := licenseAskedAtUp(inv); err != nil {
		t.Errorf("up --testing-license with no sign-in refused to start: %v", err)
	}
	bad, _ := parse(specByName(t, "up"), []string{"--testing-license=soon"})
	if err := licenseAskedAtUp(bad); err == nil {
		t.Error("up accepted a lifetime that is no duration")
	}
}

// @scenario "A haven that is not signed in still starts the stack"
func TestAnEndedSignInIsNotSignedInAndTheTokenIsNeverSentElsewhere(t *testing.T) {
	state := cloudState{dir: t.TempDir()}
	login := cloudLogin{CloudURL: "https://app.langwatch.ai", Token: testCloudToken, ExpiresAt: time.Now().Add(-time.Hour)}
	if err := state.write(state.loginPath(), login); err != nil {
		t.Fatal(err)
	}
	none := func(string) string { return "" }
	if _, err := state.token(none, time.Now()); !errors.Is(err, errNotSignedIn) {
		t.Errorf("an ended sign-in gave %v, want not signed in", err)
	}

	login.ExpiresAt = time.Now().Add(time.Hour)
	if err := state.write(state.loginPath(), login); err != nil {
		t.Fatal(err)
	}
	elsewhere := func(key string) string {
		if key == cloudURLKnob {
			return "https://cloud.example.test"
		}
		return ""
	}
	if token, err := state.token(elsewhere, time.Now()); !errors.Is(err, errNotSignedIn) || token.Value != "" {
		t.Errorf("a token stored for one Cloud was offered to another: %+v, %v", token, err)
	}
	if _, err := cloudBase("http://cloud.example.test"); err == nil {
		t.Error("haven agreed to send a token over plain http to another machine")
	}
	if _, err := cloudBase("http://127.0.0.1:6560"); err != nil {
		t.Errorf("haven refused a Cloud on this machine: %v", err)
	}
}

// @scenario "CI gets a testing license through a service token"
func TestAServiceTokenInTheEnvironmentNeedsNoSignIn(t *testing.T) {
	cloud, stack := newFakeCloud(t), newFakeStack(t)
	state, out := cloudState{dir: t.TempDir()}, &bytes.Buffer{}
	env := map[string]string{testingLicenseTokenKnob: testServiceKey, cloudURLKnob: cloud.srv.URL}

	if err := newTestLicenser(stack, state, env, out).ask(context.Background(), 0); err != nil {
		t.Fatal(err)
	}
	if cloud.asked() != 1 || cloud.auths[0] != "Bearer "+testServiceKey {
		t.Errorf("Cloud was asked with %v, want the service token", cloud.auths)
	}
	if len(stack.uploads()) != 1 {
		t.Errorf("the stack received %d licenses, want 1", len(stack.uploads()))
	}
	if strings.Contains(out.String(), testServiceKey) {
		t.Errorf("haven printed the service token: %q", out.String())
	}

	writeTestLogin(t, state, cloud.srv.URL, testCloudToken)
	if err := newTestLicenser(stack, state, env, &bytes.Buffer{}).ask(context.Background(), 0); err != nil {
		t.Fatal(err)
	}
	if cloud.auths[1] != "Bearer "+testServiceKey {
		t.Errorf("a stored sign-in beat the service token: %v", cloud.auths)
	}
}

// @scenario "Signing haven in once is enough"
func TestCloudRefusalsAreSaidPlainlyAndLeaveTheStackUntouched(t *testing.T) {
	for name, tc := range map[string]struct {
		status int
		code   string
		want   string
	}{
		"not an ops person":     {http.StatusForbidden, testingLicenseOpsCode, "ops permissions"},
		"token not accepted":    {http.StatusUnauthorized, "testing_license_token_revoked", "haven login"},
		"lifetime over the max": {http.StatusUnprocessableEntity, "testing_license_lifetime_too_long", "30 days"},
	} {
		t.Run(name, func(t *testing.T) {
			cloud, stack := newFakeCloud(t), newFakeStack(t)
			cloud.status, cloud.code = tc.status, tc.code
			state := cloudState{dir: t.TempDir()}
			writeTestLogin(t, state, cloud.srv.URL, testCloudToken)

			err := newTestLicenser(stack, state, nil, &bytes.Buffer{}).ask(context.Background(), 0)

			if err == nil || !strings.Contains(err.Error(), tc.want) || strings.Contains(err.Error(), testCloudToken) {
				t.Errorf("a %d %s refusal said %v, want it to mention %q and no token", tc.status, tc.code, err, tc.want)
			}
			if len(stack.uploads()) != 0 {
				t.Error("a refused ask still stored a license")
			}
		})
	}
}
