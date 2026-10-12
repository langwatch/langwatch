package claudecode

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"time"

	scenario "github.com/langwatch/scenario/go"
)

// runTurn runs exactly one CLI invocation and returns its transcript. It
// reads the configuration but changes no adapter state: the session policy
// is Call's. The transcript, and so its session id, only ever comes from a
// run that succeeded.
func (a *ClaudeCodeAgentAdapter) runTurn(ctx context.Context, promptMessages, history []scenario.Message, resumeSessionID string, stream *scenario.MessageStream) (*Transcript, error) {
	prompt := formatPrompt(promptMessages, toolNameResolver(history))
	if !hasRenderableContent(prompt) {
		return nil, fmt.Errorf("%w; ensure a user turn precedes the agent (a scenario.User(...) step before scenario.Agent())", ErrNoPrompt)
	}

	if ctx.Err() != nil {
		return nil, fmt.Errorf("context ended before the Claude Code CLI started: %w", context.Cause(ctx))
	}
	dir := a.cfg.WorkingDirectory
	bin := a.resolveBin()
	a.logger.Info("Starting Claude Code", "dir", dir)

	p := newParser(a.limits, a.logger)
	a.attachStream(p, stream)
	logLines := a.logger.Enabled(ctx, slog.LevelInfo)
	stdout := &lineWriter{line: func(line []byte) {
		if logLines {
			a.logger.Info("Claude Code stdout", "line", string(line))
		}
		p.parseLine(line)
	}}
	stderr := &stderrSink{logger: a.logger}

	cmd := exec.Command(bin, a.buildArgs(prompt, resumeSessionID)...)
	cmd.Dir = dir
	cmd.Env = a.buildEnv()
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	// Bounds how long descendants of an exited CLI may hold its output open.
	cmd.WaitDelay = a.killGrace
	ownProcessGroup(cmd)
	if err := cmd.Start(); err != nil {
		return nil, startError(bin, dir, err)
	}
	startWatchdog(a.watchdogShell, cmd.Process.Pid)

	turnCtx, cancel := context.WithTimeoutCause(ctx, a.timeout, ErrTimeout)
	defer cancel()
	stopped, waitErr := a.wait(turnCtx, cmd)
	stdout.flush()
	if stopped {
		if cause := context.Cause(turnCtx); !errors.Is(cause, ErrTimeout) {
			return nil, fmt.Errorf("stopped the Claude Code CLI: %w", cause)
		}
		//lint:ignore ST1005 same message as the JS SDK's Claude Code adapter
		return nil, fmt.Errorf("Claude Code CLI timed out after %s in %s: %w", a.timeout, dir, ErrTimeout)
	}
	if cmd.ProcessState == nil {
		return nil, fmt.Errorf("wait for Claude Code CLI: %w", waitErr)
	}

	// Parse first, judge second: the result envelope fields the run's status
	// more reliably than the exit code.
	t := p.transcript()
	exitCode, signal := exitStatus(cmd.ProcessState)
	if signal != "" || exitCode != 0 || t.Result.IsError {
		return nil, newCLIError(exitCode, signal, strings.TrimSpace(stderr.String()), t.Result)
	}
	return t, nil
}

// wait waits for the CLI. When ctx ends first it terminates the CLI's
// process group, kills it after the grace period, and still waits for it,
// so the CLI never outlives the turn; stopped then reports true. The group
// is killed even when the CLI exits within the grace period, since its
// children may ignore the termination and would outlive it otherwise.
func (a *ClaudeCodeAgentAdapter) wait(ctx context.Context, cmd *exec.Cmd) (stopped bool, err error) {
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return false, err
	case <-ctx.Done():
	}
	terminateGroup(cmd.Process)
	grace := time.NewTimer(a.killGrace)
	defer grace.Stop()
	select {
	case err = <-done:
	case <-grace.C:
		killGroup(cmd.Process)
		return true, <-done
	}
	// The CLI is gone; give what it spawned the rest of the grace period.
	poll := time.NewTicker(groupPollInterval)
	defer poll.Stop()
	for groupAlive(cmd.Process) {
		select {
		case <-poll.C:
		case <-grace.C:
			killGroup(cmd.Process)
			return true, err
		}
	}
	return true, err
}

// groupPollInterval is how often wait checks for leftovers of a stopped CLI.
const groupPollInterval = 20 * time.Millisecond

// startError explains a CLI that could not be started.
func startError(bin, dir string, err error) error {
	if errors.Is(err, exec.ErrNotFound) || errors.Is(err, fs.ErrNotExist) {
		if _, statErr := os.Stat(dir); statErr != nil {
			return fmt.Errorf("check the Claude Code working directory: %w", statErr)
		}
		//lint:ignore ST1005 same message as the JS SDK's Claude Code adapter
		return fmt.Errorf("Claude Code CLI not found: %s. Install it or set ClaudeBin/CLAUDE_BIN: %w", bin, ErrCLINotFound)
	}
	return fmt.Errorf("start Claude Code CLI %s: %w", bin, err)
}

// attachStream reports the turn live on the message stream (a no-op when
// granular events are off). Only what the returned first message will hold
// is streamed, since that is the message the stream reconciles with: the
// text as it grows, or the first assistant message with its tool calls.
func (a *ClaudeCodeAgentAdapter) attachStream(p *parser, s *scenario.MessageStream) {
	if s == nil {
		return
	}
	if a.cfg.Output != OutputMessages {
		p.onText = s.TextDelta
		return
	}
	streamed := false
	p.onMessage = func(m scenario.Message) {
		if streamed || m.Role != scenario.RoleAssistant {
			return
		}
		streamed = true
		s.TextDelta(m.Text())
		for _, tc := range m.ToolCalls {
			s.ToolCallStart(tc.ID, tc.Name)
			s.ToolCallArgs(tc.ID, tc.Arguments)
			s.ToolCallEnd(tc.ID)
		}
	}
}

// toolNameResolver finds the tool a call id belongs to in the conversation,
// built on first use.
func toolNameResolver(history []scenario.Message) func(string) string {
	var names map[string]string
	return func(callID string) string {
		if names == nil {
			names = map[string]string{}
			for _, m := range history {
				for _, tc := range m.ToolCalls {
					names[tc.ID] = tc.Name
				}
			}
		}
		if name, ok := names[callID]; ok {
			return name
		}
		return "unknown"
	}
}
