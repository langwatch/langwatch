package domain

// TurnFailure describes how a turn ended when it did not complete: the vetted
// error code the terminal frame carries plus a client-safe message. The message
// is the same prose the control plane's error card can show (vetted copy, or a
// provider's own error message on an LLM rejection), so attaching it to the
// customer-facing turn span is safe by construction.
type TurnFailure struct {
	Code    string
	Message string
}
