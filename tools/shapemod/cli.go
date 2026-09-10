package shapemod

import (
	"flag"
	"fmt"
	"io"
)

// Run is the shapemod CLI. It dispatches to one of the three subcommands and
// returns the process exit code. Every subcommand prints its plan by
// default; only --apply writes.
func Run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "usage: shapemod <ports|infra|dead-transports|inventory> ...")
		return 2
	}

	sub, rest := args[0], args[1:]
	flags := flag.NewFlagSet(sub, flag.ContinueOnError)
	flags.SetOutput(stderr)
	apply := flags.Bool("apply", false, "write the moves and renames; default is a dry-run plan")
	root := flags.String("root", ".", "repository root")
	agent := flags.Bool("agent", false, "plain, token-light output (no effect yet; accepted for parity with the house CLIs)")
	_ = agent

	switch sub {
	case "ports":
		if err := flags.Parse(rest); err != nil {
			return 2
		}
		if flags.NArg() != 1 {
			fmt.Fprintln(stderr, "usage: shapemod ports [--apply] [--root .] <module-dir>")
			return 2
		}
		_, code := Ports(*root, flags.Arg(0), *apply, TslspRunner{}, stdout, stderr)
		return code

	case "infra":
		if err := flags.Parse(rest); err != nil {
			return 2
		}
		if flags.NArg() != 1 {
			fmt.Fprintln(stderr, "usage: shapemod infra [--apply] [--root .] <module-dir>")
			return 2
		}
		_, code := Infra(*root, flags.Arg(0), *apply, TslspRunner{}, stdout, stderr)
		return code

	case "dead-transports":
		if err := flags.Parse(rest); err != nil {
			return 2
		}
		if flags.NArg() == 0 {
			fmt.Fprintln(stderr, "usage: shapemod dead-transports [--apply] [--root .] <module-dir>...")
			return 2
		}
		DeadTransports(*root, flags.Args(), *apply, stdout, stderr)
		return 0

	case "inventory":
		if err := flags.Parse(rest); err != nil {
			return 2
		}
		Inventory(*root, stdout, stderr)
		return 0

	default:
		fmt.Fprintf(stderr, "unknown subcommand %q\n", sub)
		return 2
	}
}
