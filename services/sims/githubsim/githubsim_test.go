package githubsim

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var fixedNow = time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)

func testServer(t *testing.T, mutate func(*Config)) *Server {
	t.Helper()
	cfg := Config{Seed: true, AppID: "42", WebhookSecret: "whsec_test", MaxRecords: 50}
	if mutate != nil {
		mutate(&cfg)
	}
	return newServer(cfg, func() time.Time { return fixedNow })
}

func appJWT(iss string, exp time.Time) string {
	enc := base64.RawURLEncoding
	payload, _ := json.Marshal(map[string]any{"iss": iss, "exp": exp.Unix()})
	return enc.EncodeToString([]byte(`{"alg":"RS256"}`)) + "." + enc.EncodeToString(payload) + ".sig"
}

func call(s *Server, method, path, auth, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if auth != "" {
		req.Header.Set("Authorization", "Bearer "+auth)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func mint(t *testing.T, s *Server, body string) string {
	t.Helper()
	rec := call(s, "POST", "/app/installations/1001/access_tokens", appJWT("42", fixedNow.Add(time.Minute)), body)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	var out struct {
		Token string `json:"token"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	return out.Token
}

// @scenario "An installation mints a token that lists repositories and pull requests"
func TestInstallationTokenAndRepositories(t *testing.T) {
	s := testServer(t, nil)

	got := call(s, "GET", "/app/installations/1001", appJWT("42", fixedNow.Add(time.Minute)), "")
	assert.Equal(t, http.StatusOK, got.Code)
	assert.Contains(t, got.Body.String(), `"login":"langwatch-demo"`)

	tok := mint(t, s, `{"permissions":{"pull_requests":"read"}}`)
	repos := call(s, "GET", "/installation/repositories?per_page=100&page=1", tok, "")
	assert.Equal(t, http.StatusOK, repos.Code)
	assert.Contains(t, repos.Body.String(), `"full_name":"langwatch-demo/app"`)

	pulls := call(s, "GET", "/repos/langwatch-demo/app/pulls?head=langwatch-demo:feat/demo&state=all", tok, "")
	assert.Equal(t, http.StatusOK, pulls.Code)
	assert.Contains(t, pulls.Body.String(), `"ref":"feat/demo"`)
	assert.Equal(t, http.StatusOK, call(s, "GET", "/repos/langwatch-demo/app/pulls/1", tok, "").Code)
	assert.Equal(t, http.StatusNotFound, call(s, "GET", "/repos/langwatch-demo/app/pulls/9", tok, "").Code)
}

// @scenario "Credentials and permissions are refused the way GitHub refuses them"
func TestAuthRefusals(t *testing.T) {
	s := testServer(t, nil)
	assert.Equal(t, http.StatusUnauthorized, call(s, "GET", "/app/installations/1001", "", "").Code, "no token")
	assert.Equal(t, http.StatusUnauthorized, call(s, "GET", "/app/installations/1001", appJWT("7", fixedNow.Add(time.Minute)), "").Code, "other app")
	assert.Equal(t, http.StatusUnauthorized, call(s, "GET", "/app/installations/1001", appJWT("42", fixedNow.Add(-time.Minute)), "").Code, "expired jwt")
	assert.Equal(t, http.StatusNotFound, call(s, "GET", "/app/installations/5", appJWT("42", fixedNow.Add(time.Minute)), "").Code, "unknown installation")
	assert.Equal(t, http.StatusUnauthorized, call(s, "GET", "/installation/repositories", "ghs_nope", "").Code)

	readOnly := mint(t, s, `{"permissions":{"pull_requests":"read"}}`)
	create := call(s, "POST", "/repos/langwatch-demo/app/pulls", readOnly, `{"title":"t","head":"x","base":"main"}`)
	assert.Equal(t, http.StatusForbidden, create.Code, "a read token cannot open a PR")
	assert.Contains(t, create.Body.String(), "Resource not accessible by integration")
	assert.Equal(t, http.StatusNotFound, call(s, "GET", "/repos/other/app/pulls", readOnly, "").Code, "repo outside the installation")

	s.mu.Lock()
	s.installs[1001].Permissions = map[string]string{"metadata": "read"}
	s.mu.Unlock()
	denied := call(s, "POST", "/app/installations/1001/access_tokens", appJWT("42", fixedNow.Add(time.Minute)), `{"permissions":{"pull_requests":"write"}}`)
	assert.Equal(t, http.StatusUnprocessableEntity, denied.Code, "a permission the installation lacks")
}

// @scenario "Credentials and permissions are refused the way GitHub refuses them"
func TestExpiredTokensAndSuspension(t *testing.T) {
	s := testServer(t, nil)
	tok := mint(t, s, `{}`)
	assert.Equal(t, http.StatusOK, call(s, "GET", "/installation/repositories", tok, "").Code)

	assert.Equal(t, http.StatusOK, call(s, "POST", "/_sim/api/tokens/expire", "", "").Code)
	assert.Equal(t, http.StatusUnauthorized, call(s, "GET", "/installation/repositories", tok, "").Code)

	fresh := mint(t, s, `{}`)
	assert.Equal(t, http.StatusOK, call(s, "POST", "/_sim/api/installations/1001/action", "", `{"action":"suspend"}`).Code)
	assert.Equal(t, http.StatusForbidden, call(s, "GET", "/installation/repositories", fresh, "").Code)
	assert.Equal(t, http.StatusForbidden, call(s, "POST", "/app/installations/1001/access_tokens", appJWT("42", fixedNow.Add(time.Minute)), `{}`).Code)
}

// @scenario "A scripted failure answers matching calls"
func TestScriptedFaults(t *testing.T) {
	s := testServer(t, nil)
	tok := mint(t, s, `{}`)

	add := call(s, "POST", "/_sim/api/faults", "", `{"match":"/pulls","status":429,"retryAfter":30,"times":1}`)
	require.Equal(t, http.StatusCreated, add.Code)
	limited := call(s, "GET", "/repos/langwatch-demo/app/pulls", tok, "")
	assert.Equal(t, http.StatusTooManyRequests, limited.Code)
	assert.Equal(t, "30", limited.Header().Get("Retry-After"))
	assert.Equal(t, "0", limited.Header().Get("X-RateLimit-Remaining"))
	assert.Equal(t, http.StatusOK, call(s, "GET", "/repos/langwatch-demo/app/pulls", tok, "").Code, "a one-shot fault spends itself")

	for _, status := range []int{401, 403, 404, 422, 500, 503} {
		call(s, "DELETE", "/_sim/api/faults", "", "")
		call(s, "POST", "/_sim/api/faults", "", `{"match":"access_tokens","status":`+itoa(status)+`}`)
		got := call(s, "POST", "/app/installations/1001/access_tokens", appJWT("42", fixedNow.Add(time.Minute)), `{}`)
		assert.Equal(t, status, got.Code)
		assert.Contains(t, got.Body.String(), `"message"`)
	}
	assert.Equal(t, http.StatusUnprocessableEntity, call(s, "POST", "/_sim/api/faults", "", `{"status":200}`).Code)
}

func itoa(n int) string { return strconv.Itoa(n) }

// @scenario "Pull requests open, change state and carry check runs"
func TestPullRequestLifecycleAndCheckRuns(t *testing.T) {
	s := testServer(t, nil)
	tok := mint(t, s, `{}`)

	opened := call(s, "POST", "/repos/langwatch-demo/app/pulls", tok, `{"title":"Add thing","head":"feat/thing","base":"main"}`)
	require.Equal(t, http.StatusCreated, opened.Code, opened.Body.String())
	assert.Equal(t, http.StatusUnprocessableEntity, call(s, "POST", "/repos/langwatch-demo/app/pulls", tok, `{"title":"Again","head":"feat/thing","base":"main"}`).Code)

	call(s, "POST", "/_sim/api/pulls/transition", "", `{"repo":"langwatch-demo/app","number":2,"action":"merge"}`)
	got := call(s, "GET", "/repos/langwatch-demo/app/pulls/2", tok, "")
	assert.Contains(t, got.Body.String(), `"state":"closed"`)
	assert.Contains(t, got.Body.String(), `"merged":true`)

	run := call(s, "POST", "/repos/langwatch-demo/app/check-runs", tok, `{"name":"langwatch","head_sha":"abc","status":"completed","conclusion":"success"}`)
	require.Equal(t, http.StatusCreated, run.Code)
	list := call(s, "GET", "/repos/langwatch-demo/app/commits/abc/check-runs", tok, "")
	assert.Contains(t, list.Body.String(), `"total_count":1`)
}

type received struct {
	event, signature, delivery string
	body                       []byte
}

func webhookTarget(t *testing.T, status int) (*httptest.Server, chan received) {
	t.Helper()
	got := make(chan received, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		got <- received{r.Header.Get("X-GitHub-Event"), r.Header.Get("X-Hub-Signature-256"), r.Header.Get("X-GitHub-Delivery"), body}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"received":true}`))
	}))
	t.Cleanup(srv.Close)
	return srv, got
}

// @scenario "Webhooks are signed over the exact body and can be sent wrong"
func TestSignedWebhookDelivery(t *testing.T) {
	target, got := webhookTarget(t, http.StatusOK)
	s := testServer(t, func(c *Config) { c.WebhookURL = target.URL })

	rec := call(s, "POST", "/_sim/api/pulls/transition", "", `{"repo":"langwatch-demo/app","number":1,"action":"merge","deliver":true}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	hook := <-got
	assert.Equal(t, "pull_request", hook.event)
	assert.Equal(t, sign("whsec_test", hook.body), hook.signature)
	var payload struct {
		Action       string             `json:"action"`
		Installation struct{ ID int64 } `json:"installation"`
		Repository   struct {
			FullName string `json:"full_name"`
			Owner    struct{ Login string }
		}
		PullRequest struct {
			Merged bool
			Head   struct{ Ref string }
		} `json:"pull_request"`
	}
	require.NoError(t, json.Unmarshal(hook.body, &payload))
	assert.Equal(t, "closed", payload.Action)
	assert.Equal(t, int64(1001), payload.Installation.ID)
	assert.Equal(t, "langwatch-demo", payload.Repository.Owner.Login)
	assert.True(t, payload.PullRequest.Merged)
	assert.Equal(t, "feat/demo", payload.PullRequest.Head.Ref)

	call(s, "POST", "/_sim/api/deliver", "", `{"event":"installation","action":"deleted","installationId":1001,"badSignature":true}`)
	bad := <-got
	assert.NotEqual(t, sign("whsec_test", bad.body), bad.signature, "a bad-signature delivery must not verify")

	call(s, "POST", "/_sim/api/deliver", "", `{"event":"installation","action":"suspend","installationId":1001,"omitSignature":true}`)
	assert.Empty(t, (<-got).signature)

	history := call(s, "GET", "/_sim/api/deliveries", "", "")
	assert.Contains(t, history.Body.String(), `"event":"installation"`)
}

// @scenario "Webhooks are signed over the exact body and can be sent wrong"
func TestDeliveryNeedsATargetAndReportsRefusals(t *testing.T) {
	s := testServer(t, nil)
	none := call(s, "POST", "/_sim/api/deliver", "", `{"event":"ping"}`)
	assert.Equal(t, http.StatusUnprocessableEntity, none.Code)

	target, _ := webhookTarget(t, http.StatusUnauthorized)
	s = testServer(t, func(c *Config) { c.WebhookURL = target.URL })
	refused := call(s, "POST", "/_sim/api/deliver", "", `{"event":"ping"}`)
	assert.Equal(t, http.StatusOK, refused.Code)
	assert.Contains(t, refused.Body.String(), `"status":401`)
	assert.Equal(t, http.StatusUnprocessableEntity, call(s, "POST", "/_sim/api/deliver", "", `{"event":"push"}`).Code)
}

// @scenario "The install page redirects to the stack's setup URL"
func TestInstallPageRedirectsToSetup(t *testing.T) {
	s := testServer(t, func(c *Config) { c.SetupURL = "http://app.test/api/github/setup" })
	list := call(s, "GET", "/apps/langwatch/installations/new?state=abc", "", "")
	assert.Equal(t, http.StatusOK, list.Code)
	assert.Contains(t, list.Body.String(), "langwatch-demo")

	done := call(s, "GET", "/github-apps/langwatch/installations/new?state=abc&account=acme", "", "")
	require.Equal(t, http.StatusFound, done.Code)
	loc, err := url.Parse(done.Header().Get("Location"))
	require.NoError(t, err)
	assert.Equal(t, "abc", loc.Query().Get("state"))
	assert.Equal(t, "install", loc.Query().Get("setup_action"))
	id := loc.Query().Get("installation_id")
	assert.Equal(t, http.StatusOK, call(s, "GET", "/app/installations/"+id, appJWT("42", fixedNow.Add(time.Minute)), "").Code)
}

// @scenario "Installing again on an account dates the installation now"
func TestInstallPageRestampsAnExistingInstallation(t *testing.T) {
	now := fixedNow
	s := newServer(Config{Seed: true, AppID: "42", WebhookSecret: "whsec_test", MaxRecords: 50, SetupURL: "http://app.test/api/github/setup"},
		func() time.Time { return now })
	now = fixedNow.Add(10 * time.Minute)

	done := call(s, "GET", "/github-apps/langwatch/installations/new?state=abc&account=langwatch-demo", "", "")
	require.Equal(t, http.StatusFound, done.Code)
	loc, err := url.Parse(done.Header().Get("Location"))
	require.NoError(t, err)
	assert.Equal(t, "1001", loc.Query().Get("installation_id"))
	assert.Equal(t, "install", loc.Query().Get("setup_action"))

	got := call(s, "GET", "/app/installations/1001", appJWT("42", now.Add(time.Minute)), "")
	require.Equal(t, http.StatusOK, got.Code)
	var body struct {
		CreatedAt string `json:"created_at"`
	}
	require.NoError(t, json.Unmarshal(got.Body.Bytes(), &body))
	assert.Equal(t, now.Format(time.RFC3339), body.CreatedAt)
}

// @scenario "OAuth sign-in gives a user"
func TestOAuthSignIn(t *testing.T) {
	s := testServer(t, nil)
	auth := call(s, "GET", "/login/oauth/authorize?redirect_uri="+url.QueryEscape("http://app.test/cb")+"&state=s1", "", "")
	require.Equal(t, http.StatusFound, auth.Code)
	loc, _ := url.Parse(auth.Header().Get("Location"))
	code := loc.Query().Get("code")
	assert.Equal(t, "s1", loc.Query().Get("state"))

	req := httptest.NewRequest(http.MethodPost, "/login/oauth/access_token", strings.NewReader(`{"code":"`+code+`"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	assert.Contains(t, rec.Body.String(), "access_token")
	retry := httptest.NewRequest(http.MethodPost, "/login/oauth/access_token", strings.NewReader(`{"code":"`+code+`"}`))
	retry.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, retry)
	assert.Contains(t, rec.Body.String(), "bad_verification_code", "a code is single-use")

	again := call(s, "GET", "/login/oauth/authorize?redirect_uri="+url.QueryEscape("http://app.test/cb"), "", "")
	loc, _ = url.Parse(again.Header().Get("Location"))
	form := httptest.NewRequest(http.MethodPost, "/login/oauth/access_token", strings.NewReader("code="+loc.Query().Get("code")))
	form.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, form)
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &tok))
	me := call(s, "GET", "/user", tok.AccessToken, "")
	assert.Equal(t, http.StatusOK, me.Code)
	assert.Contains(t, me.Body.String(), `"login":"octocat"`)
	assert.Contains(t, call(s, "GET", "/user/emails", tok.AccessToken, "").Body.String(), `"verified":true`)
	assert.Equal(t, http.StatusUnauthorized, call(s, "GET", "/user", "gho_bad", "").Code)
}

// @scenario "Control state resets to the seed and unknown paths are GitHub 404s"
func TestUnknownPathsAreGitHubNotFoundNotThePage(t *testing.T) {
	s := testServer(t, nil)
	rec := call(s, "GET", "/nope/at/all", "", "")
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Contains(t, rec.Header().Get("Content-Type"), "json")
	assert.Equal(t, http.StatusOK, call(s, "GET", "/", "", "").Code)
}

// @scenario "Control state resets to the seed and unknown paths are GitHub 404s"
func TestResetRestoresTheSeed(t *testing.T) {
	s := testServer(t, nil)
	call(s, "POST", "/_sim/api/installations", "", `{"account":"acme"}`)
	call(s, "POST", "/_sim/api/pulls", "", `{"repo":"acme/app","head":"x"}`)
	call(s, "POST", "/_sim/api/reset", "", "")
	info := call(s, "GET", "/_sim/api/info", "", "")
	assert.Contains(t, info.Body.String(), `"installations":1`)
	assert.Contains(t, info.Body.String(), `"pulls":1`)
}
