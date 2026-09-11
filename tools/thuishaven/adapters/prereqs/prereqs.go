// Package prereqs implements app.PrereqTools: the one place haven looks at
// the developer's machine as a machine — what is on PATH, what Homebrew has
// installed — and the one place it runs an installer.
//
// Installers get the terminal itself, not a captured pipe. `brew install
// --cask` asks for a password and Homebrew prints a progress bar; both of
// those swallowed by a log capture read as a hang, and a hang during an
// install is the failure mode most likely to leave a machine half-configured.
package prereqs

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"sync"
)

// Tools is the real implementation.
type Tools struct {
	// formulae caches `brew list` for the life of one command. The list costs
	// a few hundred milliseconds and the catalogue asks about it repeatedly;
	// nothing installs a formula behind haven's back mid-run, and the one
	// thing that does — haven's own installs — invalidates it deliberately.
	once     sync.Once
	formulae []string
}

// New builds the adapter. Stateless apart from the per-command brew cache.
func New() *Tools { return &Tools{} }

// BinaryPath resolves a command on PATH, or "" when it is not there.
func (t *Tools) BinaryPath(name string) string {
	path, err := exec.LookPath(name)
	if err != nil {
		return ""
	}
	return path
}

// FormulaInstalled reports whether an installed formula starts with prefix,
// and which one matched. Prefix rather than equality because haven adopts
// whichever postgresql@NN the machine already has rather than insisting on
// its own default (see adapters/postgresbrew).
func (t *Tools) FormulaInstalled(ctx context.Context, prefix string) (string, bool) {
	for _, name := range t.brewList(ctx) {
		if strings.HasPrefix(name, prefix) {
			return name, true
		}
	}
	return "", false
}

// brewList reads the installed formulae once per command. No brew, or a brew
// that fails, is an empty list — the caller's question is "is this formula
// installed", and on a machine with no Homebrew the answer is no.
func (t *Tools) brewList(ctx context.Context) []string {
	t.once.Do(func() {
		if t.BinaryPath("brew") == "" {
			return
		}
		out, err := exec.CommandContext(ctx, "brew", "list", "--formula", "-1").Output()
		if err != nil {
			return
		}
		for _, line := range strings.Split(string(out), "\n") {
			if name := strings.TrimSpace(line); name != "" {
				t.formulae = append(t.formulae, name)
			}
		}
	})
	return t.formulae
}

// Install runs one installer with the developer's terminal attached, so a
// password prompt is a prompt and not a hang. The command comes from the
// catalogue in domain/prereq.go, never from user input, which is what makes
// handing it to a shell reasonable: `brew install --cask docker` has to keep
// its flags, and splitting it here would only re-implement the shell badly.
func (t *Tools) Install(ctx context.Context, command string) error {
	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	err := cmd.Run()
	// Whatever just happened, the cached formula list is now a lie.
	t.once, t.formulae = sync.Once{}, nil
	return err
}
