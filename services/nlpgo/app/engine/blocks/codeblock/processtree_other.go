//go:build !linux

// Process teardown everywhere but Linux, which in practice means a developer's
// macOS checkout: the shipped artifact is the Linux container.
//
// Killing the process group still happens, so everything user code starts in
// the ordinary way goes with the run. What is missing is the part that depends
// on PR_SET_CHILD_SUBREAPER and /proc: a grandchild that calls setsid(2) is
// not followed here, so it can outlive the execution on a developer machine.
// The tests for that property are Linux-only for the same reason.
package codeblock

import (
	"syscall"

	"go.uber.org/zap"
)

func enableProcessHardening() {}

func runStartMarker(int) uint64 { return 0 }

func terminateRunTree(scope runScope, _ *zap.Logger) {
	if scope.pgid > 0 {
		_ = syscall.Kill(-scope.pgid, syscall.SIGKILL)
	}
}
