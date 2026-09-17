package mailsim

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// @scenario "Everything the CLI can do, a test can do over plain HTTP"
func TestAPIListsFetchesAndDeletesOverHTTP(t *testing.T) {
	s := newTestServer(t, Config{})
	require.NoError(t, deliverRaw(t, s, "sender@example.com", []string{"a@stack.local"}, simpleMessage, nil))

	list := doHTTP(s, "GET", "/api/messages")
	require.Equal(t, http.StatusOK, list.Code)
	body := decodeJSON[struct {
		Messages []Summary `json:"messages"`
	}](t, list)
	require.Len(t, body.Messages, 1)
	id := body.Messages[0].ID

	one := doHTTP(s, "GET", "/api/messages/"+id)
	require.Equal(t, http.StatusOK, one.Code)
	msg := decodeJSON[Message](t, one)
	assert.Equal(t, "a@stack.local", msg.To[0])

	del := doHTTPDelete(s, "/api/messages/"+id)
	require.Equal(t, http.StatusNoContent, del.Code)

	missing := doHTTP(s, "GET", "/api/messages/"+id)
	assert.Equal(t, http.StatusNotFound, missing.Code)
}

// @scenario "Every response the sink serves carries the standard security headers"
func TestAPISecurityHeaders(t *testing.T) {
	s := newTestServer(t, Config{})
	rec := doHTTP(s, "GET", "/healthz")

	assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
	assert.Equal(t, "no-referrer", rec.Header().Get("Referrer-Policy"))
	assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
	assert.Equal(t, "DENY", rec.Header().Get("X-Frame-Options"))
	assert.Equal(t, "frame-ancestors 'none'", rec.Header().Get("Content-Security-Policy"))
}

// @scenario "A caught message's HTML is rendered inert"
func TestCaughtHTMLHeadersAreSandboxed(t *testing.T) {
	s := newTestServer(t, Config{})
	raw := "Subject: html\r\nContent-Type: text/html\r\n\r\n" +
		"<html><body><script>alert(1)</script></body></html>\r\n"
	require.NoError(t, deliverRaw(t, s, "sender@example.com", []string{"a@stack.local"}, raw, nil))

	id := s.store.List("", "")[0].ID
	rec := doHTTP(s, "GET", "/api/messages/"+id+"/html")

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
	assert.Equal(t, "no-referrer", rec.Header().Get("Referrer-Policy"))
	assert.Equal(t, "SAMEORIGIN", rec.Header().Get("X-Frame-Options"))
	// The sandbox grants popups and nothing else: a link can be opened, and
	// scripts, forms, same-origin access and top-level navigation stay refused.
	csp := rec.Header().Get("Content-Security-Policy")
	assert.Equal(t, "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:", csp)
	for _, forbidden := range []string{"allow-scripts", "allow-same-origin", "allow-forms", "allow-top-navigation;"} {
		assert.NotContains(t, csp, forbidden, "a caught message must not be granted %s", forbidden)
	}
	// These headers must never be reached by unifying the two into one
	// middleware — the /html endpoint is not part of the API header group.
	assert.Empty(t, rec.Header().Get("Cache-Control"))
	assert.Contains(t, rec.Body.String(), "<script>alert(1)</script>")
}

// @scenario "The inbox is served in the browser at the stack's mail hostname"
func TestBrowserInboxRendersListAndMessage(t *testing.T) {
	s := newTestServer(t, Config{})
	raw := "Subject: from the browser\r\nContent-Type: text/html\r\n\r\n<p>rendered</p>\r\n"
	require.NoError(t, deliverRaw(t, s, "sender@example.com", []string{"a@stack.local"}, raw, nil))
	id := s.store.List("", "")[0].ID

	index := doHTTP(s, "GET", "/")
	require.Equal(t, http.StatusOK, index.Code)
	assert.Contains(t, index.Body.String(), "from the browser")

	view := doHTTP(s, "GET", "/messages/"+id)
	require.Equal(t, http.StatusOK, view.Code)
	assert.Contains(t, view.Body.String(), "/api/messages/"+id+"/html")
}

func TestMessageSurvivesRestartWhenDataDirSet(t *testing.T) {
	dir := t.TempDir()
	s1 := newTestServer(t, Config{DataDir: dir})
	require.NoError(t, deliverRaw(t, s1, "sender@example.com", []string{"a@stack.local"}, simpleMessage, nil))
	before := s1.store.List("", "")
	require.Len(t, before, 1)

	files, err := os.ReadDir(dir)
	require.NoError(t, err)
	require.NotEmpty(t, files)
	require.Equal(t, ".json", filepath.Ext(files[0].Name()))

	s2 := newTestServer(t, Config{DataDir: dir})
	after := s2.store.List("", "")
	require.Len(t, after, 1)
	assert.Equal(t, before[0].ID, after[0].ID)
	assert.Equal(t, before[0].Subject, after[0].Subject)
}

func TestListFiltersByToAndSubject(t *testing.T) {
	s := newTestServer(t, Config{})
	require.NoError(t, deliverRaw(t, s, "sender@example.com", []string{"user1@stack.local"}, "Subject: welcome\r\n\r\nhi\r\n", nil))
	require.NoError(t, deliverRaw(t, s, "sender@example.com", []string{"user2@stack.local"}, "Subject: invoice\r\n\r\nhi\r\n", nil))

	rec := doHTTP(s, "GET", "/api/messages?to=user1&subject=welcome")
	body := decodeJSON[struct {
		Messages []Summary `json:"messages"`
	}](t, rec)
	require.Len(t, body.Messages, 1)
	assert.Equal(t, "welcome", body.Messages[0].Subject)
}

// @scenario "Mail inbox actions load under the inbox security policy"
func TestInboxScriptAndSandbox(t *testing.T) {
	s := newTestServer(t, Config{})
	page := httptest.NewRecorder()
	s.Handler().ServeHTTP(page, httptest.NewRequest(http.MethodGet, "/", nil))
	assert.Contains(t, page.Body.String(), `src="/assets/ui.js"`)
	assert.NotContains(t, page.Body.String(), "onclick=")
	assert.NotContains(t, page.Header().Get("Content-Security-Policy"), "script-src 'unsafe-inline'")
	script := httptest.NewRecorder()
	s.Handler().ServeHTTP(script, httptest.NewRequest(http.MethodGet, "/assets/ui.js", nil))
	assert.Equal(t, http.StatusOK, script.Code)
	assert.Equal(t, "text/javascript; charset=utf-8", script.Header().Get("Content-Type"))
	preview := httptest.NewRecorder()
	s.Handler().ServeHTTP(preview, httptest.NewRequest(http.MethodGet, "/api/messages/missing/html", nil))
	assert.Contains(t, preview.Header().Get("Content-Security-Policy"), "sandbox; default-src 'none'")
}

// @scenario "Mail pages identify their stack and retain isolated inboxes"
func TestMailPageScopeAndIsolation(t *testing.T) {
	first := newTestServer(t, Config{BaseURL: "https://mail.feature-one.langwatch.localhost:1355", SMTPAddr: ":5581", DataDir: t.TempDir()})
	second := newTestServer(t, Config{BaseURL: "https://mail.feature-two.langwatch.localhost:1355"})
	require.NoError(t, deliverRaw(t, first, "sender@example.test", []string{"same@example.test"}, simpleMessage, nil))
	page := doHTTP(first, "GET", "/")
	require.Equal(t, http.StatusOK, page.Code)
	assert.Contains(t, page.Body.String(), "INBOX FOR feature-one")
	assert.Contains(t, page.Body.String(), "127.0.0.1:5581")
	assert.Contains(t, page.Body.String(), "survive service restarts")
	assert.Contains(t, page.Body.String(), "same@example.test")
	other := doHTTP(second, "GET", "/")
	assert.Contains(t, other.Body.String(), "INBOX FOR feature-two")
	assert.NotContains(t, other.Body.String(), "same@example.test")
	assert.Contains(t, other.Body.String(), "clears when MailSim restarts")
}
