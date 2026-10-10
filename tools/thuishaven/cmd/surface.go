package cmd

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/fileregistry"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// haven's own exit codes sit at 64 and above so a wrapped command's 0 to 63
// passes through untouched (ADR-064, amendment 2026-10-10).
const (
	exitUsage      = 64
	exitNotRunning = 65
	exitTimeout    = 66
	exitGate       = 67
)

// exitError is a failure that names its exit code.
type exitError struct {
	code int
	err  error
}

func (e exitError) Error() string { return e.err.Error() }
func (e exitError) Unwrap() error { return e.err }
func (e exitError) ExitCode() int { return e.code }

func usageErr(format string, a ...any) error {
	return exitError{code: exitUsage, err: fmt.Errorf(format, a...)}
}

func notRunningErr(format string, a ...any) error {
	return exitError{code: exitNotRunning, err: fmt.Errorf(format, a...)}
}

func timeoutErr(format string, a ...any) error {
	return exitError{code: exitTimeout, err: fmt.Errorf(format, a...)}
}

// ExitCode is the process exit code for err: haven's own code when it names
// one, a wrapped command's 1 to 63 untouched, and 1 for anything else.
func ExitCode(err error) int {
	if err == nil {
		return 0
	}
	var own exitError
	if errors.As(err, &own) {
		return own.code
	}
	var wrapped *exec.ExitError
	if errors.As(err, &wrapped) {
		if code := wrapped.ExitCode(); code > 0 && code < exitUsage {
			return code
		}
	}
	return 1
}

// agentEnvPrefixes are the environment variables a coding agent sets for the
// commands it runs; any of them puts haven in agent mode, even in a terminal.
var agentEnvPrefixes = []string{"CLAUDECODE=", "CODEX_", "GEMINI_CLI=", "CURSOR_AGENT="}

func agentEnvSet(environ []string) bool {
	for _, kv := range environ {
		for _, prefix := range agentEnvPrefixes {
			if strings.HasPrefix(kv, prefix) {
				return true
			}
		}
	}
	return false
}

// stripStackFlag takes the global --stack <slug> out of args, before any `--`
// so a wrapped command's own flags are never read as haven's.
func stripStackFlag(args []string) ([]string, string, error) {
	out := make([]string, 0, len(args))
	slug := ""
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--":
			return append(out, args[i:]...), slug, nil
		case a == "--stack":
			if i+1 >= len(args) {
				return nil, "", usageErr("--stack needs a slug; haven status lists them")
			}
			i++
			slug = args[i]
		case strings.HasPrefix(a, "--stack="):
			slug = strings.TrimPrefix(a, "--stack=")
		default:
			out = append(out, a)
		}
	}
	return out, slug, nil
}

// retiredSpelling is what replaced a retired top-level command: the argv that
// does the same job now, or nil when it was removed with no successor.
type retiredSpelling func(rest []string) []string

func to(words ...string) retiredSpelling {
	return func(rest []string) []string { return append(slices.Clone(words), rest...) }
}

var gone retiredSpelling

// retired maps every retired top-level spelling, v2's and the 2026-10-10
// amendment's, to the spelling that replaced it. A retired spelling exits 64
// with the exact new argv; it never keeps working.
var retired = map[string]retiredSpelling{
	"ls": to("status"), "list": to("status"), "jobs": to("status"), "stores": to("status"),
	"doctor": to("self", "doctor"), "watch": to("hub"), "ps": to("hub"), "active": to("hub"),
	"rs": to("restart"), "sw": to("switch"), "cd": to("switch"),
	"ch": to("db", "url", "clickhouse"), "clickhouse": to("db", "url", "clickhouse"),
	"pg": to("db", "url", "postgres"), "postgres": to("db", "url", "postgres"),
	"observability": to("obs"),
	"tc":            to("machine", "typecheck"), "oc": to("machine", "clean"), "cleanup": to("machine", "clean"), "prune": to("machine", "clean"),
	"moron": gone, "git": gone, "hmr": gone, "play-launch": gone,
	"limits": to("machine", "limits"), "run": to("machine", "run"), "slot": to("machine", "slot"),
	"typecheck": to("machine", "typecheck"), "clean": to("machine", "clean"),
	"install": to("self", "install"), "setup": to("self", "setup"), "upgrade": to("self", "upgrade"),
	"shell-init": to("self", "shell-init"),
	"traces":     to("obs", "traces"), "metrics": to("obs", "metrics"), "profiles": to("obs", "profiles"), "query": to("obs", "query"),
	"feedback": to("orb", "feedback"), "page": to("orb"), "mfa": to("browser", "mfa"), "sims": to("sim"),
	"destroy": func(rest []string) []string {
		pos, flags := splitPositionals(rest)
		out := []string{"down", "--destroy"}
		if len(pos) > 0 {
			out = append(out, "--stack", pos[0])
		}
		return append(out, flags...)
	},
	"play": func(rest []string) []string { return append(append([]string{"pr"}, rest...), "--throwaway") },
	"seed": func(rest []string) []string {
		if len(rest) > 0 && rest[0] == "status" {
			return append([]string{"db", "status"}, rest[1:]...)
		}
		return append([]string{"db", "seed"}, rest...)
	},
	"auth": func(rest []string) []string {
		pos, flags := splitPositionals(rest)
		out := []string{"browser", "login"}
		if len(pos) > 0 {
			out = append(out, "--as", pos[0])
		}
		return append(out, flags...)
	},
	"gateway": func(rest []string) []string { return append(append([]string{"api"}, rest...), "--gateway") },
	"idp": func(rest []string) []string {
		if len(rest) == 0 {
			return []string{"simulator", "idp"}
		}
		return append([]string{"sim", "idp"}, simPublicArgv("idp", rest)...)
	},
}

func init() {
	for _, sim := range simulators {
		if sim.name == "idp" {
			continue
		}
		retired[sim.name] = func(rest []string) []string {
			return append([]string{"sim", sim.name}, simPublicArgv(sim.name, rest)...)
		}
	}
}

// splitPositionals separates the leading positionals from the flags after them.
func splitPositionals(args []string) (pos, rest []string) {
	for i, a := range args {
		if strings.HasPrefix(a, "-") {
			return args[:i], args[i:]
		}
	}
	return args, nil
}

// retiredError is the one line a retired spelling answers with.
func retiredError(old []string, now []string) error {
	if now == nil {
		return usageErr("haven %s was removed, no replacement", strings.Join(old, " "))
	}
	return usageErr("haven %s is retired; now: haven %s", strings.Join(old, " "), strings.Join(now, " "))
}

// isMachineWide reports whether a command addresses the machine rather than
// one stack, and so refuses --stack.
func isMachineWide(name string) bool {
	switch name {
	case "machine", "self", "defaults", "hub":
		return true
	}
	return false
}

// needsTarget reports whether a command acts on one stack, and so needs the
// stack resolved before it runs. Internal and machine-wide commands do not,
// nor does anything that makes a stack of its own.
func needsTarget(name string) bool {
	if isMachineWide(name) {
		return false
	}
	switch name {
	case "pr", "switch", "simulator", "static", "go-watch", "ui-watch", "keep", "daemon", "gate":
		return false
	}
	return true
}

// envStack is HAVEN_STACK: the per-shell, per-agent target. There is never a
// machine-global current stack.
func envStack() string { return strings.TrimSpace(os.Getenv("HAVEN_STACK")) }

// resolveTarget picks the stack a command acts on: --stack, else HAVEN_STACK,
// else the worktree holding the working directory, else a picker in a
// terminal or exit 64 listing the slugs for an agent. It returns the worktree
// to run in and the slug it was pinned to (empty for this worktree's own).
func resolveTarget(name, stackFlag, cwdWorktree string, isAgent bool) (worktree, target string, err error) {
	if stackFlag != "" && isMachineWide(name) {
		return "", "", usageErr("haven %s works on the whole machine; --stack does not apply", name)
	}
	target = stackFlag
	if target == "" && !isMachineWide(name) && needsTarget(name) {
		target = envStack()
	}
	stacks := fileregistry.New(havenHome()).Stacks()
	if target == "" {
		if cwdWorktree != "" || name == "" || !needsTarget(name) {
			return cwdWorktree, "", nil
		}
		return pickStack(stacks, isAgent)
	}
	if !domain.ValidSlug(target) {
		return "", "", usageErr("%q is not a stack slug; known stacks: %s", target, slugList(stacks))
	}
	for _, st := range stacks {
		if st.Slug == target {
			return st.WorktreeDir, target, nil
		}
	}
	// A stopped stack is still a stack to read the logs of, or to destroy.
	if name == "logs" || name == "down" {
		return cwdWorktree, target, nil
	}
	return "", "", usageErr("no stack %q; known stacks: %s", target, slugList(stacks))
}

func slugList(stacks []domain.Stack) string {
	if len(stacks) == 0 {
		return "(none running; haven up starts one)"
	}
	slugs := make([]string, 0, len(stacks))
	for _, st := range stacks {
		slugs = append(slugs, st.Slug)
	}
	slices.Sort(slugs)
	return strings.Join(slugs, ", ")
}

// pickStack asks a person which stack they mean; an agent is told the slugs.
func pickStack(stacks []domain.Stack, isAgent bool) (string, string, error) {
	if isAgent || !stdinIsTTY() || len(stacks) == 0 {
		return "", "", usageErr("not in a worktree; pass --stack <slug> or set HAVEN_STACK. Known stacks: %s", slugList(stacks))
	}
	for i, st := range stacks {
		fmt.Fprintf(os.Stderr, "  %d) %s  %s\n", i+1, st.Slug, st.WorktreeDir)
	}
	fmt.Fprint(os.Stderr, "which stack? ")
	answer, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	n, convErr := strconv.Atoi(strings.TrimSpace(answer))
	if convErr != nil || n < 1 || n > len(stacks) {
		return "", "", usageErr("no stack picked")
	}
	return stacks[n-1].WorktreeDir, stacks[n-1].Slug, nil
}
