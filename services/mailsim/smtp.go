package mailsim

import (
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/emersion/go-sasl"
	"github.com/emersion/go-smtp"
)

// newSMTPServer builds the SMTP intake: it accepts AUTH PLAIN/LOGIN with any
// credentials, accepts unauthenticated delivery too, accepts any recipient,
// and never opens an outbound connection — there is no relay code path here
// at all.
func newSMTPServer(addr string, store *Store, maxMessageBytes int64) *smtp.Server {
	srv := smtp.NewServer(&backend{store: store, maxMessageBytes: maxMessageBytes})
	srv.Addr = addr
	srv.Domain = "mailsim.local"
	// The sink never speaks TLS — it is a loopback dev tool — so AUTH must be
	// allowed over the plain connection or a production-shaped client that
	// tries to authenticate would be refused before it ever reaches DATA.
	srv.AllowInsecureAuth = true
	srv.ReadTimeout = 30 * time.Second
	srv.WriteTimeout = 30 * time.Second
	return srv
}

// backend hands out one session per connection.
type backend struct {
	store           *Store
	maxMessageBytes int64
}

func (b *backend) NewSession(_ *smtp.Conn) (smtp.Session, error) {
	return &session{store: b.store, maxMessageBytes: b.maxMessageBytes}, nil
}

// session is one SMTP conversation: an optional AUTH, one MAIL FROM, one or
// more RCPT TO, then a single DATA.
type session struct {
	store           *Store
	maxMessageBytes int64
	from            string
	to              []string
}

// AuthMechanisms advertises PLAIN and LOGIN — the two a production-shaped
// mailer configuration might try.
func (s *session) AuthMechanisms() []string {
	return []string{sasl.Plain, sasl.Login}
}

// Auth accepts any credentials for either mechanism — a production-shaped
// SMTP configuration works against the sink unchanged, with no special
// "no auth" mode needed to test locally.
func (s *session) Auth(mech string) (sasl.Server, error) {
	switch mech {
	case sasl.Plain:
		return sasl.NewPlainServer(func(_, _, _ string) error { return nil }), nil
	case sasl.Login:
		return newLoginServer(), nil
	default:
		return nil, smtp.ErrAuthUnsupported
	}
}

func (s *session) Mail(from string, _ *smtp.MailOptions) error {
	s.from = from
	return nil
}

func (s *session) Rcpt(to string, _ *smtp.RcptOptions) error {
	s.to = append(s.to, to)
	return nil
}

// Data reads the message body, refusing anything over the size cap with a
// permanent error naming the limit, and otherwise stores it.
func (s *session) Data(r io.Reader) error {
	limited := io.LimitReader(r, s.maxMessageBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return err
	}
	if int64(len(raw)) > s.maxMessageBytes {
		// The DATA reader's dot-unstuffing state machine has not yet reached
		// the end-of-data marker — drain it so the next command on this
		// connection is not read as leftover message body.
		_, _ = io.Copy(io.Discard, r)
		return &smtp.SMTPError{
			Code:         552,
			EnhancedCode: smtp.EnhancedCode{5, 3, 4},
			Message:      fmt.Sprintf("message exceeds the %d byte limit", s.maxMessageBytes),
		}
	}
	msg := parseMessage(raw, envelope{From: s.from, To: s.to, ReceivedAt: time.Now().UTC()})
	return s.store.Deliver(msg)
}

func (s *session) Reset() {
	s.from = ""
	s.to = nil
}

func (s *session) Logout() error {
	return nil
}

// loginServer is a minimal server side of the (informal, but widely
// implemented) AUTH LOGIN mechanism: Username: then Password:, any answer
// accepted. go-sasl ships client and server halves of PLAIN but only the
// client half of LOGIN, so this is the missing server half.
type loginServer struct {
	step     int
	username string
}

func newLoginServer() sasl.Server {
	return &loginServer{}
}

func (l *loginServer) Next(response []byte) (challenge []byte, done bool, err error) {
	switch l.step {
	case 0:
		l.step = 1
		if len(response) > 0 {
			// A client that sent its username as the initial response skips
			// straight to the password prompt.
			l.username = string(response)
			l.step = 2
			return []byte("Password:"), false, nil
		}
		return []byte("Username:"), false, nil
	case 1:
		l.username = string(response)
		l.step = 2
		return []byte("Password:"), false, nil
	case 2:
		return nil, true, nil
	default:
		return nil, true, errors.New("unexpected LOGIN authentication state")
	}
}
