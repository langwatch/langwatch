package cmd

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// `haven setup` installs OPTIONAL integrations into this checkout.
//
// It exists because `up` should not make these choices. Everything up
// bootstraps — portless, the CA, the proxy — is something haven needs to work
// at all. The features here change how OTHER tools behave, so they are offered
// rather than assumed, and an install that surprises you is a bug in the
// design rather than in the code.
//
// A human with a terminal gets asked, one feature at a time, with the detail
// in front of them. An agent gets no prompt at all: it names what it wants, or
// it is told what there is. A picker that blocks forever on a pipe would be
// the worst of both.

func runSetup(_ context.Context, d deps, inv invocation) error {
	if inv.has("--list") {
		printFeatures(os.Stdout)
		return nil
	}

	wanted := inv.args
	if len(wanted) == 0 {
		// Both ends have to be a terminal. Stdout alone says the answer would be
		// seen, not that anyone can give one — with stdin on a pipe that never
		// closes, the picker prints its question and blocks on a reply that is
		// never coming.
		if d.isAgent || !stdoutIsTTY() || !stdinIsTTY() {
			// Refusing beats guessing. In agent mode there is nobody to ask, and
			// installing "everything" because nothing was named is exactly the kind
			// of surprise this command was split out of `up` to avoid.
			printFeatures(os.Stderr)
			return fmt.Errorf("haven setup needs a feature name (or run it in a terminal to choose)")
		}
		wanted = chooseFeatures(os.Stdin, os.Stdout)
	}
	if len(wanted) == 0 {
		fmt.Println("nothing selected; nothing installed.")
		return nil
	}
	return installFeatures(d, wanted)
}

// installFeatures installs each named feature, reporting which ones actually
// changed so a second run reads as a no-op rather than a repeat.
func installFeatures(d deps, wanted []string) error {
	for _, name := range wanted {
		installed, err := d.orch.InstallFeature(name)
		switch {
		case err != nil:
			return err
		case installed:
			fmt.Printf("✓ %s installed\n", name)
		default:
			fmt.Printf("· %s was already installed\n", name)
		}
	}
	return nil
}

// printFeatures lists what can be installed, with enough detail to choose.
func printFeatures(w io.Writer) {
	fmt.Fprintln(w, "Optional integrations for this checkout:")
	for _, f := range app.Features {
		fmt.Fprintf(w, "\n    %s — %s\n    %s\n", f.Name, f.Summary, f.Detail)
	}
	fmt.Fprintf(w, "\nInstall with: haven setup %s\n", app.Features[0].Name)
}

// chooseFeatures asks about each feature in turn. Default is NO: a developer
// who hits return through the prompts ends up with nothing installed, which is
// the safe direction for something that edits their editor's configuration.
func chooseFeatures(r io.Reader, w io.Writer) []string {
	in := bufio.NewReader(r)
	var chosen []string
	fmt.Fprintln(w, "Optional integrations for this checkout. Nothing is installed unless you say so.")
	for _, f := range app.Features {
		fmt.Fprintf(w, "\n  %s — %s\n    %s\n", f.Name, f.Summary, f.Detail)
		fmt.Fprint(w, "\n  Install it? [y/N] ")
		line, err := in.ReadString('\n')
		if err != nil && line == "" {
			// EOF mid-prompt: treat as declining the rest rather than erroring, so
			// a closed pipe leaves the machine untouched.
			break
		}
		switch strings.ToLower(strings.TrimSpace(line)) {
		case "y", "yes":
			chosen = append(chosen, f.Name)
		}
	}
	fmt.Fprintln(w)
	return chosen
}
