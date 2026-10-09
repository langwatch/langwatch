package cmd

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/havenui"
)

// buildStep is one quiet step of `haven install --build`: its output goes to a
// log file, and the screen gets one progress line instead.
type buildStep struct {
	label string
	argv  []string
	// optional: a failure is reported and the run carries on. A console that
	// fails to build serves a page naming `make haven-web` instead.
	optional bool
	at       string // "(3/8)", set when the run numbers its steps
}

// havenBuildSteps are what `make haven install` builds before it asks anything:
// the consoles the binary embeds (ADR-160), then the binary itself.
func havenBuildSteps() []buildStep {
	var steps []buildStep
	for _, web := range []string{"haven-web", "mailsim-web", "idpsim-web", "storagesim-web", "voicesim-web", "llmsim-web", "analyticssim-web"} {
		steps = append(steps, buildStep{
			label:    "building " + web,
			argv:     []string{"pnpm", "exec", "nx", "run", "@langwatch/" + web + ":build", "--outputStyle=static"},
			optional: true,
		})
	}
	return append(steps, buildStep{label: "installing the haven binary", argv: []string{"go", "install", "./cmd/haven"}})
}

// runInstallBuild is `haven install --build`, run from the repository root.
func runInstallBuild(ctx context.Context, d deps) error {
	logDir := filepath.Join(havenHome(), "logs", "install")
	if err := os.MkdirAll(logDir, 0o755); err != nil { //nolint:gosec // haven's own home, same mode as its siblings
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
	var failed []string
	for i, step := range run.steps {
		step.at = fmt.Sprintf("(%d/%d)", i+1, len(run.steps))
		err := runBuildStep(ctx, run, step)
		if err == nil {
			continue
		}
		if !step.optional {
			return err
		}
		failed = append(failed, strings.TrimPrefix(step.label, "building "))
	}
	if len(failed) > 0 {
		fmt.Fprintf(run.w, "%s not built: %s; their pages name 'make haven-web' until they are\n", havenui.Skip, strings.Join(failed, ", "))
	}
	return nil
}

// runBuildStep runs one step into its log, drawing a spinner and the elapsed
// time while it runs, then ✓ or ✗; a failure prints the log's last 30 lines.
func runBuildStep(ctx context.Context, run buildRun, step buildStep) error {
	logPath := filepath.Join(run.logDir, strings.ReplaceAll(step.label, " ", "-")+".log")
	logFile, err := os.Create(logPath)
	if err != nil {
		return err
	}
	defer logFile.Close()
	c := exec.CommandContext(ctx, step.argv[0], step.argv[1:]...) //nolint:gosec // a fixed argv from havenBuildSteps
	c.Stdout, c.Stderr = logFile, logFile
	start := time.Now()
	done := make(chan error, 1)
	go func() { done <- c.Run() }()
	runErr := waitDrawing(run, done, func(frame string) string {
		return fmt.Sprintf("%s %s %s  %s", frame, step.label, step.at, time.Since(start).Round(time.Second))
	})
	took := time.Since(start).Round(time.Second)
	if runErr == nil {
		fmt.Fprintf(run.w, "%s %s %s  %s\n", havenui.Good.Render(havenui.Yes), step.label, step.at, took)
		return nil
	}
	fmt.Fprintf(run.w, "%s %s %s  %s\n", havenui.Warn.Render(havenui.No), step.label, step.at, took)
	fmt.Fprint(run.w, logTail(logPath, 30))
	fmt.Fprintf(run.w, "  full log: %s\n", logPath)
	return fmt.Errorf("%s failed (%w); log: %s", step.label, runErr, logPath)
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
