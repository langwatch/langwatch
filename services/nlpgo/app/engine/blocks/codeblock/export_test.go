package codeblock

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
