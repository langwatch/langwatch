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
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// Supervisor is the real process-backed implementation of app.Supervisor.
type Supervisor struct {
	isPlain bool
	recent  *recentLogs
}

type recentLogs struct {
	sync.Mutex
	lines []string
}

// New returns a Supervisor. isAgent=true suppresses colour for token-free output.
func New(isAgent bool) Supervisor {
	return Supervisor{isPlain: isAgent, recent: &recentLogs{}}
}

// RunOnce runs a command to completion, streaming its output.
func (s Supervisor) RunOnce(ctx context.Context, name, dir, shell string, env []string) error {
	c := proc{name: name, dir: dir, shell: shell, env: env, color: "90", isPlain: s.isPlain}
	cmd := c.command(ctx)
	c.pipe(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan struct{})
	go killOnCancel(ctx, cmd, done)
	err := cmd.Wait()
	close(done)
	return err
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
	done := make(chan struct{})
	go killOnCancel(ctx, cmd, done)

	reapCtx, cancelReap := context.WithCancel(ctx)
	defer cancelReap()
	reaped := make(chan string, 1)
	if limits.MaxRSSBytes > 0 || limits.MaxDuration > 0 {
		go reap(reapCtx, cmd.Process.Pid, limits, reaped)
	}

	err := cmd.Wait()
	close(done)
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
	reapOrphans(children, os.Getpid())
	if !s.isPlain {
		fmt.Print("\x1b[?1049h\x1b[?25l")
		defer fmt.Print("\x1b[?25h\x1b[?1049l\x1b[0m")
		go renderUp(ctx, s.recent, children)
	}
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

func killOnCancel(ctx context.Context, cmd *exec.Cmd, done <-chan struct{}) {
	select {
	case <-done:
		return
	case <-ctx.Done():
		if cmd.Process != nil {
			// The first Ctrl-C is a hard stop for the launcher tree. Cleanup runs
			// after the children are gone and must never hold the terminal hostage.
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
	}
}

func reapOrphans(children []app.Child, self int) {
	knownDirs := make([]string, 0, len(children))
	for _, child := range children {
		if child.Dir != "" {
			knownDirs = append(knownDirs, child.Dir)
		}
	}
	out, err := exec.Command("ps", "-axo", "pid=,ppid=,pgid=,command=").Output()
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		var pid, ppid, pgid int
		if _, err := fmt.Sscanf(fields[0], "%d", &pid); err != nil {
			continue
		}
		if _, err := fmt.Sscanf(fields[1], "%d", &ppid); err != nil {
			continue
		}
		if _, err := fmt.Sscanf(fields[2], "%d", &pgid); err != nil {
			continue
		}
		if pid == self || ppid != 1 || pgid <= 0 {
			continue
		}
		command := strings.Join(fields[3:], " ")
		if !knownDevRuntime(command) || !containsAny(command, knownDirs) {
			continue
		}
		_ = syscall.Kill(-pgid, syscall.SIGTERM)
	}
}

func ReapOrphans(dirs []string) {
	children := make([]app.Child, 0, len(dirs))
	for _, dir := range dirs {
		children = append(children, app.Child{Dir: dir})
	}
	reapOrphans(children, os.Getpid())
}

func knownDevRuntime(command string) bool {
	for _, token := range []string{"tsgo", "vite", "tsx", "pnpm", "node", "opencode", "go run", "service", "uv", "python"} {
		if strings.Contains(command, token) {
			return true
		}
	}
	return false
}

func containsAny(value string, needles []string) bool {
	for _, needle := range needles {
		if needle != "" && strings.Contains(value, needle) {
			return true
		}
	}
	return false
}

// superviseChild runs one child, restarting it (1s backoff) on exit until ctx
// is cancelled, then SIGTERMs the process group and SIGKILLs after 5s.
func (s Supervisor) superviseChild(ctx context.Context, ac app.Child) {
	c := proc{name: ac.Name, dir: ac.Dir, shell: ac.Shell, env: ac.Env, color: ac.Color, isPlain: s.isPlain, preview: s.recent}
	// Gate the start on a dependency being ready (e.g. the web lane on the API),
	// so this process — and the hostname routed to it — never comes up before what
	// it needs is serving.
	if ac.ReadyProbeURL != "" {
		waitForReady(ctx, ac.ReadyProbeURL, c.logln)
		if ctx.Err() != nil {
			return
		}
	}
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
				_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			}
			<-done
			return
		case <-done:
			if ctx.Err() != nil {
				return
			}
			c.logln("exited — restarting in 1s")
			select {
			case <-ctx.Done():
			case <-time.After(time.Second):
			}
		}
	}
}

// waitForReady blocks until an HTTP GET to url gets a non-5xx response (the
// dependency is up and serving) or ctx is cancelled. It announces the wait once
// so it's visible in the output. There is deliberately NO timeout: "don't start
// until healthy" is the whole point, and Ctrl-C (ctx cancel) is the escape.
func waitForReady(ctx context.Context, url string, log func(string)) {
	client := &http.Client{Timeout: 2 * time.Second}
	announced := false
	for ctx.Err() == nil {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err == nil {
			if resp, derr := client.Do(req); derr == nil {
				_ = resp.Body.Close()
				if resp.StatusCode < 500 {
					if announced {
						log("dependency is ready — starting")
					}
					return
				}
			}
		}
		if !announced {
			log(fmt.Sprintf("waiting for %s before starting …", url))
			announced = true
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(500 * time.Millisecond):
		}
	}
}

type proc struct {
	name, dir, shell, color string
	env                     []string
	isPlain                 bool
	preview                 *recentLogs
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
	if c.preview != nil {
		c.preview.Lock()
		c.preview.lines = append(c.preview.lines, fmt.Sprintf("%-8s │ %s", c.name, line))
		if len(c.preview.lines) > 12 {
			c.preview.lines = c.preview.lines[len(c.preview.lines)-12:]
		}
		c.preview.Unlock()
		return
	}
	if c.isPlain {
		fmt.Printf("%-8s | %s\n", c.name, line)
		return
	}
	fmt.Printf("\x1b[%sm%-8s\x1b[0m │ %s\n", c.color, c.name, line)
}

func renderUp(ctx context.Context, logs *recentLogs, children []app.Child) {
	t := time.NewTicker(250 * time.Millisecond)
	defer t.Stop()
	render := func() {
		var b strings.Builder
		b.WriteString("\x1b[H\x1b[2J\x1b[1m haven up \x1b[0m\x1b[2m— live stack · Ctrl-C stops immediately\x1b[0m\n\n")
		b.WriteString("\x1b[1m stack\x1b[0m  ")
		for i, child := range children {
			if i > 0 {
				b.WriteString(" · ")
			}
			b.WriteString(child.Name)
		}
		b.WriteString("\n\n\x1b[2m recent output (full logs remain in Grafana)\x1b[0m\n")
		logs.Lock()
		for _, line := range logs.lines {
			b.WriteString(line)
			b.WriteByte('\n')
		}
		logs.Unlock()
		fmt.Print(b.String())
	}
	render()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			render()
		}
	}
}
