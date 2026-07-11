package portlessproxy

import "syscall"

// sig0 probes process existence without delivering a signal.
var sig0 = syscall.Signal(0)
