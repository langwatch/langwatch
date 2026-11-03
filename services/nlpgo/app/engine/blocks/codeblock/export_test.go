package codeblock

import (
	"os"
	"syscall"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/redact"
)

// ScratchRoot is the directory this executor creates its per-execution
// directories in. Exported to the tests only: the root has no read permission
// precisely so nothing can enumerate it, so a test that needs to look inside
// has to be told where it is rather than find it.
func (e *Executor) ScratchRoot() string { return e.scratchRoot }

// RunEnv exposes the final-environment rule; visible says whether the engine
// itself runs in visible-process mode.
func RunEnv(env []string, visible bool) []string {
	mode := hideStrict
	if visible {
		mode = hideVisibleProcess
	}
	return runEnv(env, mode)
}

// HideModeFor exposes the refusal rule, as the mode's name.
func HideModeFor(refusal syscall.Errno, allow bool) string {
	return string(hideModeFor(refusal, allow))
}

// WithStderrTail exposes the runner-error stderr formatter to the tests.
var WithStderrTail = withStderrTail

// TruncatedPrefix exposes the marker that starts a cut stderr to the tests.
const TruncatedPrefix = truncatedPrefix

// MaxStderrInMessage exposes the tail bound to the tests.
const MaxStderrInMessage = maxStderrInMessage

// ReadRunnerStderr runs the stderr reader over raw bytes held in a file.
func ReadRunnerStderr(dir, raw string, secrets map[string]string) (string, error) {
	file, err := os.CreateTemp(dir, "stderr-")
	if err != nil {
		return "", err
	}
	defer file.Close()
	if _, err := file.WriteString(raw); err != nil {
		return "", err
	}
	return readRunnerStderr(file, redact.New(secrets)), nil
}

// MaxRunnerStderr exposes the stderr cap to the tests.
const MaxRunnerStderr = maxRunnerStderr
