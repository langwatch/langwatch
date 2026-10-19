//go:build darwin

package system

import "golang.org/x/sys/unix"

// darwinMemSize reads hw.memsize through the sysctl syscall: every slotted run
// asks for it, and exec'ing sysctl cost a process spawn each time.
func darwinMemSize() uint64 {
	n, err := unix.SysctlUint64("hw.memsize")
	if err != nil {
		return 0
	}
	return n
}
