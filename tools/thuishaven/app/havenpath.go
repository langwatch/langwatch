package app

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The machine half of "can you actually run haven": where `go install` put
// the binary, whether that directory is on PATH, and appending one line to
// the shell config when it is not.
//
// This used to be dev/scripts/haven-install-path.sh, run by the Makefile
// straight after `go install`. It moved here because `make haven install`
// read as three unrelated programs in a row — a Go build, a bash prompt, a
// Go picker — each with its own voice. The behaviour is the same one the
// spec always described; only the thing saying it changed.

// HavenPath is the state of haven's own installation, with everything the
// caller needs to report or fix it.
type HavenPath struct {
	State domain.HavenPathState
	// BinDir is where `go install` puts it — where `haven` would resolve from.
	BinDir string
	// RCPath is the shell config haven would edit, "" for an unknown shell.
	RCPath string
	// Line is the line that puts BinDir on PATH, in that shell's syntax.
	Line string
}

// CheckHavenPath measures the situation without changing anything.
func (o *Orchestrator) CheckHavenPath(ctx context.Context) HavenPath {
	binDir := goBinDir(ctx)
	home, _ := os.UserHomeDir()
	kind := domain.ShellKindOf(os.Getenv("SHELL"))
	rc := domain.ShellRCPath(kind, home, os.Getenv("ZDOTDIR"), os.Getenv("XDG_CONFIG_HOME"))
	line := domain.ShellPathLine(kind, binDir)

	facts := domain.HavenPathFacts{
		BinDir:    binDir,
		PathEnv:   os.Getenv("PATH"),
		RCPath:    rc,
		RCHasLine: rcContainsLine(rc, line),
	}
	return HavenPath{State: domain.PlanHavenPath(facts), BinDir: binDir, RCPath: rc, Line: line}
}

// AddHavenPath appends the PATH line to the shell config. Append, never
// rewrite: this is the developer's own file and haven's business with it
// begins and ends at one line.
func (o *Orchestrator) AddHavenPath(p HavenPath) error {
	if p.RCPath == "" || p.Line == "" {
		return fmt.Errorf("no shell config to add it to")
	}
	f, err := os.OpenFile(p.RCPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.WriteString(domain.HavenPathRCBlock(p.Line)); err != nil {
		return err
	}
	return nil
}

// goBinDir is where `go install` lands a binary: GOBIN when set, else
// GOPATH/bin. Asked of the toolchain rather than reconstructed, because the
// toolchain is the thing that decides.
func goBinDir(ctx context.Context) string {
	if out, err := exec.CommandContext(ctx, "go", "env", "GOBIN").Output(); err == nil {
		if dir := strings.TrimSpace(string(out)); dir != "" {
			return dir
		}
	}
	out, err := exec.CommandContext(ctx, "go", "env", "GOPATH").Output()
	if err != nil {
		return ""
	}
	gopath := strings.TrimSpace(string(out))
	if gopath == "" {
		return ""
	}
	return gopath + "/bin"
}

// rcContainsLine reports whether the file already carries the exact line, so
// a second run does not append a duplicate. An unreadable or absent file
// carries nothing.
func rcContainsLine(rcPath, line string) bool {
	if rcPath == "" || line == "" {
		return false
	}
	b, err := os.ReadFile(rcPath)
	if err != nil {
		return false
	}
	for _, existing := range strings.Split(string(b), "\n") {
		if strings.TrimRight(existing, " \t\r") == line {
			return true
		}
	}
	return false
}
