package mailsim

import (
	"net/http"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// @scenario "A link in a caught message can be opened"
func TestPreviewLinksCanBeOpened(t *testing.T) {
	s := newTestServer(t, Config{})
	raw := "Subject: sign in\r\nContent-Type: text/html\r\n\r\n" +
		`<html><head><title>hi</title></head><body><a href="https://app.local/verify?a=1&amp;b=2">Sign in</a></body></html>` + "\r\n"
	require.NoError(t, deliverRaw(t, s, "sender@example.com", []string{"a@stack.local"}, raw, nil))
	id := s.store.List("", "")[0].ID

	t.Run("when the preview is served", func(t *testing.T) {
		rec := doHTTP(s, "GET", "/api/messages/"+id+"/html")
		require.Equal(t, http.StatusOK, rec.Code)

		// A frame allowed to open popups but not to navigate itself does nothing
		// with a plain anchor; the base is what turns the click into a new tab.
		assert.Contains(t, rec.Body.String(), `<base target="_blank">`)
		assert.Less(t, strings.Index(rec.Body.String(), "<base"), strings.Index(rec.Body.String(), "<title>"),
			"the base belongs inside the head, before anything that could resolve a URL")
	})

	t.Run("when the message's own links are listed", func(t *testing.T) {
		msg, ok := s.store.Get(id)
		require.True(t, ok)
		require.Len(t, msg.Links, 1)
		// Written in HTML the ampersand is escaped. Copied or clicked as it was
		// matched, the address is not the one the email meant.
		assert.Equal(t, "https://app.local/verify?a=1&b=2", msg.Links[0])
	})
}

// @scenario "A link in a caught message can be opened"
func TestPopupBaseLeavesASenderSBaseAlone(t *testing.T) {
	t.Run("given a message that declares its own base", func(t *testing.T) {
		body := `<html><head><base href="https://sender.example/"></head><body>hi</body></html>`
		assert.Equal(t, body, withPopupBase(body), "the sender said where its links resolve")
	})

	t.Run("given a fragment with no head at all", func(t *testing.T) {
		assert.Equal(t, `<base target="_blank"><p>hi</p>`, withPopupBase(`<p>hi</p>`))
	})

	t.Run("given no HTML body", func(t *testing.T) {
		assert.Empty(t, withPopupBase(""))
	})
}

// @scenario "URLs in a plain-text body are links, not characters to copy"
func TestPlainTextBodyIsLinkified(t *testing.T) {
	t.Run("given a text body with a URL in a sentence", func(t *testing.T) {
		m := &Message{}
		m.Text = "Open https://app.local/verify?a=1 to continue."
		got := string(m.LinkifiedText())

		assert.Contains(t, got, `<a href="https://app.local/verify?a=1" target="_blank" rel="noreferrer">`)
		// The full stop ends the sentence, not the address.
		assert.Contains(t, got, "</a> to continue.")
	})

	t.Run("given a text body that contains markup", func(t *testing.T) {
		m := &Message{}
		m.Text = "<script>alert(1)</script> and https://app.local/x"
		got := string(m.LinkifiedText())

		assert.Contains(t, got, "&lt;script&gt;", "a text body is text, whatever it contains")
		assert.NotContains(t, got, "<script>")
		assert.Contains(t, got, `href="https://app.local/x"`)
	})
}

// @scenario "The inbox can tell you a message arrived without you watching it"
func TestNotifyToggleStartsOff(t *testing.T) {
	s := newTestServer(t, Config{})
	rec := doHTTP(s, "GET", "/")
	require.Equal(t, http.StatusOK, rec.Code)
	page := rec.Body.String()

	t.Run("when the inbox is opened", func(t *testing.T) {
		button := regexp.MustCompile(`<button id="notify"[^>]*>`).FindString(page)
		require.NotEmpty(t, button, "the inbox offers desktop notifications")
		// Off until asked for: a page that demands notification permission on
		// load is one people deny permanently, and then the feature is gone for
		// good. Nothing on first load may call requestPermission.
		assert.Contains(t, button, `aria-pressed="false"`, "and it starts off")
	})

	t.Run("when the page script is served", func(t *testing.T) {
		script := doHTTP(s, "GET", "/assets/ui.js").Body.String()
		assert.Contains(t, script, "requestPermission", "permission is asked for")
		assert.Contains(t, script, `notifyButton.addEventListener("click"`,
			"and only from the button's own click handler")
		// The hidden-tab early return is what the toggle buys: with it on, the
		// tab keeps polling while it is in the background, which is the only
		// moment a notification is worth anything.
		assert.Contains(t, script, "document.hidden && !notifying")
	})
}
