package claudecode

import (
	"errors"
	"strconv"
	"strings"
)

// Sentinel errors, for errors.Is.
var (
	// ErrTimeout reports a turn that outlived Config.Timeout.
	ErrTimeout = errors.New("claude code CLI timed out")
	// ErrCLINotFound reports a claude binary that could not be found.
	ErrCLINotFound = errors.New("claude code CLI not found")
	// ErrNoPrompt reports a turn with nothing to send: the CLI is prompt
	// driven and cannot open a conversation on its own.
	ErrNoPrompt = errors.New("claude code adapter received no messages to send to the CLI")
)

// CLIError is a Claude Code run that failed: the CLI exited non-zero, died
// on a signal, or fielded is_error on its terminal result envelope.
//
// Stderr and Errors are unredacted CLI output and may echo sensitive detail
// (environment values, a rejected key); the message embeds Errors, or Stderr
// when the envelope carried none. Redact before logging to a shared sink.
type CLIError struct {
	// ExitCode is the exit status, or -1 when the CLI died on a signal.
	ExitCode int
	// Signal names the signal that killed the CLI ("SIGKILL"), or "".
	Signal string
	// Stderr is the CLI's trimmed stderr.
	Stderr string
	// Subtype is the result envelope's failure class, e.g.
	// "error_during_execution".
	Subtype string
	// Errors are the error sentences the result envelope fielded.
	Errors []string
	msg    string
}

func newCLIError(exitCode int, signal, stderr string, result ResultEnvelope) *CLIError {
	detail := stderr
	if len(result.Errors) > 0 {
		detail = strings.Join(result.Errors, "; ")
	}
	if detail != "" {
		detail = ": " + detail
	}
	var msg string
	switch {
	case signal != "":
		msg = "Claude Code CLI was terminated by signal " + signal + detail
	case exitCode != 0:
		msg = "Claude Code CLI failed with exit code " + strconv.Itoa(exitCode) + detail
	default:
		msg = "Claude Code CLI reported an error result"
		if result.Subtype != "" {
			msg += " (" + result.Subtype + ")"
		}
		msg += detail
	}
	return &CLIError{
		ExitCode: exitCode,
		Signal:   signal,
		Stderr:   stderr,
		Subtype:  result.Subtype,
		Errors:   result.Errors,
		msg:      msg,
	}
}

func (e *CLIError) Error() string { return e.msg }

// staleSession reports whether the failure means the resumed session no
// longer exists server-side, the one failure a turn can recover from.
// The structural signal (an error_during_execution envelope naming a missing
// conversation) comes first; older CLIs only say so on stderr with a non-zero
// exit. A signal death is never a stale session.
func (e *CLIError) staleSession() bool {
	if e.Signal != "" {
		return false
	}
	if e.Subtype == "error_during_execution" {
		for _, s := range e.Errors {
			if namesMissingConversation(s) {
				return true
			}
		}
	}
	return e.ExitCode != 0 && namesMissingConversation(e.Stderr)
}

func namesMissingConversation(s string) bool {
	return strings.Contains(strings.ToLower(s), "no conversation found")
}

// LostSessionError is returned when a --resume'd session has vanished
// server-side and Config.ReplayOnLostSession is off. errors.As finds the
// originating *CLIError through it, so a caller branching on CLIError still
// catches it while LostSessionError singles this failure out.
type LostSessionError struct {
	// SessionID is the evicted session id --resume could no longer find.
	SessionID string
	// ThreadID is the thread whose session vanished.
	ThreadID string
	// Cause is the originating CLI failure.
	Cause *CLIError
}

func (e *LostSessionError) Error() string {
	return "Claude Code session " + e.SessionID + " for thread " + e.ThreadID + " no longer exists " +
		"(--resume reported: No conversation found). Set ReplayOnLostSession: true to rebuild " +
		"this turn from the full transcript instead; note that replays the conversation as a " +
		"flat prompt into a NEW session and loses server-side session state (context cache, " +
		"tool state), so the turn is no longer a true session continuation."
}

// Unwrap returns the originating CLI failure.
func (e *LostSessionError) Unwrap() error { return e.Cause }
