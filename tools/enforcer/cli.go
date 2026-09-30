package enforcer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/tools/internal/parallel"
	"github.com/langwatch/langwatch/tools/internal/workspace"
)

// usage is the TS CLI's USAGE, byte for byte.
const usage = `architecture-enforcer [options]

  --root <path>            workspace root (default: the current directory)
  --all                    print every finding, not the first 25 per policy
  --list-policies          print the policy registry (id, spec) and exit
  --policies <id,id,...>   run only these registry ids
  --review-test-quality    run the test-quality review over changed test files alone
  --no-declarations        skip the declarations policy (it needs tsc -b to have run)
  --findings-json          print each selected policy's findings as JSON, discovery excluded
  --help

Exit codes: 0 clean, 1 findings, 2 bad arguments or a crash (a missing anchor file included).
`

var valueFlags = []string{"--root", "--policies"}

var booleanFlags = []string{"--", "--all", "--list-policies", "--review-test-quality", "--no-declarations", "--findings-json", "--help", "-h"}

type options struct {
	root                                         string
	all, reviewTestQuality, declarations, asJSON bool
	only                                         []string
	argv                                         []string
}

// collect splits argv into value flags and boolean flags, or names the bad argument.
func collect(argv []string) (values map[string]string, flags map[string]bool, problem string) {
	values, flags = map[string]string{}, map[string]bool{}
	for i := 0; i < len(argv); i++ {
		arg := argv[i]
		switch {
		case slices.Contains(booleanFlags, arg):
			flags[arg] = true
		case !slices.Contains(valueFlags, arg):
			return nil, nil, "unknown argument " + arg
		case i+1 >= len(argv) || strings.HasPrefix(argv[i+1], "-"):
			return nil, nil, arg + " needs a value after it"
		default:
			values[arg] = argv[i+1]
			i++
		}
	}
	return values, flags, ""
}

// selected is the ids --policies names, or the first one the registry does not know.
func selected(value string) (ids []string, unknown string) {
	for _, id := range strings.Split(value, ",") {
		if id = strings.TrimSpace(id); id == "" {
			continue
		}
		if !slices.ContainsFunc(Policies, func(p Policy) bool { return p.ID == id }) {
			return nil, id
		}
		ids = append(ids, id)
	}
	return ids, ""
}

func parse(argv []string) (opts options, mode, problem string) {
	values, flags, problem := collect(argv)
	switch {
	case problem != "":
		return opts, "usage", problem
	case flags["--help"] || flags["-h"]:
		return opts, "help", ""
	case flags["--list-policies"]:
		return opts, "list", ""
	}
	only, unknown := selected(values["--policies"])
	if unknown != "" {
		return opts, "usage", "--policies names unknown policy " + unknown
	}
	root := values["--root"]
	if root == "" {
		root = "."
	}
	root, _ = filepath.Abs(root)
	return options{root: root, only: only, argv: argv, all: flags["--all"], reviewTestQuality: flags["--review-test-quality"],
		asJSON: flags["--findings-json"], declarations: !flags["--no-declarations"]}, "run", ""
}

func listPolicies(stdout io.Writer) {
	fmt.Fprintf(stdout, "architecture-enforcer: %d registered policies\n\n", len(Policies))
	rows := make([]string, len(Policies))
	for i, p := range Policies {
		rows[i] = p.ID + "\n  spec: " + p.Spec
	}
	fmt.Fprint(stdout, strings.Join(rows, "\n")+"\n")
}

// Run is the CLI: the TS CLI's flags, output and exit codes.
func Run(argv []string, stdout, stderr io.Writer) int {
	opts, mode, problem := parse(argv)
	switch mode {
	case "help":
		fmt.Fprint(stdout, usage)
		return 0
	case "list":
		listPolicies(stdout)
		return 0
	case "usage":
		fmt.Fprintf(stderr, "architecture-enforcer: %s\n\n%s", problem, usage)
		return 2
	}
	if opts.reviewTestQuality || opts.asJSON {
		return typescript(opts.root, opts.argv, streams{stdout, stderr})
	}
	findings, err := lint(opts)
	if err != nil {
		fmt.Fprintf(stderr, "architecture-enforcer: the run crashed\n  %s\n", err)
		return 2
	}
	if len(findings) == 0 {
		fmt.Fprintln(stdout, "architecture-enforcer: package boundaries are sealed")
		return 0
	}
	fmt.Fprint(stderr, formatReport(findings, opts.all))
	return 1
}

// enabled is index.ts enabledPolicies.
func enabled(opts options) []Policy {
	var out []Policy
	for _, p := range Policies {
		if (!opts.declarations && p.ID == "declarations") || (opts.only != nil && !slices.Contains(opts.only, p.ID)) {
			continue
		}
		out = append(out, p)
	}
	return out
}

// Lint runs the policies in only (every one when empty) and returns the
// sorted, repository-relative findings, discovery included.
func Lint(root string, only []string, declarations bool) ([]Violation, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	return lint(options{root: abs, only: only, declarations: declarations})
}

// outcome is one policy's findings, or why it could not run.
type outcome struct {
	findings []Violation
	err      error
}

// lint starts the TS half first, runs the Go policies on every core while
// it works, then merges both in registry order.
func lint(opts options) ([]Violation, error) {
	policies := enabled(opts)
	remote := startDelegate(opts.root, policies)
	snapshot, err := workspace.Build(opts.root)
	if err != nil {
		<-remote
		return nil, err
	}
	local := parallel.Map(policies, func(p Policy) outcome {
		if p.Run == nil {
			return outcome{}
		}
		findings, err := p.Run(snapshot)
		return outcome{findings, err}
	})
	delegated := <-remote
	if delegated.err != nil {
		return nil, delegated.err
	}
	findings := append([]Violation(nil), snapshot.DiscoveryViolations...)
	for i, p := range policies {
		if local[i].err != nil {
			return nil, local[i].err
		}
		findings = append(findings, local[i].findings...)
		if p.Run == nil {
			findings = append(findings, delegated.byPolicy[p.ID]...)
		}
	}
	for i := range findings {
		findings[i].File = relativeFile(opts.root, findings[i].File)
	}
	sortFindings(findings)
	return findings, nil
}

func relativeFile(root, file string) string {
	if filepath.IsAbs(file) {
		return workspace.Relative(root, file)
	}
	return file
}

// delegated is the TS half's findings by policy id.
type delegated struct {
	byPolicy map[string][]Violation
	err      error
}

// startDelegate runs the TS-only policies in one Node process, in the background.
func startDelegate(root string, policies []Policy) <-chan delegated {
	done := make(chan delegated, 1)
	var ids []string
	for _, p := range policies {
		if p.Run == nil {
			ids = append(ids, p.ID)
		}
	}
	if len(ids) == 0 {
		done <- delegated{}
		return done
	}
	go func() {
		byPolicy, err := delegate(root, ids)
		done <- delegated{byPolicy, err}
	}()
	return done
}

// tsCLI is the TS enforcer's CLI inside the workspace.
func tsCLI(root string) []string {
	return []string{"--disable-warning=ExperimentalWarning", "--experimental-transform-types",
		filepath.Join(root, "packages", "architecture-enforcer", "src", "cli.ts")}
}

// node runs the TS CLI. The arguments are this CLI's own validated flags and
// the workspace's CLI path, never shell text: exec does no expansion.
func node(root string, args []string) *exec.Cmd {
	return exec.CommandContext(context.Background(), "node", append(tsCLI(root), args...)...) //nolint:gosec // G204: fixed binary, validated flags, no shell
}

// delegate runs the TS-only policies in one Node process.
func delegate(root string, ids []string) (map[string][]Violation, error) {
	cmd := node(root, []string{"--root", root, "--findings-json", "--policies", strings.Join(ids, ",")})
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("the TS policies (%s) failed: %w\n%s", strings.Join(ids, ","), err, strings.TrimSpace(stderr.String()))
	}
	var out map[string][]Violation
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		return nil, fmt.Errorf("the TS policies printed no findings JSON: %w", err)
	}
	return out, nil
}

// streams are the CLI's output writers.
type streams struct{ stdout, stderr io.Writer }

// typescript hands the whole run to the TS CLI: the test-quality review and
// the JSON delegate mode are not ported.
func typescript(root string, argv []string, out streams) int {
	cmd := node(root, argv)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, out.stdout, out.stderr
	err := cmd.Run()
	var exit *exec.ExitError
	switch {
	case err == nil:
		return 0
	case errors.As(err, &exit):
		return exit.ExitCode()
	}
	fmt.Fprintf(out.stderr, "architecture-enforcer: the run crashed\n  %s\n", err)
	return 2
}
