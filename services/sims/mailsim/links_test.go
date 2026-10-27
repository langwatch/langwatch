package mailsim

import (
	"net/http"
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
