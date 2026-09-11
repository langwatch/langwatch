package cmd

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/installtui"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// `haven install` checks the machine for everything haven drives but does not
// own — portless, the Node toolchain, the brew formulae behind the managed
// Postgres and Redis, a container runtime — and offers to install what is
// missing.
//
// It is the counterpart to `haven setup`, and the split is the same one that
// runs through this CLI: setup installs optional integrations into a
// CHECKOUT, install brings the MACHINE up to what haven needs. Neither one
// assumes: a human with a terminal is asked, an agent is told.
//
// Three shapes, and the difference between them is who is there to answer:
//
//	haven install              a terminal gets the picker; a pipe gets the report
//	haven install --yes        installs what haven needs, asks nothing
//	haven install redis        installs exactly what is named, skips and all

func runInstall(ctx context.Context, d deps, inv invocation) error {
	if inv.has("--reset-skips") {
		if err := resetPrereqSkips(d); err != nil {
			return err
		}
		if len(inv.args) == 0 && !inv.has("--list") && !inv.has("--yes") {
			return nil
		}
	}

	// Naming prerequisites is the one form that does not consult the report:
	// it is how a developer takes back an earlier "never ask again", and
	// re-deriving that from a probe would just refuse them on the way in.
	if len(inv.args) > 0 {
		chosen, err := app.ResolvePrereqNames(inv.args)
		if err != nil {
			return err
		}
		return d.orch.InstallPrereqs(ctx, chosen)
	}

	report := d.orch.CheckPrereqs(ctx)
	if inv.has("--list") {
		printPrereqReport(os.Stdout, report)
		return nil
	}
	if inv.has("--yes") {
		return installAuto(ctx, d, report)
	}
	if !installCanAsk(d.isAgent, stdoutIsTTY(), stdinIsTTY()) {
		printPrereqReport(os.Stdout, report)
		printNonInteractiveHint(os.Stdout, report)
		return nil
	}
	return installInteractive(ctx, d, report)
}

// installCanAsk decides whether there is anyone to show a picker to.
//
// Both ends have to be a terminal, for the reason `haven setup` gives: stdout
// alone says the answer would be seen, not that anyone can give one — with
// stdin on a pipe that never closes, a picker paints its question and blocks
// on a reply that is never coming. An agent is never asked at all: there is
// nobody there, and installing software because nothing said no is exactly
// the surprise this command exists to avoid.
func installCanAsk(isAgent, stdoutTTY, stdinTTY bool) bool {
	return !isAgent && stdoutTTY && stdinTTY
}

// installAuto is the non-interactive path: install what haven itself needs and
// leave the conveniences alone. Nothing here can ask a question, so anything
// that would need one is reported instead.
func installAuto(ctx context.Context, d deps, report []domain.PrereqStatus) error {
	chosen := app.AutoPrereqs(report)
	if len(chosen) == 0 {
		fmt.Println(domain.ReadyLine(report))
		printOptionalHint(os.Stdout, report)
		return nil
	}
	return d.orch.InstallPrereqs(ctx, chosen)
}

// installInteractive shows the picker, records the never-ask-agains, and then
// installs — in that order, and with the picker closed first, so an installer
// that wants the terminal (a password prompt, a progress bar) has it.
func installInteractive(ctx context.Context, d deps, report []domain.PrereqStatus) error {
	result, err := installtui.Run(ctx, report)
	if err != nil {
		return err
	}
	if !result.Confirmed {
		fmt.Println("nothing installed.")
		return nil
	}
	if len(result.Never) > 0 {
		recorded, err := d.orch.SkipPrereqs(result.Never)
		if err != nil {
			return err
		}
		if len(recorded) > 0 {
			fmt.Printf("· will not ask about %s again (undo: haven install --reset-skips)\n", strings.Join(recorded, ", "))
		}
	}
	if len(result.Install) == 0 {
		if len(result.Never) == 0 {
			fmt.Println("nothing selected; nothing installed.")
		}
		return nil
	}
	return d.orch.InstallPrereqs(ctx, result.Install)
}

func resetPrereqSkips(d deps) error {
	cleared, err := d.orch.ResetPrereqSkips()
	if err != nil {
		return err
	}
	if len(cleared) == 0 {
		fmt.Println("· nothing was marked never-ask-again.")
		return nil
	}
	fmt.Printf("✓ will ask about %s again\n", strings.Join(cleared, ", "))
	return nil
}

// printPrereqReport writes the whole catalogue with the machine's answer
// against each entry. Every line is printed, satisfied ones included: a check
// that lists only problems leaves you unable to tell "fine" from "not looked
// at", which is the question you came with.
func printPrereqReport(w io.Writer, report []domain.PrereqStatus) {
	fmt.Fprintln(w, "What haven needs on this machine:")
	fmt.Fprintln(w)
	for _, st := range report {
		// The requirement is on every line, not only the missing ones: it is
		// what turns "missing" from a fact into a decision, and reading it off
		// a legend at the bottom is one lookup too many.
		fmt.Fprintf(w, "  %-9s %-18s %-12s %s\n", st.State, st.Key, st.Requirement, prereqDetail(st))
	}
	fmt.Fprintln(w)
	fmt.Fprintln(w, domain.ReadyLine(report))
	printSkippedNote(w, report)
}

// prereqDetail is the right-hand column: what was found, or the command that
// would fix it. An actionable entry always names its command, so the report
// is something you can act on without reading the help.
func prereqDetail(st domain.PrereqStatus) string {
	if st.State.Actionable() {
		return prereqCommand(st)
	}
	if st.Observed != "" {
		return st.Observed
	}
	return st.Summary
}

func prereqCommand(st domain.PrereqStatus) string {
	candidate := st.Via
	if candidate == "" {
		candidate = domain.DefaultChoice(st.Prereq)
	}
	c, ok := domain.LookupCandidate(st.Prereq, candidate)
	if !ok {
		return st.Summary
	}
	if c.Install == "" {
		return c.Manual
	}
	if len(st.Candidates) > 1 {
		// A choice reported as one command would hide the alternative, and
		// this is the only place a pipe reader ever sees it.
		return c.Install + "   (or: haven install " + st.Key + "=" + otherCandidate(st.Prereq, candidate) + ")"
	}
	return c.Install
}

func otherCandidate(p domain.Prereq, chosen string) string {
	for _, c := range p.Candidates {
		if c.Key != chosen {
			return c.Key
		}
	}
	return chosen
}

func printSkippedNote(w io.Writer, report []domain.PrereqStatus) {
	var skipped []string
	for _, st := range report {
		if st.State == domain.PrereqSkipped {
			skipped = append(skipped, st.Key)
		}
	}
	if len(skipped) == 0 {
		return
	}
	fmt.Fprintf(w, "not asking about %s (undo: haven install --reset-skips)\n", strings.Join(skipped, ", "))
}

// printNonInteractiveHint is what a pipe or an agent gets instead of a picker:
// the two commands that would act on what it just read.
func printNonInteractiveHint(w io.Writer, report []domain.PrereqStatus) {
	var actionable []string
	for _, st := range report {
		if st.State.Actionable() {
			actionable = append(actionable, st.Key)
		}
	}
	if len(actionable) == 0 {
		return
	}
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Nothing was installed: there is no terminal here to ask.")
	fmt.Fprintln(w, "  haven install --yes              install what haven needs (not the optional ones)")
	fmt.Fprintf(w, "  haven install %-18s install exactly that one\n", actionable[0])
}

// printOptionalHint is the tail of a successful --yes run: the optional
// entries are the ones --yes deliberately did not touch, so say they are
// still there rather than letting "ready" imply the list is empty.
func printOptionalHint(w io.Writer, report []domain.PrereqStatus) {
	var optional []string
	for _, st := range report {
		if st.State.Actionable() && st.Requirement == domain.PrereqOptional {
			optional = append(optional, st.Key)
		}
	}
	if len(optional) == 0 {
		return
	}
	fmt.Fprintf(w, "optional and not installed: %s (haven install %s)\n",
		strings.Join(optional, ", "), optional[0])
}
