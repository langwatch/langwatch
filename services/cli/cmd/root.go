// Package cmd implements the langwatch CLI subcommand dispatcher.
//
// Each subcommand is a Command value with a Name, ShortHelp, and Run
// function. The dispatcher matches argv[0] against the registry and
// delegates. Help is generated from the registry.
package cmd

import (
	"context"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
)

// Version is injected by main from ldflags.
var Version = "dev"

// Command describes a top-level CLI subcommand.
type Command struct {
	Name      string
	ShortHelp string
	Run       func(ctx context.Context, args []string) error
}

var registry = map[string]*Command{}

func register(c *Command) {
	registry[c.Name] = c
}

// Run dispatches the given argv to the matching subcommand.
//
// argv must NOT include the program name (callers typically pass
// os.Args[1:]). The first element is treated as the subcommand name;
// remaining elements are forwarded to the subcommand's Run.
//
// Special tokens: "", "help", "-h", "--help", "version", "-v", "--version".
func Run(ctx context.Context, argv []string) error {
	if len(argv) == 0 {
		printUsage(os.Stdout)
		return nil
	}

	name := argv[0]
	rest := argv[1:]

	switch name {
	case "help", "-h", "--help":
		if len(rest) == 0 {
			printUsage(os.Stdout)
			return nil
		}
		c, ok := registry[rest[0]]
		if !ok {
			return fmt.Errorf("unknown subcommand: %s", rest[0])
		}
		fmt.Fprintf(os.Stdout, "langwatch %s — %s\n", c.Name, c.ShortHelp)
		return nil
	case "version", "-v", "--version":
		fmt.Fprintf(os.Stdout, "langwatch %s\n", Version)
		return nil
	}

	c, ok := registry[name]
	if !ok {
		fmt.Fprintf(os.Stderr, "unknown subcommand: %s\n\n", name)
		printUsage(os.Stderr)
		return fmt.Errorf("unknown subcommand: %s", name)
	}
	return c.Run(ctx, rest)
}

func printUsage(w io.Writer) {
	fmt.Fprintln(w, "langwatch — control plane CLI for LangWatch AI Gateway")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  langwatch <command> [args...]")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Commands:")

	names := make([]string, 0, len(registry))
	for n := range registry {
		names = append(names, n)
	}
	sort.Strings(names)

	pad := 0
	for _, n := range names {
		if len(n) > pad {
			pad = len(n)
		}
	}
	for _, n := range names {
		fmt.Fprintf(w, "  %s%s   %s\n", n, strings.Repeat(" ", pad-len(n)), registry[n].ShortHelp)
	}
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Run `langwatch help <command>` for more.")
}
