package targets

import (
	"fmt"
	"sync"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
)

// SessionMaxBytes is the cap on a session an agent hands back
// (SESSION_MAX_BYTES in the agent contract).
const SessionMaxBytes = 64 * 1024

// sessionTooLargePrefix and sessionTooLargeCode are what the failure
// classifier reads a refused session by.
const (
	sessionTooLargePrefix = "Agent session too large"
	sessionTooLargeCode   = "agent_payload_too_large"
)

// absent marks a turn that said nothing about the session.
type absent struct{}

// Absent is the value an extractor returns when the turn named no session;
// it leaves the held session as it was. A JSON null is a value and is kept.
var Absent any = absent{}

// sessions is what a target keeps between the turns of one thread (ADR-128).
type sessions struct {
	mu   sync.Mutex
	held map[string]any
}

// of returns the session held for a thread, or nil.
func (s *sessions) of(threadID string) (any, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.held[threadID]
	return v, ok
}

// store keeps what the agent returned for the thread, refusing one above the cap.
func (s *sessions) store(threadID string, session any) error {
	if _, skip := session.(absent); skip {
		return nil
	}
	size := len(jsjson.Stringify(session))
	if size > SessionMaxBytes {
		return &Error{
			Name: "AgentSessionTooLargeError",
			Code: sessionTooLargeCode,
			Message: fmt.Sprintf("%s (%s): the agent returned a session of %d bytes, above the limit of %d bytes.",
				sessionTooLargePrefix, sessionTooLargeCode, size, SessionMaxBytes),
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.held == nil {
		s.held = map[string]any{}
	}
	s.held[threadID] = session
	return nil
}
