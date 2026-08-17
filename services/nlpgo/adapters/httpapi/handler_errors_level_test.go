package httpapi

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap/zapcore"

	"github.com/langwatch/langwatch/services/nlpgo/domain"
)

// A failure the caller will retry is one attempt, not a verdict, so it must not
// log at error. Three SDK retries against one broken dispatch produced three
// identical ERROR lines and read like an outage.
//
// @scenario "A retryable failure is not logged as an error"
func TestHandlerFault_RetryableGatewayFailureLogsBelowError(t *testing.T) {
	fault, level := handlerFault(domain.ErrGatewayUnavailable)

	assert.Equal(t, "platform", fault, "the fault is still ours")
	assert.Less(t, level, zapcore.ErrorLevel,
		"a failure we hand back as retryable must not log at error")
}

// The downgrade is scoped to the retryable case: a terminal fault of ours is
// still an error.
func TestHandlerFault_TerminalPlatformFailureStaysAnError(t *testing.T) {
	fault, level := handlerFault(domain.ErrInternal)

	assert.Equal(t, "platform", fault)
	assert.Equal(t, zapcore.ErrorLevel, level)
}

// A customer's own bad request is neither ours nor an error.
func TestHandlerFault_CustomerFaultStaysInfo(t *testing.T) {
	fault, level := handlerFault(domain.ErrBadRequest)

	assert.Equal(t, "customer", fault)
	assert.Equal(t, zapcore.InfoLevel, level)
}
