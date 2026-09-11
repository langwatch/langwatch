package cmd

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/havenui"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The first thing `haven install` reports: whether haven itself can be run by
// name. Every other prerequisite is about the machine; this one is about the
// command the developer just typed, so it comes first and it is short.
//
// Silent when there is nothing to say. A developer whose PATH is already
// right does not need a line confirming it on every run — the absence of a
// complaint is the confirmation.

// reportHavenPath prints the state of haven's own installation and, when
// there is a terminal to ask in, offers to fix it. Never fails the command:
// a PATH that is not set up is a thing to tell someone about, not a reason to
// refuse to check the rest of their machine.
func reportHavenPath(ctx context.Context, d deps, w io.Writer) {
	p := d.orch.CheckHavenPath(ctx)
	switch p.State {
	case domain.HavenPathReady:
		return
	case domain.HavenPathPending:
		fmt.Fprintln(w, style(d, havenui.Muted, fmt.Sprintf(
			"  %s %s is not on PATH yet, but %s already adds it — restart your shell.",
			havenui.Bullet, p.BinDir, p.RCPath)))
	case domain.HavenPathManual:
		fmt.Fprintln(w, style(d, havenui.Warn, fmt.Sprintf("  %s haven is installed but not on your PATH.", havenui.No)))
		fmt.Fprintln(w, style(d, havenui.Muted, "    Add this to your shell config, then restart it:"))
		fmt.Fprintln(w, "      "+p.Line)
	case domain.HavenPathOfferable:
		offerHavenPath(d, w, p)
	}
	fmt.Fprintln(w)
}

// offerHavenPath asks, once, whether to add the line — and only where there
// is someone to ask. An agent, or a pipe, gets the line to run instead: this
// edits the developer's shell config, which is not a thing to do because
// nobody was there to say no.
func offerHavenPath(d deps, w io.Writer, p app.HavenPath) {
	fmt.Fprintln(w, style(d, havenui.Warn, fmt.Sprintf("  %s haven is installed at %s, which is not on your PATH.", havenui.No, p.BinDir)))

	if !installCanAsk(d.isAgent, stdoutIsTTY(), stdinIsTTY()) {
		fmt.Fprintln(w, style(d, havenui.Muted, "    Add this to "+p.RCPath+", then restart your shell:"))
		fmt.Fprintln(w, "      "+p.Line)
		return
	}

	fmt.Fprintf(w, "    %s ", style(d, havenui.Muted, "Add it to "+p.RCPath+"? [Y/n]"))
	if !yes(os.Stdin) {
		fmt.Fprintln(w, style(d, havenui.Muted, "    Left alone. To do it yourself, append this to "+p.RCPath+":"))
		fmt.Fprintln(w, "      "+p.Line)
		return
	}
	if err := d.orch.AddHavenPath(p); err != nil {
		fmt.Fprintln(w, style(d, havenui.Warn, fmt.Sprintf("    could not write %s (%v) — add this line yourself:", p.RCPath, err)))
		fmt.Fprintln(w, "      "+p.Line)
		return
	}
	fmt.Fprintln(w, style(d, havenui.Good, fmt.Sprintf("    %s added to %s — restart your shell, then `haven` works anywhere.", havenui.Yes, p.RCPath)))
}

// yes reads one answer, defaulting to yes: the question is only asked when
// the answer is almost certainly yes, and the line it adds is one a developer
// can delete. A closed pipe mid-prompt reads as no, so an interrupted run
// leaves the file untouched.
func yes(r io.Reader) bool {
	line, err := bufio.NewReader(r).ReadString('\n')
	if err != nil && line == "" {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "n", "no":
		return false
	}
	return true
}
