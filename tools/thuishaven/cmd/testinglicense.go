package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Asking Cloud for a stack's testing license and storing it (ADR-180). Cloud issues it
// for this stack's instance id and local organization; the stack takes it through the
// same license.upload the settings page uses, as the seeded admin. Nothing here runs
// unless a developer asked, or the stack already holds a license haven issued.

const (
	renewWindow      = 24 * time.Hour
	stackRetryEvery  = 10 * time.Second
	stackReadyWindow = 2 * time.Minute
)

// heldLicense is what haven remembers of the license it stored in a stack, so a
// renewal can tell the stack still holds the one haven issued.
type heldLicense struct {
	OrganizationID  string    `json:"organizationId"`
	InstanceID      string    `json:"instanceId"`
	IssuedLicenseID string    `json:"issuedLicenseId"`
	LifetimeHours   int       `json:"lifetimeHours,omitempty"`
	ExpiresAt       time.Time `json:"expiresAt"`
}

func (s cloudState) held(slug string) (heldLicense, bool, error) {
	var held heldLicense
	found, err := s.read(s.heldPath(slug), &held)
	return held, found, err
}

// licenseStack is the running stack a license goes into.
type licenseStack struct {
	Slug, App, Email, Password string
}

// stackSession is the seeded admin's signed-in session on the stack, for its tRPC procedures.
type stackSession struct {
	app     string
	http    *http.Client
	cookies []*http.Cookie
	scrubs  []string
}

func openStackSession(ctx context.Context, stack licenseStack) (stackSession, error) {
	base, err := localApp(stack.App)
	if err != nil {
		return stackSession{}, err
	}
	cookies, err := signIn(ctx, base, stack.Email, stack.Password)
	if err != nil {
		return stackSession{}, err
	}
	return stackSession{app: base.Scheme + "://" + base.Host, http: &http.Client{Timeout: authHTTPTimeout}, cookies: cookies}, nil
}

// trpcCall names one procedure, whether it is a mutation, and its input.
type trpcCall struct {
	procedure string
	mutation  bool
	input     any
}

// trpc calls one procedure as plain JSON, a query by GET and a mutation by POST.
func (s stackSession) trpc(ctx context.Context, call trpcCall, out any) error {
	procedure := call.procedure
	req, err := s.trpcRequest(ctx, call)
	if err != nil {
		return err
	}
	res, err := s.http.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach %s: %w", s.app, err)
	}
	defer func() { _ = res.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(res.Body, cloudResponseLimit))
	if err != nil {
		return err
	}
	data, err := s.trpcData(procedure, res, raw)
	if err != nil || out == nil {
		return err
	}
	return json.Unmarshal(data, out)
}

func (s stackSession) trpcRequest(ctx context.Context, call trpcCall) (*http.Request, error) {
	body, err := json.Marshal(call.input)
	if err != nil {
		return nil, err
	}
	endpoint := s.app + "/api/trpc/" + call.procedure
	var req *http.Request
	if call.mutation {
		req, err = http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
		if err == nil {
			req.Header.Set("Content-Type", "application/json")
		}
	} else {
		req, err = http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?input="+url.QueryEscape(string(body)), nil)
	}
	if err != nil {
		return nil, err
	}
	req.Header.Set("Origin", s.app)
	for _, cookie := range s.cookies {
		req.AddCookie(cookie)
	}
	return req, nil
}

// trpcData reads the procedure's result data out of its answer, or the scrubbed error it carried.
func (s stackSession) trpcData(procedure string, res *http.Response, raw []byte) (json.RawMessage, error) {
	var answer struct {
		Result struct {
			Data json.RawMessage `json:"data"`
		} `json:"result"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &answer) != nil {
		return nil, fmt.Errorf("%s answered %s with something haven could not read", procedure, res.Status)
	}
	if answer.Error != nil || res.StatusCode/100 != 2 {
		message := ""
		if answer.Error != nil {
			message = answer.Error.Message
		}
		return nil, fmt.Errorf("%s answered %s: %s", procedure, res.Status, scrubbed(message, s.scrubs))
	}
	return answer.Result.Data, nil
}

// organizationID is the local organization's id, found by its slug: seeded ids are random.
func (s stackSession) organizationID(ctx context.Context) (string, error) {
	var organizations []struct {
		ID   string `json:"id"`
		Slug string `json:"slug"`
	}
	if err := s.trpc(ctx, trpcCall{procedure: "organization.getAll", input: map[string]any{}}, &organizations); err != nil {
		return "", err
	}
	for _, o := range organizations {
		if o.Slug == domain.DefaultOrganizationSlug {
			return o.ID, nil
		}
	}
	return "", fmt.Errorf("the stack has no organization %q yet; the seed creates it", domain.DefaultOrganizationSlug)
}

// instanceID is the stack's instance id, as license.getInstanceId answers an organization admin.
func (s stackSession) instanceID(ctx context.Context, organizationID string) (string, error) {
	var answer struct {
		InstanceID string `json:"instanceId"`
	}
	if err := s.trpc(ctx, trpcCall{procedure: "license.getInstanceId", input: map[string]any{"organizationId": organizationID}}, &answer); err != nil {
		return "", err
	}
	if answer.InstanceID == "" {
		return "", errors.New("the stack answered no instance id")
	}
	return answer.InstanceID, nil
}

// licenseStatus is what license.getStatus says the organization runs on.
type licenseStatus struct {
	HasLicense bool   `json:"hasLicense"`
	Valid      bool   `json:"valid"`
	Expired    bool   `json:"expired"`
	ExpiresAt  string `json:"expiresAt"`
}

func (s stackSession) licenseStatus(ctx context.Context, organizationID string) (licenseStatus, error) {
	var status licenseStatus
	err := s.trpc(ctx, trpcCall{procedure: "license.getStatus", input: map[string]any{"organizationId": organizationID}}, &status)
	return status, err
}

// uploadLicense stores the key through license.upload; the key never appears in an error.
func (s stackSession) uploadLicense(ctx context.Context, organizationID, key string) error {
	s.scrubs = append(s.scrubs, key)
	return s.trpc(ctx, trpcCall{procedure: "license.upload", mutation: true, input: map[string]any{"organizationId": organizationID, "licenseKey": key}}, nil)
}

// renewalDue says whether the stack holds the license haven issued and it ends within a day.
// A stack with no license, or one haven did not issue, is left alone: why says which.
func renewalDue(held heldLicense, status licenseStatus, now time.Time) (due bool, why string) {
	if !status.HasLicense {
		return false, "the stack holds no license; `haven license` asks for one"
	}
	ends, err := time.Parse(time.RFC3339Nano, status.ExpiresAt)
	if err != nil {
		return false, "the stack's license has no readable expiry"
	}
	if ends.Sub(held.ExpiresAt).Abs() > 2*time.Second {
		return false, "the stack holds a license haven did not issue; leaving it"
	}
	return ends.Sub(now) <= renewWindow, ""
}

// parseLifetime reads --testing-license=<dur> and --duration: Go durations plus whole days.
// Empty is Cloud's default.
func parseLifetime(raw string) (time.Duration, error) {
	if raw == "" {
		return 0, nil
	}
	bad := fmt.Errorf("%q is not a duration such as 36h or 5d", raw)
	if days, ok := strings.CutSuffix(raw, "d"); ok {
		n, err := strconv.Atoi(days)
		if err != nil || n <= 0 {
			return 0, bad
		}
		return time.Duration(n) * 24 * time.Hour, nil
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return 0, bad
	}
	return parsed, nil
}

func lifetimeHours(d time.Duration) int {
	if d <= 0 {
		return 0
	}
	return int(math.Ceil(d.Hours()))
}

// licenseSignInHint is the one line a failed ask says, naming the command when haven is not signed in.
func licenseSignInHint(err error) string {
	if errors.Is(err, errNotSignedIn) {
		return fmt.Sprintf("testing licenses need a Cloud sign-in (%v): run `haven login`. The stack keeps running on the open-source plan.", err)
	}
	return fmt.Sprintf("testing license: %v", err)
}

// testingLicenser asks Cloud for a stack's testing license; every effect is a field a test replaces.
type testingLicenser struct {
	state  cloudState
	getenv func(string) string
	now    func() time.Time
	sleep  func(context.Context, time.Duration) error
	out    io.Writer
	stack  licenseStack
	window time.Duration // how long to keep trying for the stack's admin session
}

func newTestingLicenser(stack licenseStack, out io.Writer, getenv func(string) string) testingLicenser {
	return testingLicenser{
		state: havenCloudState(), getenv: getenv, now: time.Now, sleep: sleepContext,
		out: out, stack: stack, window: stackReadyWindow,
	}
}

// session signs in as the seeded admin and finds the local organization, retrying while the
// stack's seed is still creating them.
func (l testingLicenser) session(ctx context.Context) (stackSession, string, error) {
	deadline := l.now().Add(l.window)
	for {
		sess, err := openStackSession(ctx, l.stack)
		if err == nil {
			var organizationID string
			if organizationID, err = sess.organizationID(ctx); err == nil {
				return sess, organizationID, nil
			}
		}
		if !l.now().Before(deadline) {
			return stackSession{}, "", err
		}
		if sleepErr := l.sleep(ctx, stackRetryEvery); sleepErr != nil {
			return stackSession{}, "", sleepErr
		}
	}
}

// ask gets a new testing license for the stack now, however long the held one has left.
func (l testingLicenser) ask(ctx context.Context, lifetime time.Duration) error {
	token, err := l.state.token(l.getenv, l.now())
	if err != nil {
		return err
	}
	sess, organizationID, err := l.session(ctx)
	if err != nil {
		return err
	}
	return l.issueAndStore(ctx, sess, licenseTarget{organizationID: organizationID, token: token, hours: lifetimeHours(lifetime)})
}

// renew asks again, for the same lifetime, only when the stack holds the license haven
// issued and it ends within a day. A stack haven never gave one is not contacted about.
func (l testingLicenser) renew(ctx context.Context) error {
	held, ok, err := l.state.held(l.stack.Slug)
	if err != nil {
		return err
	}
	if !ok {
		_, _ = fmt.Fprintln(l.out, "haven has issued no testing license for this stack; `haven license` asks for one")
		return nil
	}
	sess, organizationID, err := l.session(ctx)
	if err != nil {
		return err
	}
	status, err := sess.licenseStatus(ctx, organizationID)
	if err != nil {
		return err
	}
	due, why := renewalDue(held, status, l.now())
	if !due {
		if why != "" {
			_, _ = fmt.Fprintln(l.out, "haven: testing license: "+why)
		}
		return nil
	}
	token, err := l.state.token(l.getenv, l.now())
	if err != nil {
		return fmt.Errorf("the testing license ends %s: %w", held.ExpiresAt.Format(time.RFC3339), err)
	}
	return l.issueAndStore(ctx, sess, licenseTarget{organizationID: organizationID, token: token, hours: held.LifetimeHours})
}

// licenseTarget is the organization a license is issued for, the token that asks and its lifetime.
type licenseTarget struct {
	organizationID string
	token          cloudToken
	hours          int
}

func (l testingLicenser) issueAndStore(ctx context.Context, sess stackSession, target licenseTarget) error {
	organizationID, token, hours := target.organizationID, target.token, target.hours
	instanceID, err := sess.instanceID(ctx, organizationID)
	if err != nil {
		return err
	}
	cloud, err := newCloudClient(token.CloudURL)
	if err != nil {
		return err
	}
	issued, err := cloud.issue(ctx, token.Value, issueRequest{InstanceID: instanceID, OrganizationID: organizationID, LifetimeHours: hours})
	if err != nil {
		return err
	}
	if err := sess.uploadLicense(ctx, organizationID, issued.LicenseKey); err != nil {
		return fmt.Errorf("LangWatch Cloud issued a testing license but the stack refused it: %w", err)
	}
	held := heldLicense{
		OrganizationID: organizationID, InstanceID: instanceID, IssuedLicenseID: issued.IssuedLicenseID,
		LifetimeHours: hours, ExpiresAt: issued.ExpiresAt,
	}
	if err := l.state.write(l.state.heldPath(l.stack.Slug), held); err != nil {
		return fmt.Errorf("the stack took the testing license but haven could not record it: %w", err)
	}
	_, _ = fmt.Fprintf(l.out, "testing license stored for %s until %s\n", domain.DefaultOrganizationSlug, issued.ExpiresAt.Format(time.RFC3339))
	return nil
}
