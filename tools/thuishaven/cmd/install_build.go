package cmd

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/havenui"
)

// buildStep is one quiet step of `haven self install --build`: its output goes to a
// log file, and the screen gets one progress line instead.
type buildStep struct {
	running string // "building haven consoles", shown while it runs
	done    string // "haven consoles built", shown with ✓ when it ends
	log     string // the log file's name under the install log directory
	argv    []string
	// optional: a failure is reported and the run carries on. A console that
	// fails to build serves a page naming `make haven-web` instead.
	optional bool
	// nx: argv is an nx run-many whose task lines feed the progress count.
	nx bool
}

// havenBuildSteps are what `make haven install` builds before it asks anything:
// the consoles the binary embeds (ADR-160), selected by nx's haven-console tag
// (dev/nx/go-plugin.mjs) and cached by nx, then the binary itself.
func havenBuildSteps() []buildStep {
	return []buildStep{
		{
			running:  "building haven consoles",
			done:     "haven consoles built",
			log:      "haven-web.log",
			argv:     []string{"pnpm", "exec", "nx", "run-many", "-t", "build", "--projects", "tag:haven-console", "--outputStyle=static"},
			optional: true,
			nx:       true,
		},
		{running: "installing the haven binary", done: "haven binary installed", log: "go-install.log", argv: []string{"go", "install", "./cmd/haven"}},
	}
}

// runInstallBuild is `haven self install --build`, run from the repository root.
func runInstallBuild(ctx context.Context, d deps) error {
	logDir := filepath.Join(havenHome(), "logs", "install")
	if err := os.MkdirAll(logDir, 0o700); err != nil { //nolint:gosec // log folder is owner-only
		return err
	}
	return runBuildSteps(ctx, buildRun{w: os.Stdout, logDir: logDir, live: !d.isAgent && stdoutIsTTY(), steps: havenBuildSteps()})
}

// buildRun is where the steps report and log, and whether the screen is a
// terminal that can redraw a line (a pipe gets one line per finished step).
type buildRun struct {
	w      io.Writer
	logDir string
	live   bool
	steps  []buildStep
}

func runBuildSteps(ctx context.Context, run buildRun) error {
	failed := false
	for _, step := range run.steps {
		err := runBuildStep(ctx, run, step)
		if err == nil {
			continue
		}
		if !step.optional {
			return err
		}
		failed = true
	}
	if failed {
		fmt.Fprintf(run.w, "%s a failed console's page names 'make haven-web' until it is built\n", havenui.Skip)
	}
	return nil
}

// runBuildStep runs one step into its log, drawing a spinner and the elapsed
// time while it runs, then ✓ or ✗; a failure prints the log's last 30 lines.
func runBuildStep(ctx context.Context, run buildRun, step buildStep) error {
	logPath := filepath.Join(run.logDir, step.log)
	logFile, err := os.Create(logPath)
	if err != nil {
		return err
	}
	defer logFile.Close()
	progress := &nxProgress{}
	var sink io.Writer = logFile
	if step.nx {
		sink = io.MultiWriter(logFile, progress)
	}
	c := exec.CommandContext(ctx, step.argv[0], step.argv[1:]...) //nolint:gosec // a fixed argv from havenBuildSteps
	c.Stdout, c.Stderr = sink, sink
	start := time.Now()
	done := make(chan error, 1)
	go func() { done <- c.Run() }()
	runErr := waitDrawing(run, done, func(frame string) string {
		count := ""
		if finished, total, _ := progress.counts(); total > 0 {
			count = fmt.Sprintf(" %d/%d", finished, total)
		}
		return fmt.Sprintf("%s %s%s · %s", frame, step.running, count, took(time.Since(start)))
	})
	elapsed := took(time.Since(start))
	if runErr == nil {
		detail := ""
		if finished, total, cached := progress.counts(); total > 0 {
			detail = fmt.Sprintf(" (%d, %d cached)", finished, cached)
		}
		fmt.Fprintf(run.w, "%s %s%s %s\n", havenui.Good.Render(havenui.Yes), step.done, detail, elapsed)
		return nil
	}
	fmt.Fprintf(run.w, "%s %s failed %s\n", havenui.Warn.Render(havenui.No), step.running, elapsed)
	fmt.Fprint(run.w, logTail(logPath, 30))
	fmt.Fprintf(run.w, "  full log: %s\n", logPath)
	return fmt.Errorf("%s failed (%w); log: %s", step.running, runErr, logPath)
}

// took is an elapsed time that keeps a cached run's 130ms visible.
func took(d time.Duration) string {
	if d < 10*time.Second {
		return d.Round(100 * time.Millisecond).String()
	}
	return d.Round(time.Second).String()
}

var (
	nxTaskLine  = regexp.MustCompile(`^> nx run \S+-web:build(?:\s+\[(.*)\])?\s*$`)
	nxTotalLine = regexp.MustCompile(`Running target build for (\d+) projects`)
)

// nxProgress counts nx's per-task lines as the log is written: static output
// prints "> nx run <project>:build [local cache]" as each task finishes.
type nxProgress struct {
	mu                   sync.Mutex
	partial              string
	finished, total, hit int
}

func (p *nxProgress) Write(b []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.partial += string(b)
	for {
		i := strings.IndexByte(p.partial, '\n')
		if i < 0 {
			return len(b), nil
		}
		p.line(p.partial[:i])
		p.partial = p.partial[i+1:]
	}
}

func (p *nxProgress) line(text string) {
	if m := nxTaskLine.FindStringSubmatch(text); m != nil {
		p.finished++
		if strings.Contains(m[1], "cache") {
			p.hit++
		}
	} else if m := nxTotalLine.FindStringSubmatch(text); m != nil {
		p.total, _ = strconv.Atoi(m[1])
	}
}

func (p *nxProgress) counts() (finished, total, cached int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.finished, p.total, p.hit
}

var spinnerFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

// waitDrawing redraws the progress line until the step ends, and clears it.
func waitDrawing(run buildRun, done <-chan error, line func(frame string) string) error {
	if !run.live {
		return <-done
	}
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	for i := 0; ; i++ {
		fmt.Fprintf(run.w, "\r\x1b[K%s", line(spinnerFrames[i%len(spinnerFrames)]))
		select {
		case err := <-done:
			fmt.Fprint(run.w, "\r\x1b[K")
			return err
		case <-tick.C:
		}
	}
}

// logTail is the last n lines of a step's log, indented under its ✗ line.
func logTail(path string, n int) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	lines := strings.Split(string(bytes.TrimRight(data, "\n")), "\n")
	lines = lines[max(len(lines)-n, 0):]
	return "    " + strings.Join(lines, "\n    ") + "\n"
}
