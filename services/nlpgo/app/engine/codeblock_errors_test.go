package engine

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// The code runner's error type is an OPEN set — whatever Python exception class
// the customer's own function raised, plus the two the runner synthesizes. The
// engine used to forward it verbatim, so a `ValueError` reached the client as if
// it were one of our codes, with no copy written for it and nothing failing to
// compile. Every path now lands on a code the client knows.
func TestNodeErrorFromCodeBlock(t *testing.T) {
	tests := []struct {
		name        string
		err         codeblock.Error
		wantType    string
		wantMessage string
	}{
		{
			name:        "a timeout the runner synthesized gets the timeout code",
			err:         codeblock.Error{Type: "Timeout", Message: "code_block_timeout"},
			wantType:    "code_block_timeout",
			wantMessage: "the code block ran past its time limit and was stopped",
		},
		{
			name:        "the runner failing to run at all is a code-runner error",
			err:         codeblock.Error{Type: "RunnerError", Message: "empty_result"},
			wantType:    "code_runner_error",
			wantMessage: "empty_result",
		},
		{
			name:        "a Python exception class becomes a code-runner error, keeping the class in the message",
			err:         codeblock.Error{Type: "ValueError", Message: "invalid literal for int()"},
			wantType:    "code_runner_error",
			wantMessage: "ValueError: invalid literal for int()",
		},
		{
			name:        "an exception class we have never seen takes the same route",
			err:         codeblock.Error{Type: "SomeLibrarySpecificError", Message: "boom"},
			wantType:    "code_runner_error",
			wantMessage: "SomeLibrarySpecificError: boom",
		},
		{
			name:        "an unnamed failure carries just its message",
			err:         codeblock.Error{Message: "boom"},
			wantType:    "code_runner_error",
			wantMessage: "boom",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := nodeErrorFromCodeBlock(&test.err)

			assert.Equal(t, test.wantType, got.Type)
			assert.Equal(t, test.wantMessage, got.Message)
			// Whatever the class was, the wire never carries it as a code.
			assert.NotEqual(t, test.err.Type, got.Type)
		})
	}
}

func TestNodeErrorFromCodeBlockKeepsTheTraceback(t *testing.T) {
	// The traceback is the only thing that tells the customer which line of
	// their function raised, so normalising the code must not cost them it.
	got := nodeErrorFromCodeBlock(&codeblock.Error{
		Type:      "ZeroDivisionError",
		Message:   "division by zero",
		Traceback: "Traceback (most recent call last):\n  File \"<user>\", line 3",
	})

	assert.Contains(t, got.Traceback, "line 3")
}

func TestNodeErrorFromCodeBlockOnlyProducesKnownCodes(t *testing.T) {
	// classifyNodeFault is the closest thing the engine has to the client's
	// registry: a code it does not recognize falls through to faultPlatform,
	// which pages us for a customer's own Python bug.
	for _, raw := range []string{"Timeout", "RunnerError", "ValueError", "KeyError", ""} {
		ne := nodeErrorFromCodeBlock(&codeblock.Error{Type: raw, Message: "boom"})
		assert.Equal(t, faultCustomer, classifyNodeFault(ne),
			"a code block failing is the customer's code failing, whatever %q was", raw)
	}
}
