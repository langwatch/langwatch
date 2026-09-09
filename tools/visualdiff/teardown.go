package visualdiff

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
)

// KillDevTreeScript frees dev ports by taking down the process group behind
// each one. Reusing it is the point: it already gets right the two things a
// one-liner does not — that `concurrently` replaces a lane you merely SIGTERM,
// and that a briefly free port is not a stopped stack.
const KillDevTreeScript = "dev/scripts/kill-dev-tree.sh"

// KillPortsCommand builds the kill-dev-tree invocation for a set of ports.
func KillPortsCommand(ports []int) commandSpec {
	rendered := make([]string, 0, len(ports))
	for _, port := range ports {
		if port > 0 {
			rendered = append(rendered, strconv.Itoa(port))
		}
	}
	return commandSpec{name: "bash", args: []string{KillDevTreeScript, strings.Join(rendered, ",")}}
}

// WorktreeRemoveCommand builds the worktree removal for one stack directory.
func WorktreeRemoveCommand(dir string) commandSpec {
	return commandSpec{name: "git", args: []string{"worktree", "remove", "--force", dir}}
}

// Teardown stops both stacks and removes both worktrees. It runs on every
// exit path, including a failed boot: a run that leaves two Vite servers and
// two worktrees behind costs the next run its ports.
type Teardown struct {
	Root      string
	Run       runner
	Listening func(int) bool
	Log       io.Writer
	Keep      bool
}

// Do frees the ports, verifies they are free, and removes the worktrees it
// owns. Every failure is reported and none of them aborts the rest — a
// half-done teardown is worse than a noisy one.
func (teardown Teardown) Do(ctx context.Context, ports []int, worktrees []string) error {
	if teardown.Keep {
		teardown.logf("teardown: -keep set, leaving both stacks and both worktrees up")
		return nil
	}
	var problems []string
	kill := KillPortsCommand(ports)
	kill.dir = teardown.Root
	if err := teardown.Run(ctx, kill, teardown.writer()); err != nil {
		problems = append(problems, fmt.Sprintf("kill ports: %v", err))
	}
	for _, port := range teardown.stillListening(ports) {
		problems = append(problems, fmt.Sprintf("port %d is still listening after teardown", port))
	}
	for _, dir := range worktrees {
		remove := WorktreeRemoveCommand(dir)
		remove.dir = teardown.Root
		if err := teardown.Run(ctx, remove, teardown.writer()); err != nil {
			problems = append(problems, fmt.Sprintf("worktree remove %s: %v", dir, err))
		}
	}
	if len(problems) == 0 {
		return nil
	}
	return fmt.Errorf("teardown: %s", strings.Join(problems, "; "))
}

func (teardown Teardown) stillListening(ports []int) []int {
	listening := teardown.Listening
	if listening == nil {
		listening = PortListening
	}
	var held []int
	for _, port := range ports {
		if port > 0 && listening(port) {
			held = append(held, port)
		}
	}
	return held
}

func (teardown Teardown) writer() io.Writer {
	if teardown.Log == nil {
		return io.Discard
	}
	return teardown.Log
}

func (teardown Teardown) logf(format string, args ...any) {
	if teardown.Log != nil {
		fmt.Fprintf(teardown.Log, format+"\n", args...)
	}
}

// commandSpec describes one external command invocation.
type commandSpec struct {
	name string
	args []string
	dir  string
	env  []string
}

// runner executes external commands; tests swap it out.
type runner func(ctx context.Context, spec commandSpec, log io.Writer) error

// allowedCommands are the only executables this tool runs. Every commandSpec
// in the package is built from these constants, so a subprocess name is never
// tainted input. haven joined the list when the stacks moved onto it.
var allowedCommands = map[string]bool{"git": true, "pnpm": true, "bash": true, "node": true, "haven": true}

// execRunner runs one command, streaming its output to log.
func execRunner(ctx context.Context, spec commandSpec, log io.Writer) error {
	if !allowedCommands[spec.name] {
		return fmt.Errorf("refusing to run unlisted command %q", spec.name)
	}
	// #nosec G204 -- spec.name is restricted to the allowedCommands allowlist
	// above, and args are built from constants and the tool's own config.
	command := exec.CommandContext(ctx, spec.name, spec.args...)
	command.Dir = spec.dir
	if spec.env != nil {
		command.Env = spec.env
	}
	command.Stdout = log
	command.Stderr = log
	return command.Run()
}
