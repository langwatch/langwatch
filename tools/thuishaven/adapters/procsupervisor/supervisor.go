// Package procsupervisor implements app.Supervisor: it runs child processes via
// `bash -lc` with prefixed output, restarts them on crash, and tears the whole
// process tree down when the context is cancelled. In agent mode it emits plain,
// colourless, redraw-free lines so an AI driver wastes no tokens on ANSI.
package procsupervisor

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// Supervisor is the real process-backed implementation of app.Supervisor.
type Supervisor struct{ isPlain bool }

// New returns a Supervisor. isAgent=true suppresses colour for token-free output.
func New(isAgent bool) Supervisor { return Supervisor{isPlain: isAgent} }

// RunOnce runs a command to completion, streaming its output.
func (s Supervisor) RunOnce(ctx context.Context, name, dir, shell string, env []string) error {
	c := proc{name: name, dir: dir, shell: shell, env: env, color: "90", isPlain: s.isPlain}
	cmd := c.command(ctx)
	c.pipe(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Wait()
}

// RunOnceBounded is RunOnce plus a reaper: a background poll kills the whole
// process group (the child owns its own group via Setpgid, same as every other
// supervised child) if its total RSS or wall-clock time crosses limits. Reaping
// returns a descriptive error rather than letting the caller see a bare "killed"
// exit status.
func (s Supervisor) RunOnceBounded(ctx context.Context, name, dir, shell string, env []string, limits app.ReapLimits) error {
	c := proc{name: name, dir: dir, shell: shell, env: env, color: "90", isPlain: s.isPlain}
	cmd := c.command(ctx)
	c.pipe(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}

	reapCtx, cancelReap := context.WithCancel(ctx)
	defer cancelReap()
	reaped := make(chan string, 1)
	if limits.MaxRSSBytes > 0 || limits.MaxDuration > 0 {
		go reap(reapCtx, cmd.Process.Pid, limits, reaped)
	}

	err := cmd.Wait()
	select {
	case reason := <-reaped:
		return fmt.Errorf("%s: %s", name, reason)
	default:
		return err
	}
}

// reap polls the process group's total RSS every 2s and enforces MaxDuration,
// killing the group (SIGKILL — a runaway tsgo has already ignored its chance to
// exit cleanly) the first time either bound is crossed.
func reap(ctx context.Context, pgid int, limits app.ReapLimits, reaped chan<- string) {
	start := time.Now()
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if limits.MaxDuration > 0 && time.Since(start) > limits.MaxDuration {
				reaped <- fmt.Sprintf("killed — running longer than %s", limits.MaxDuration)
				_ = syscall.Kill(-pgid, syscall.SIGKILL)
				return
			}
			if limits.MaxRSSBytes > 0 {
				if rss := groupRSSBytes(pgid); rss > limits.MaxRSSBytes {
					reaped <- fmt.Sprintf("killed — %dMB RSS over the %dMB limit", rss>>20, limits.MaxRSSBytes>>20)
					_ = syscall.Kill(-pgid, syscall.SIGKILL)
					return
				}
			}
		}
	}
}

// groupRSSBytes sums RSS (in bytes) across every process in the group. Shells
// out to `ps` rather than reading /proc (this runs on macOS, which has none) —
// the same "ask the OS's own tool" approach adapters/system already uses.
func groupRSSBytes(pgid int) int64 {
	out, err := exec.Command("ps", "-o", "rss=", "-g", fmt.Sprint(pgid)).Output()
	if err != nil {
		return 0
	}
	var total int64
	for _, line := range strings.Fields(string(out)) {
		var kb int64
		if _, err := fmt.Sscanf(line, "%d", &kb); err == nil {
			total += kb * 1024
		}
	}
	return total
}

// Supervise runs every child concurrently, restarting any that exit until the
// context is cancelled, then SIGTERMs (and finally SIGKILLs) the whole tree.
func (s Supervisor) Supervise(ctx context.Context, children []app.Child) {
	var wg sync.WaitGroup
	for _, ch := range children {
		wg.Add(1)
		go func(ac app.Child) {
			defer wg.Done()
			s.superviseChild(ctx, ac)
		}(ch)
	}
	wg.Wait()
}

// superviseChild runs one child, restarting it (1s backoff) on exit until ctx
// is cancelled, then SIGTERMs the process group and SIGKILLs after 5s.
func (s Supervisor) superviseChild(ctx context.Context, ac app.Child) {
	c := proc{name: ac.Name, dir: ac.Dir, shell: ac.Shell, env: ac.Env, color: ac.Color, isPlain: s.isPlain}
	for ctx.Err() == nil {
		cmd := c.command(ctx)
		c.pipe(cmd)
		if err := cmd.Start(); err != nil {
			c.logln(fmt.Sprintf("failed to start: %v", err))
			return
		}
		done := make(chan struct{})
		go func() { _ = cmd.Wait(); close(done) }()
		select {
		case <-ctx.Done():
			if cmd.Process != nil {
				_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
			}
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				if cmd.Process != nil {
					_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
				}
			}
			return
		case <-done:
			if ctx.Err() != nil {
				return
			}
			c.logln("exited — restarting in 1s")
			time.Sleep(time.Second)
		}
	}
}

type proc struct {
	name, dir, shell, color string
	env                     []string
	isPlain                 bool
}

func (c proc) command(ctx context.Context) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "bash", "-lc", c.shell)
	cmd.Dir = c.dir
	cmd.Env = append(os.Environ(), c.env...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // own group so we kill the tree
	cmd.Cancel = func() error { return nil }              // we manage teardown ourselves
	return cmd
}

func (c proc) pipe(cmd *exec.Cmd) {
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	go c.stream(stdout)
	go c.stream(stderr)
}

func (c proc) stream(r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	for sc.Scan() {
		c.logln(sc.Text())
	}
}

func (c proc) logln(line string) {
	line = strings.TrimRight(line, "\n")
	if c.isPlain {
		fmt.Printf("%-8s | %s\n", c.name, line)
		return
	}
	fmt.Printf("\x1b[%sm%-8s\x1b[0m │ %s\n", c.color, c.name, line)
}
