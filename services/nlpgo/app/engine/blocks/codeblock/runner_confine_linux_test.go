//go:build linux

package codeblock_test

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// runnerConfinement loads runner.py as a module, without running main, and
// tries one way out of the run's process group after confine_process_group.
// It exits 0 when the attempt is refused as the case expects, 77 to skip.
const runnerConfinement = `import os, platform, subprocess, sys, types

runner = types.ModuleType("runner_under_test")
try:
    exec(compile(open("runner.py").read(), "runner.py", "exec"), runner.__dict__)
except OSError as e:
    print(f"the runner cannot hide itself on this host: {e}", file=sys.stderr)
    sys.exit(77)
case = sys.argv[1]

if case == "unknown-machine":
    platform.machine = lambda: "pdp11"
    try:
        runner.confine_process_group()
    except OSError as e:
        sys.exit(0 if "no syscall filter for pdp11" in str(e) else f"wrong refusal: {e}")
    sys.exit("a machine with no syscall table was confined anyway")

if sys.version_info < (3, 11):
    print("process_group needs Python 3.11", file=sys.stderr)
    sys.exit(77)
try:
    runner.confine_process_group()
except OSError as e:
    print(f"this host refuses the filter: {e}", file=sys.stderr)
    sys.exit(77)

attempts = {
    "setpgid": lambda: os.setpgid(0, 0),
    "process-group": lambda: subprocess.run([sys.executable, "-c", "pass"], process_group=0, check=True),
    "setsid": os.setsid,
}
try:
    attempts[case]()
except PermissionError:
    sys.exit(0)
sys.exit(f"{case} was allowed inside a confined run")
`

// @scenario "on AWS Lambda, nothing user code starts outlives its run"
func TestRunner_ConfinementRefusesEveryWayOutOfTheProcessGroup(t *testing.T) {
	requirePython(t)
	for _, attempt := range []string{"setsid", "setpgid", "process-group", "unknown-machine"} {
		t.Run(attempt, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "python3", "-I", "-c", runnerConfinement, attempt)
			cmd.Env = []string{"PATH=" + os.Getenv("PATH")}
			var out bytes.Buffer
			cmd.Stdout, cmd.Stderr = &out, &out
			err := cmd.Run()
			if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == skipExitCode {
				if os.Getenv("CI") != "" {
					t.Fatalf("CI must run this case: %s", out.String())
				}
				t.Skipf("cannot run this case here: %s", out.String())
			}
			require.NoError(t, err, "%s", out.String())
		})
	}
}
