package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/atomicfile"
)

// haven's sign-in to LangWatch Cloud (ADR-180). The device flow answers a
// testing-license token that can issue testing licenses and do nothing else. It
// is held 0600 under haven's home, never printed, and scrubbed from every error.

const (
	defaultCloudURL         = "https://app.langwatch.ai"
	cloudURLKnob            = "HAVEN_CLOUD_URL"
	testingLicenseTokenKnob = "LANGWATCH_TESTING_LICENSE_TOKEN"
	cloudHTTPTimeout        = 30 * time.Second
	minPollInterval         = 5 * time.Second
	defaultDeviceCodeTTL    = 10 * time.Minute
	cloudResponseLimit      = 1 << 20
	testingLicenseOpsCode   = "testing_license_requires_ops_manage"
)

var errNotSignedIn = errors.New("haven is not signed in to LangWatch Cloud")

// cloudState is haven's own record of Cloud: the login, a login waiting for
// approval, and the testing license each stack holds.
type cloudState struct{ dir string }

func havenCloudState() cloudState { return cloudState{dir: filepath.Join(havenHome(), "cloud")} }

func (s cloudState) loginPath() string   { return filepath.Join(s.dir, "login.json") }
func (s cloudState) pendingPath() string { return filepath.Join(s.dir, "login-pending.json") }
func (s cloudState) heldPath(slug string) string {
	return filepath.Join(s.dir, "testing-license", filepath.Base(slug)+".json")
}

// cloudLogin is the stored token; Token never prints.
type cloudLogin struct {
	CloudURL  string    `json:"cloudUrl"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// pendingLogin is a device flow waiting for approval; DeviceCode never prints.
type pendingLogin struct {
	CloudURL        string    `json:"cloudUrl"`
	DeviceCode      string    `json:"deviceCode"`
	UserCode        string    `json:"userCode"`
	VerificationURL string    `json:"verificationUrl"`
	ExpiresAt       time.Time `json:"expiresAt"`
	IntervalSeconds int       `json:"intervalSeconds"`
}

func (s cloudState) read(path string, out any) (bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := json.Unmarshal(data, out); err != nil {
		return false, fmt.Errorf("%s is unreadable; delete it and sign in again", path)
	}
	return true, nil
}

func (s cloudState) write(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return atomicfile.Write(path, data, 0o600)
}

func (s cloudState) remove(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// cloudToken is the credential haven asks Cloud with, and where it came from.
type cloudToken struct {
	Value     string
	Source    string // env (a service token, for CI) or login (a person's)
	CloudURL  string
	ExpiresAt time.Time
}

// token is the credential to ask with: LANGWATCH_TESTING_LICENSE_TOKEN first, so a CI
// job needs no sign-in, else the stored login. errNotSignedIn when neither is usable.
func (s cloudState) token(getenv func(string) string, now time.Time) (cloudToken, error) {
	cloud := strings.TrimRight(strings.TrimSpace(getenv(cloudURLKnob)), "/")
	if value := strings.TrimSpace(getenv(testingLicenseTokenKnob)); value != "" {
		return cloudToken{Value: value, Source: "env", CloudURL: orDefaultCloud(cloud)}, nil
	}
	var login cloudLogin
	found, err := s.read(s.loginPath(), &login)
	if err != nil {
		return cloudToken{}, err
	}
	if !found || login.Token == "" {
		return cloudToken{}, errNotSignedIn
	}
	if !login.ExpiresAt.IsZero() && !now.Before(login.ExpiresAt) {
		return cloudToken{}, fmt.Errorf("%w: the sign-in ended on %s", errNotSignedIn, login.ExpiresAt.Format(time.RFC3339))
	}
	if cloud != "" && cloud != strings.TrimRight(login.CloudURL, "/") {
		return cloudToken{}, fmt.Errorf("%w (the stored sign-in is for %s, not %s)", errNotSignedIn, login.CloudURL, cloud)
	}
	return cloudToken{Value: login.Token, Source: "login", CloudURL: login.CloudURL, ExpiresAt: login.ExpiresAt}, nil
}

func orDefaultCloud(raw string) string {
	if raw == "" {
		return defaultCloudURL
	}
	return raw
}

func isLocalHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || strings.HasSuffix(host, ".localhost")
}

// cloudBase parses Cloud's address. A token only travels over https, except to this machine.
func cloudBase(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimRight(orDefaultCloud(strings.TrimSpace(raw)), "/"))
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("the LangWatch Cloud address %q does not parse (%s sets it)", raw, cloudURLKnob)
	}
	switch {
	case u.Scheme == "https", u.Scheme == "http" && isLocalHost(u.Hostname()):
		return u, nil
	}
	return nil, fmt.Errorf("refusing to talk to %s: haven sends its token only over https (or to this machine)", u.Redacted())
}

// cloudRefusal is Cloud saying no, with its own code.
type cloudRefusal struct {
	Status  int
	Code    string
	Message string
}

func (r cloudRefusal) Error() string {
	switch {
	case r.Code == testingLicenseOpsCode:
		return "your Cloud account does not hold ops permissions, so it cannot request testing licenses"
	case r.Code == "testing_license_lifetime_too_long":
		return "that lifetime is longer than a testing license may last (30 days at most)"
	case r.Status == http.StatusUnauthorized:
		return fmt.Sprintf("LangWatch Cloud did not accept haven's testing-license token (%s): run `haven login`, or ask an ops manager for a new service token in CI", orCode(r))
	case r.Status == http.StatusForbidden, r.Status == http.StatusNotFound && r.Code == "permission_denied":
		return fmt.Sprintf("LangWatch Cloud refused: this account does not hold ops permissions (%s)", orCode(r))
	}
	return fmt.Sprintf("LangWatch Cloud answered %d (%s): %s", r.Status, orCode(r), r.Message)
}

func orCode(r cloudRefusal) string {
	if r.Code == "" {
		return "no code"
	}
	return r.Code
}

// refusalOf reads Cloud's error body, either a handled error or an OAuth one, scrubbed.
func refusalOf(status int, raw []byte, scrubs ...string) cloudRefusal {
	var body struct {
		Code        string `json:"code"`
		Error       string `json:"error"`
		Message     string `json:"message"`
		Description string `json:"error_description"`
	}
	_ = json.Unmarshal(raw, &body)
	return cloudRefusal{
		Status:  status,
		Code:    scrubbed(firstNonEmpty(body.Code, body.Error), scrubs),
		Message: scrubbed(firstNonEmpty(body.Message, body.Description), scrubs),
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func scrubbed(text string, secrets []string) string {
	for _, secret := range secrets {
		if secret != "" {
			text = strings.ReplaceAll(text, secret, redacted)
		}
	}
	return text
}

// cloudClient talks to LangWatch Cloud; sleep and now are seams for tests.
type cloudClient struct {
	base  string
	http  *http.Client
	sleep func(context.Context, time.Duration) error
	now   func() time.Time
}

func newCloudClient(raw string) (cloudClient, error) {
	u, err := cloudBase(raw)
	if err != nil {
		return cloudClient{}, err
	}
	return cloudClient{base: u.Scheme + "://" + u.Host, http: &http.Client{Timeout: cloudHTTPTimeout}, sleep: sleepContext, now: time.Now}, nil
}

func sleepContext(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// cloudRequest is one call to Cloud; bearer, when set, is scrubbed from any error and a nil body sends none.
type cloudRequest struct {
	method string
	path   string
	bearer string
	body   any
}

// send makes one request.
func (c cloudClient) send(ctx context.Context, call cloudRequest) (int, []byte, error) {
	var payload []byte
	if call.body != nil {
		var err error
		if payload, err = json.Marshal(call.body); err != nil {
			return 0, nil, err
		}
	}
	method, path, bearer := call.method, call.path, call.bearer
	var body io.Reader
	if payload != nil {
		body = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return 0, nil, err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("could not reach %s: %s", c.base, scrubbed(err.Error(), []string{bearer}))
	}
	defer func() { _ = res.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(res.Body, cloudResponseLimit))
	return res.StatusCode, raw, err
}

// clientInfo names this machine, so the approval page can say which device is asking.
func clientInfo() map[string]any {
	hostname, _ := os.Hostname()
	return map[string]any{"device_label": "haven on " + hostname, "hostname": hostname, "platform": runtime.GOOS}
}

// startLogin opens a device flow for a testing-license token.
func (c cloudClient) startLogin(ctx context.Context) (pendingLogin, error) {
	status, raw, err := c.send(ctx, cloudRequest{method: http.MethodPost, path: "/api/auth/cli/device-code", body: map[string]any{
		"credential_type": "testing_license",
		"client_info":     clientInfo(),
	}})
	if err != nil {
		return pendingLogin{}, err
	}
	if status != http.StatusOK {
		return pendingLogin{}, refusalOf(status, raw)
	}
	var out struct {
		DeviceCode              string `json:"device_code"`
		UserCode                string `json:"user_code"`
		VerificationURI         string `json:"verification_uri"`
		VerificationURIComplete string `json:"verification_uri_complete"`
		ExpiresIn               int    `json:"expires_in"`
		Interval                int    `json:"interval"`
	}
	if json.Unmarshal(raw, &out) != nil || out.DeviceCode == "" || out.UserCode == "" {
		return pendingLogin{}, errors.New("LangWatch Cloud answered the sign-in start with something haven could not read")
	}
	verification := firstNonEmpty(out.VerificationURIComplete, out.VerificationURI)
	if !strings.HasPrefix(verification, c.base+"/") {
		return pendingLogin{}, fmt.Errorf("LangWatch Cloud named a sign-in page outside %s; haven will not open it", c.base)
	}
	ttl := defaultDeviceCodeTTL
	if out.ExpiresIn > 0 {
		ttl = time.Duration(out.ExpiresIn) * time.Second
	}
	return pendingLogin{
		CloudURL: c.base, DeviceCode: out.DeviceCode, UserCode: out.UserCode, VerificationURL: verification,
		ExpiresAt: c.now().Add(ttl), IntervalSeconds: out.Interval,
	}, nil
}

// awaitLogin polls the exchange at the server's interval until the person approves,
// slowing down when told to. A refusal, a denial or an expiry ends it with its reason.
func (c cloudClient) awaitLogin(ctx context.Context, p pendingLogin) (cloudLogin, error) {
	interval := max(time.Duration(p.IntervalSeconds)*time.Second, minPollInterval)
	body := map[string]any{"device_code": p.DeviceCode, "client_info": clientInfo()}
	for {
		if err := c.sleep(ctx, interval); err != nil {
			return cloudLogin{}, err
		}
		if c.now().After(p.ExpiresAt) {
			return cloudLogin{}, errors.New("the sign-in expired before it was approved; run `haven login` again")
		}
		status, raw, err := c.send(ctx, cloudRequest{method: http.MethodPost, path: "/api/auth/cli/exchange", body: body})
		if err != nil {
			return cloudLogin{}, err
		}
		refusal := refusalOf(status, raw, p.DeviceCode)
		switch {
		case status == http.StatusOK:
			return c.loginFrom(raw, p)
		case refusal.Code == "authorization_pending":
		case refusal.Code == "slow_down":
			interval += minPollInterval
		case refusal.Code == "expired_token":
			return cloudLogin{}, errors.New("the sign-in expired before it was approved; run `haven login` again")
		case refusal.Code == "access_denied":
			return cloudLogin{}, errors.New("the sign-in was denied in the browser")
		default:
			return cloudLogin{}, refusal
		}
	}
}

func (c cloudClient) loginFrom(raw []byte, p pendingLogin) (cloudLogin, error) {
	var out struct {
		Kind      string `json:"kind"`
		Token     string `json:"testing_license_token"`
		ExpiresAt string `json:"expires_at"`
	}
	if json.Unmarshal(raw, &out) != nil || out.Kind != "testing_license" || out.Token == "" {
		return cloudLogin{}, errors.New("LangWatch Cloud answered the sign-in with a credential haven cannot use for testing licenses")
	}
	login := cloudLogin{CloudURL: p.CloudURL, Token: out.Token}
	if expires, err := time.Parse(time.RFC3339Nano, out.ExpiresAt); err == nil {
		login.ExpiresAt = expires
	}
	return login, nil
}

// revoke ends the token on Cloud. A 401 means Cloud already refuses it, which is the goal.
func (c cloudClient) revoke(ctx context.Context, token string) error {
	status, raw, err := c.send(ctx, cloudRequest{method: http.MethodDelete, path: "/api/licensing/testing-licenses/token", bearer: token})
	if err != nil {
		return err
	}
	if (status >= 200 && status < 300) || status == http.StatusUnauthorized {
		return nil
	}
	return refusalOf(status, raw, token)
}

// issueRequest is what a stack asks for: its instance and its local organization.
type issueRequest struct {
	InstanceID     string `json:"instanceId"`
	OrganizationID string `json:"organizationId"`
	LifetimeHours  int    `json:"lifetimeHours,omitempty"`
}

// issuedLicense is the signed key, which never prints, and when it ends.
type issuedLicense struct {
	LicenseKey      string
	IssuedLicenseID string
	ExpiresAt       time.Time
}

// issue asks Cloud for a testing license with the token.
func (c cloudClient) issue(ctx context.Context, token string, req issueRequest) (issuedLicense, error) {
	status, raw, err := c.send(ctx, cloudRequest{method: http.MethodPost, path: "/api/licensing/testing-licenses", bearer: token, body: req})
	if err != nil {
		return issuedLicense{}, err
	}
	if status != http.StatusCreated && status != http.StatusOK {
		return issuedLicense{}, refusalOf(status, raw, token)
	}
	var out struct {
		LicenseKey      string `json:"licenseKey"`
		IssuedLicenseID string `json:"issuedLicenseId"`
		ExpiresAt       string `json:"expiresAt"`
	}
	if json.Unmarshal(raw, &out) != nil || out.LicenseKey == "" {
		return issuedLicense{}, errors.New("LangWatch Cloud answered the testing license with something haven could not read")
	}
	expires, err := time.Parse(time.RFC3339Nano, out.ExpiresAt)
	if err != nil {
		return issuedLicense{}, errors.New("LangWatch Cloud's testing license carries no readable expiry")
	}
	return issuedLicense{LicenseKey: out.LicenseKey, IssuedLicenseID: out.IssuedLicenseID, ExpiresAt: expires}, nil
}
