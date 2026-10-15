package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	testDeviceCode = "device-code-secret-0003"
	testUserCode   = "ABCD-EFGH"
)

// loginCloud stands in for Cloud's device flow; exchange answers the script in order.
type loginCloud struct {
	srv          *httptest.Server
	mu           sync.Mutex
	script       []string
	polls        int
	asked        map[string]any
	revoked      []string // bearers the sign-out route revoked
	revokeStatus int      // what the sign-out route answers; 200 when unset
}

func newLoginCloud(t *testing.T, script ...string) *loginCloud {
	t.Helper()
	c := &loginCloud{script: script}
	c.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.mu.Lock()
		defer c.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/licensing/testing-licenses/token":
			if r.Method != http.MethodDelete {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			if c.revokeStatus != 0 && c.revokeStatus != http.StatusOK {
				w.WriteHeader(c.revokeStatus)
				_, _ = w.Write([]byte(`{"code":"internal_error","message":"try later"}`))
				return
			}
			c.revoked = append(c.revoked, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
			_, _ = w.Write([]byte(`{"status":"revoked"}`))
		case "/api/auth/cli/device-code":
			_ = json.NewDecoder(r.Body).Decode(&c.asked)
			_, _ = w.Write([]byte(`{"device_code":"` + testDeviceCode + `","user_code":"` + testUserCode + `","verification_uri":"` + c.srv.URL + `/cli/auth","verification_uri_complete":"` + c.srv.URL + `/cli/auth?user_code=` + testUserCode + `","expires_in":600,"interval":5}`))
		case "/api/auth/cli/exchange":
			c.polls++
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["device_code"] != testDeviceCode {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			next := "authorization_pending"
			if len(c.script) > 0 {
				next, c.script = c.script[0], c.script[1:]
			}
			switch next {
			case "ok":
				_, _ = w.Write([]byte(`{"kind":"testing_license","testing_license_token":"` + testCloudToken + `","expires_at":"2099-01-01T00:00:00.000Z"}`))
			case "authorization_pending":
				w.WriteHeader(http.StatusPreconditionRequired)
				_, _ = w.Write([]byte(`{"error":"authorization_pending"}`))
			case "slow_down":
				w.WriteHeader(http.StatusTooManyRequests)
				_, _ = w.Write([]byte(`{"error":"slow_down"}`))
			case "access_denied":
				w.WriteHeader(http.StatusGone)
				_, _ = w.Write([]byte(`{"error":"access_denied"}`))
			case testingLicenseOpsCode:
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"error":"` + testingLicenseOpsCode + `"}`))
			}
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(c.srv.Close)
	return c
}

func (c *loginCloud) revokedTokens() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.revoked...)
}

func (c *loginCloud) pollCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.polls
}

type signInRig struct {
	flow   cloudSignIn
	out    *bytes.Buffer
	opened []string
	sleeps []time.Duration
}

func newSignInRig(t *testing.T, cloud *loginCloud) *signInRig {
	t.Helper()
	rig := &signInRig{out: &bytes.Buffer{}}
	rig.flow = cloudSignIn{
		state: cloudState{dir: t.TempDir()},
		out:   rig.out,
		now:   time.Now,
		open:  func(u string) error { rig.opened = append(rig.opened, u); return nil },
		getenv: func(key string) string {
			if key == cloudURLKnob {
				return cloud.srv.URL
			}
			return ""
		},
		newCloud: func(raw string) (cloudClient, error) {
			client, err := newCloudClient(raw)
			client.sleep = func(_ context.Context, d time.Duration) error {
				rig.sleeps = append(rig.sleeps, d)
				return nil
			}
			return client, err
		},
	}
	return rig
}

func (r *signInRig) mustNotLeak(t *testing.T) {
	t.Helper()
	for _, secret := range []string{testCloudToken, testDeviceCode} {
		if strings.Contains(r.out.String(), secret) {
			t.Errorf("haven printed a secret: %q", r.out.String())
		}
	}
}

// @scenario "Signing haven in once is enough"
func TestLoginPollsAtTheServersPaceAndKeepsTheTokenPrivate(t *testing.T) {
	cloud := newLoginCloud(t, "authorization_pending", "slow_down", "ok")
	rig := newSignInRig(t, cloud)

	if err := rig.flow.run(context.Background(), signInOptions{}); err != nil {
		t.Fatal(err)
	}

	if cloud.asked["credential_type"] != "testing_license" {
		t.Errorf("the device flow asked for %v, want a testing license", cloud.asked)
	}
	device, _ := cloud.asked["client_info"].(map[string]any)
	if label, _ := device["device_label"].(string); !strings.HasPrefix(label, "haven on ") || device["platform"] == "" || device["hostname"] == nil {
		t.Errorf("the device-code request named the device as %v, want haven's label, hostname and platform", cloud.asked["client_info"])
	}
	want := []time.Duration{5 * time.Second, 5 * time.Second, 10 * time.Second}
	if len(rig.sleeps) != len(want) || rig.sleeps[0] != want[0] || rig.sleeps[1] != want[1] || rig.sleeps[2] != want[2] {
		t.Errorf("polled after %v, want the server's 5s interval, widened by 5s after slow_down: %v", rig.sleeps, want)
	}
	if len(rig.opened) != 1 || !strings.Contains(rig.opened[0], testUserCode) {
		t.Errorf("opened %v, want the verification page once", rig.opened)
	}
	if !strings.Contains(rig.out.String(), testUserCode) {
		t.Errorf("haven did not show the user code: %q", rig.out.String())
	}
	rig.mustNotLeak(t)

	info, err := os.Stat(rig.flow.state.loginPath())
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("the stored login is %v (%v), want mode 0600", info, err)
	}
	token, err := rig.flow.state.token(func(string) string { return "" }, time.Now())
	if err != nil || token.Value != testCloudToken || token.Source != "login" {
		t.Errorf("the stored login gave %+v, %v, want the token from the exchange", token, err)
	}
	if _, err := os.Stat(rig.flow.state.pendingPath()); !os.IsNotExist(err) {
		t.Errorf("the waiting sign-in outlived its approval: %v", err)
	}
}

// @scenario "Signing haven in once is enough"
func TestLoginNoOpenPrintsTheUrlWithoutABrowser(t *testing.T) {
	rig := newSignInRig(t, newLoginCloud(t, "ok"))

	if err := rig.flow.run(context.Background(), signInOptions{noOpen: true}); err != nil {
		t.Fatal(err)
	}
	if len(rig.opened) != 0 || !strings.Contains(rig.out.String(), "/cli/auth") {
		t.Errorf("opened %v and said %q, want the URL printed and no browser", rig.opened, rig.out.String())
	}
}

// @scenario "Signing haven in once is enough"
func TestAgentLoginPrintsJSONThenWaitResumesIt(t *testing.T) {
	cloud := newLoginCloud(t, "ok")
	rig := newSignInRig(t, cloud)

	if err := rig.flow.run(context.Background(), signInOptions{agent: true}); err != nil {
		t.Fatal(err)
	}

	var announced map[string]any
	if err := json.Unmarshal(rig.out.Bytes(), &announced); err != nil {
		t.Fatalf("agent login printed %q, want one JSON object: %v", rig.out.String(), err)
	}
	if announced["userCode"] != testUserCode || !strings.Contains(announced["verificationUrl"].(string), "/cli/auth") || announced["expiresAt"] == "" {
		t.Errorf("agent login announced %v, want the URL, the code and its expiry", announced)
	}
	rig.mustNotLeak(t)
	if len(rig.opened) != 0 || cloud.pollCount() != 0 {
		t.Errorf("agent login opened %v and polled %d times, want neither", rig.opened, cloud.pollCount())
	}
	info, err := os.Stat(rig.flow.state.pendingPath())
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("the waiting sign-in is %v (%v), want kept with mode 0600", info, err)
	}

	rig.out.Reset()
	if err := rig.flow.run(context.Background(), signInOptions{wait: true}); err != nil {
		t.Fatal(err)
	}
	rig.mustNotLeak(t)
	if token, err := rig.flow.state.token(func(string) string { return "" }, time.Now()); err != nil || token.Value != testCloudToken {
		t.Errorf("--wait stored %+v, %v, want the approved token", token, err)
	}
	if err := rig.flow.run(context.Background(), signInOptions{wait: true}); err == nil || !strings.Contains(err.Error(), "no sign-in is waiting") {
		t.Errorf("--wait with nothing pending said %v", err)
	}
}

// @scenario "Signing haven in once is enough"
func TestLoginEndsWithTheReasonCloudGave(t *testing.T) {
	for name, tc := range map[string]struct {
		answer string
		want   string
	}{
		"not an ops person": {testingLicenseOpsCode, "ops permissions"},
		"denied in browser": {"access_denied", "denied"},
	} {
		t.Run(name, func(t *testing.T) {
			rig := newSignInRig(t, newLoginCloud(t, tc.answer))

			err := rig.flow.run(context.Background(), signInOptions{})

			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("login said %v, want it to mention %q", err, tc.want)
			}
			if _, statErr := os.Stat(rig.flow.state.loginPath()); !os.IsNotExist(statErr) {
				t.Error("a refused sign-in still stored a login")
			}
			if _, statErr := os.Stat(rig.flow.state.pendingPath()); !os.IsNotExist(statErr) {
				t.Error("a finished sign-in left its device code behind")
			}
		})
	}
}

func TestLoginStatusNeverShowsTheToken(t *testing.T) {
	rig := newSignInRig(t, newLoginCloud(t))
	rig.flow.getenv = func(string) string { return "" }

	if err := rig.flow.status(true); err != nil {
		t.Fatal(err)
	}
	var out signInStatus
	if err := json.Unmarshal(rig.out.Bytes(), &out); err != nil || out.SignedIn || out.Source != "none" {
		t.Errorf("status before login said %q (%v), want not signed in", rig.out.String(), err)
	}

	writeTestLogin(t, rig.flow.state, "https://app.langwatch.ai", testCloudToken)
	rig.out.Reset()
	if err := rig.flow.status(false); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rig.out.String(), "signed in to https://app.langwatch.ai until") {
		t.Errorf("status after login said %q", rig.out.String())
	}
	rig.mustNotLeak(t)
}

// @scenario "Signing haven out revokes its token on Cloud"
func TestLogoutRevokesTheTokenOnCloudThenForgetsIt(t *testing.T) {
	cloud := newLoginCloud(t)
	rig := newSignInRig(t, cloud)
	writeTestLogin(t, rig.flow.state, cloud.srv.URL, testCloudToken)

	if err := rig.flow.logout(context.Background()); err != nil {
		t.Fatal(err)
	}

	if revoked := cloud.revokedTokens(); len(revoked) != 1 || revoked[0] != testCloudToken {
		t.Errorf("Cloud revoked %d tokens, want exactly the stored one", len(revoked))
	}
	if _, err := os.Stat(rig.flow.state.loginPath()); !os.IsNotExist(err) {
		t.Errorf("the login outlived the sign-out: %v", err)
	}
	if _, err := rig.flow.state.token(func(string) string { return "" }, time.Now()); err == nil {
		t.Error("haven still has a token to ask with after signing out")
	}
	if !strings.Contains(rig.out.String(), "revoked on") {
		t.Errorf("sign-out said %q, want it to say the token was revoked on Cloud", rig.out.String())
	}
	rig.mustNotLeak(t)
}

// @scenario "Signing haven out revokes its token on Cloud"
func TestLogoutForgetsLocallyWhenCloudCannotRevoke(t *testing.T) {
	cloud := newLoginCloud(t)
	cloud.revokeStatus = http.StatusServiceUnavailable
	rig := newSignInRig(t, cloud)
	writeTestLogin(t, rig.flow.state, cloud.srv.URL, testCloudToken)

	if err := rig.flow.logout(context.Background()); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(rig.flow.state.loginPath()); !os.IsNotExist(err) {
		t.Errorf("the login outlived the sign-out: %v", err)
	}
	if !strings.Contains(rig.out.String(), "on this machine only") {
		t.Errorf("sign-out said %q, want it to say Cloud did not revoke the token", rig.out.String())
	}
	rig.mustNotLeak(t)
}

func TestLogoutWithNoSignInAsksNothingOfCloud(t *testing.T) {
	cloud := newLoginCloud(t)
	rig := newSignInRig(t, cloud)

	if err := rig.flow.logout(context.Background()); err != nil {
		t.Fatal(err)
	}

	if revoked := cloud.revokedTokens(); len(revoked) != 0 {
		t.Errorf("Cloud was asked to revoke %d tokens with nobody signed in", len(revoked))
	}
	if !strings.Contains(rig.out.String(), "not signed in") {
		t.Errorf("sign-out said %q", rig.out.String())
	}
}
