package codeblock

// ScratchRoot is the directory this executor creates its per-execution
// directories in. Exported to the tests only: the root has no read permission
// precisely so nothing can enumerate it, so a test that needs to look inside
// has to be told where it is rather than find it.
func (e *Executor) ScratchRoot() string { return e.scratchRoot }

// WithStderrTail exposes the runner-error stderr formatter to the tests.
var WithStderrTail = withStderrTail

// MaxStderrInMessage exposes the tail bound to the tests.
const MaxStderrInMessage = maxStderrInMessage
