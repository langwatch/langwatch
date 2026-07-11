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
type Supervisor struct{ plain bool }

// New returns a Supervisor. agent=true suppresses colour for token-free output.
func New(agent bool) Supervisor { return Supervisor{plain: agent} }

// RunOnce runs a command to completion, streaming its output.
func (s Supervisor) RunOnce(ctx context.Context, name, dir, shell string, env []string) error {
	c := proc{name: name, dir: dir, shell: shell, env: env, color: "90", plain: s.plain}
	cmd := c.command(ctx)
	c.pipe(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Wait()
}

// Supervise runs every child concurrently, restarting any that exit until the
// context is cancelled, then SIGTERMs (and finally SIGKILLs) the whole tree.
func (s Supervisor) Supervise(ctx context.Context, children []app.Child) {
	var wg sync.WaitGroup
	for _, ch := range children {
		wg.Add(1)
		go func(ac app.Child) {
			defer wg.Done()
			c := proc{name: ac.Name, dir: ac.Dir, shell: ac.Shell, env: ac.Env, color: ac.Color, plain: s.plain}
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
		}(ch)
	}
	wg.Wait()
}

type proc struct {
	name, dir, shell, color string
	env                     []string
	plain                   bool
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
	if c.plain {
		fmt.Printf("%-8s | %s\n", c.name, line)
		return
	}
	fmt.Printf("\x1b[%sm%-8s\x1b[0m │ %s\n", c.color, c.name, line)
}
