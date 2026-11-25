package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
)

// execUnderRush replaces haven with argv for a caller already under rush's
// gate: rush queues the run, so a haven slot would only sit idle behind it.
func execUnderRush(argv []string, dir string) error {
	path, err := exec.LookPath(argv[0])
	if err != nil {
		fmt.Fprintf(os.Stderr, "checks: could not run %s: %v\n", argv[0], err)
		os.Exit(127)
	}
	if dir != "" {
		if err := os.Chdir(dir); err != nil {
			return err
		}
	}
	return syscall.Exec(path, argv, os.Environ()) //nolint:gosec // G204: runs the caller's own command
}
