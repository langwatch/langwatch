package mailsim

import (
	"strings"
	"testing"

	"github.com/emersion/go-sasl"
	"github.com/emersion/go-smtp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const simpleMessage = "Subject: hello\r\n\r\nHi there.\r\n"

// @scenario "A message delivered over SMTP is stored and never relayed"
func TestSMTPDeliveryIsStoredNeverRelayed(t *testing.T) {
	s := newTestServer(t, Config{})
	// A real-looking external domain — the sink has no relay code path, so
	// accepting it and storing it locally is the whole of "never relayed".
	err := deliverRaw(t, s, "sender@example.com", []string{"someone@gmail.com"}, simpleMessage, nil)
	require.NoError(t, err)

	messages := s.store.List("", "")
	require.Len(t, messages, 1)
	assert.Equal(t, "someone@gmail.com", messages[0].To[0])
}

// @scenario "A stored message keeps everything the sender said"
func TestSMTPStoredMessageKeepsEverything(t *testing.T) {
	s := newTestServer(t, Config{})
	raw := "Subject: full message\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: multipart/mixed; boundary=BOUNDARY\r\n" +
		"\r\n" +
		"--BOUNDARY\r\n" +
		"Content-Type: multipart/alternative; boundary=ALT\r\n" +
		"\r\n" +
		"--ALT\r\n" +
		"Content-Type: text/plain\r\n\r\n" +
		"Plain body text.\r\n" +
		"--ALT\r\n" +
		"Content-Type: text/html\r\n\r\n" +
		"<p>HTML body</p>\r\n" +
		"--ALT--\r\n" +
		"--BOUNDARY\r\n" +
		"Content-Type: text/plain; name=\"note.txt\"\r\n" +
		"Content-Disposition: attachment; filename=\"note.txt\"\r\n\r\n" +
		"attachment contents\r\n" +
		"--BOUNDARY--\r\n"

	err := deliverRaw(t, s, "sender@example.com", []string{"a@stack.local", "b@stack.local"}, raw, nil)
	require.NoError(t, err)

	messages := s.store.List("", "")
	require.Len(t, messages, 1)
	msg, ok := s.store.Get(messages[0].ID)
	require.True(t, ok)

	assert.Equal(t, "sender@example.com", msg.From)
	assert.ElementsMatch(t, []string{"a@stack.local", "b@stack.local"}, msg.To)
	assert.Equal(t, "full message", msg.Headers["Subject"])
	assert.Contains(t, msg.Text, "Plain body text.")
	assert.Contains(t, msg.HTML, "<p>HTML body</p>")
	require.Len(t, msg.Attachments, 1)
	assert.Equal(t, "note.txt", msg.Attachments[0].Filename)
	assert.False(t, msg.ReceivedAt.IsZero())
}

// @scenario "Credentials are accepted but never required"
func TestSMTPCredentialsAcceptedButNeverRequired(t *testing.T) {
	s := newTestServer(t, Config{})

	err := deliverRaw(t, s, "with-auth@example.com", []string{"a@stack.local"}, simpleMessage,
		sasl.NewPlainClient("", "any-user", "any-password"))
	require.NoError(t, err)

	err = deliverRaw(t, s, "no-auth@example.com", []string{"b@stack.local"}, simpleMessage, nil)
	require.NoError(t, err)

	messages := s.store.List("", "")
	assert.Len(t, messages, 2)
}

// @scenario "An oversized message is refused at delivery time"
func TestSMTPOversizedMessageRefused(t *testing.T) {
	s := newTestServer(t, Config{MaxMessageBytes: 32})
	raw := "Subject: too big\r\n\r\n" + strings.Repeat("x", 100) + "\r\n"

	err := deliverRaw(t, s, "sender@example.com", []string{"a@stack.local"}, raw, nil)
	require.Error(t, err)
	smtpErr, ok := err.(*smtp.SMTPError)
	require.True(t, ok, "expected an *smtp.SMTPError, got %T: %v", err, err)
	assert.Equal(t, 552, smtpErr.Code)
	assert.False(t, smtpErr.Temporary(), "552 must be a permanent failure")
	assert.Contains(t, smtpErr.Message, "32")

	assert.Empty(t, s.store.List("", ""), "the inbox must be left as it was")
}

// @scenario "Any local part at the stack's mail domain lands in the inbox"
func TestSMTPCatchAllRecordsExactRecipient(t *testing.T) {
	s := newTestServer(t, Config{})

	require.NoError(t, deliverRaw(t, s, "sender@example.com", []string{"user1@stack.local"}, simpleMessage, nil))
	require.NoError(t, deliverRaw(t, s, "sender@example.com", []string{"admin+alias@stack.local"}, simpleMessage, nil))

	messages := s.store.List("", "")
	require.Len(t, messages, 2)
	var recipients []string
	for _, m := range messages {
		recipients = append(recipients, m.To...)
	}
	assert.ElementsMatch(t, []string{"user1@stack.local", "admin+alias@stack.local"}, recipients)
}
