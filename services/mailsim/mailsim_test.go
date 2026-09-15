package mailsim

import (
	"encoding/json"
	"net"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/emersion/go-sasl"
	"github.com/emersion/go-smtp"
	"github.com/stretchr/testify/require"
)

// newTestServer builds a server whose HTTP surface is driven in-process and
// whose SMTP listener is bound on an ephemeral loopback port, ready to dial.
func newTestServer(t *testing.T, cfg Config) *Server {
	t.Helper()
	if cfg.HTTPAddr == "" {
		cfg.HTTPAddr = "127.0.0.1:0"
	}
	if cfg.MaxMessageBytes == 0 {
		cfg.MaxMessageBytes = defaultMaxMessageBytes
	}
	s, err := NewServer(cfg)
	require.NoError(t, err)
	// The readiness probe below closes its connection before completing a
	// conversation, which the server would otherwise report as a spurious
	// "connection reset by peer" — noise, not a signal, in a test's output.
	s.smtp.ErrorLog = discardLogger{}

	smtpListener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	s.smtp.Addr = smtpListener.Addr().String()
	go func() { _ = s.smtp.Serve(smtpListener) }()
	t.Cleanup(func() { _ = s.smtp.Close() })
	waitDialable(t, smtpListener.Addr().String())

	return s
}

func (s *Server) smtpAddr() string { return s.smtp.Addr }

// discardLogger silences the SMTP server's internal error log during tests.
type discardLogger struct{}

func (discardLogger) Printf(string, ...any) {}
func (discardLogger) Println(...any)        {}

// deliverRaw dials the server's SMTP listener and delivers one message,
// optionally authenticating first with auth (nil for no AUTH at all).
func deliverRaw(t *testing.T, s *Server, from string, to []string, raw string, auth sasl.Client) error {
	t.Helper()
	c, err := smtp.Dial(s.smtpAddr())
	require.NoError(t, err)
	defer c.Close()

	if auth != nil {
		if err := c.Auth(auth); err != nil {
			return err
		}
	}
	if err := c.Mail(from, nil); err != nil {
		return err
	}
	for _, addr := range to {
		if err := c.Rcpt(addr, nil); err != nil {
			return err
		}
	}
	wc, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := wc.Write([]byte(raw)); err != nil {
		_ = wc.Close()
		return err
	}
	if err := wc.Close(); err != nil {
		return err
	}
	// QUIT closes the connection cleanly, rather than dropping it while the
	// server may still be reading — which is what produces the harmless but
	// noisy "connection reset by peer" line in the test server's log.
	_ = c.Quit()
	return nil
}

func doHTTP(s *Server, method, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func doHTTPDelete(s *Server, path string) *httptest.ResponseRecorder {
	return doHTTP(s, "DELETE", path)
}

func decodeJSON[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	return out
}

func waitDialable(t *testing.T, addr string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 100*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("smtp listener at %s never came up", addr)
}
