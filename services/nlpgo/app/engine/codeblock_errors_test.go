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
// @scenario "A failure raised by the customer's own code is reported as a code the client knows"
func TestNodeErrorFromCodeBlock(t *testing.T) {
	tests := []struct {
		name        string
		err         codeblock.Error
		wantType    string
		wantMessage string
		// rawTypeIsAName is false for the unnamed-failure row, where the input
		// Type is "". Asserting "the raw type is not the code" there was
		// vacuously true — the function never returns an empty code — so it
		// looked like the row was pinning the rule when it was pinning nothing.
		rawTypeIsAName bool
	}{
		{
			name:           "a timeout the runner synthesized gets the timeout code",
			err:            codeblock.Error{Type: codeblock.TimeoutType, Message: "code_block_timeout"},
			wantType:       "code_block_timeout",
			wantMessage:    "the code block ran past its time limit and was stopped",
			rawTypeIsAName: true,
		},
		{
			name:           "the runner failing to run at all is a code-runner error",
			err:            codeblock.Error{Type: codeblock.RunnerErrorType, Message: "empty_result"},
			wantType:       "code_runner_error",
			wantMessage:    "empty_result",
			rawTypeIsAName: true,
		},
		{
			name:           "a Python exception class becomes a code-runner error, keeping the class in the message",
			err:            codeblock.Error{Type: "ValueError", Message: "invalid literal for int()"},
			wantType:       "code_runner_error",
			wantMessage:    "ValueError: invalid literal for int()",
			rawTypeIsAName: true,
		},
		{
			name:           "an exception class we have never seen takes the same route",
			err:            codeblock.Error{Type: "SomeLibrarySpecificError", Message: "boom"},
			wantType:       "code_runner_error",
			wantMessage:    "SomeLibrarySpecificError: boom",
			rawTypeIsAName: true,
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
			if test.rawTypeIsAName {
				// Whatever the class was, the wire never carries it as a code.
				assert.NotEqual(t, test.err.Type, got.Type)
			}
		})
	}
}

// TestNodeErrorFromCodeBlockUsesTheProducersConstants pins the two synthesized
// discriminants to the package that writes them.
//
// The engine used to re-declare "Timeout" and "RunnerError" as its own consts
// while codeblock built them from bare literals, so renaming one side sent the
// timeout down the switch's `default` and reclassified it as a generic
// code_runner_error — with nothing failing to compile and no test going red.
// @scenario "A code node running past its time limit says so"
func TestNodeErrorFromCodeBlockUsesTheProducersConstants(t *testing.T) {
	timeout := nodeErrorFromCodeBlock(&codeblock.Error{Type: codeblock.TimeoutType, Message: "code_block_timeout"})
	assert.Equal(t, "code_block_timeout", timeout.Type,
		"the timeout the executor synthesizes must reach the client as the timeout code, not as a generic runner failure")

	runner := nodeErrorFromCodeBlock(&codeblock.Error{Type: codeblock.RunnerErrorType, Message: "empty_result"})
	assert.Equal(t, "code_runner_error", runner.Type)
	assert.Equal(t, "empty_result", runner.Message,
		"a runner failure is ours, so its message is not prefixed with a Python class name")
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

// @scenario "A failure with no name we recognize still lands on a known code"
func TestNodeErrorFromCodeBlockOnlyProducesKnownCodes(t *testing.T) {
	// classifyNodeFault is the closest thing the engine has to the client's
	// registry: a code it does not recognize falls through to faultPlatform,
	// which pages us for a customer's own Python bug.
	for _, raw := range []string{codeblock.TimeoutType, codeblock.RunnerErrorType, "ValueError", "KeyError", ""} {
		ne := nodeErrorFromCodeBlock(&codeblock.Error{Type: raw, Message: "boom"})
		assert.Equal(t, faultCustomer, classifyNodeFault(ne),
			"a code block failing is the customer's code failing, whatever %q was", raw)
	}
}
