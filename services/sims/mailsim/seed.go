package mailsim

import "time"

// sample is one demo message, in the shape the stack's own mail takes.
type sample struct{ from, to, subject, text string }

var samples = []sample{
	{"noreply@langwatch.local", "demo@example.com", "Verify your email", "Welcome to LangWatch. Verify your address: http://localhost:5560/verify?token=demo-token"},
	{"noreply@langwatch.local", "demo@example.com", "You have been invited to Demo Org", "Accept the invite: http://localhost:5560/invite/accept?token=demo-invite"},
	{"alerts@langwatch.local", "oncall@example.com", "Trigger fired: high error rate", "Your trigger fired. Open the trace: http://localhost:5560/demo/messages"},
}

// seedInbox delivers the sample messages when MAILSIM_SEED=1, so the inbox
// starts with content instead of empty.
func seedInbox(st *Store) error {
	for _, m := range samples {
		msg := &Message{
			Summary: Summary{From: m.from, To: []string{m.to}, Subject: m.subject, ReceivedAt: time.Now().UTC(), SizeBytes: len(m.text)},
			Headers: map[string]string{"From": m.from, "To": m.to, "Subject": m.subject},
			Text:    m.text,
			Links:   extractLinks(m.text, ""),
		}
		if err := st.Deliver(msg); err != nil {
			return err
		}
	}
	return nil
}
