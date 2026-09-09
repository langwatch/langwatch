package apidiff

import (
	"context"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/openapidiff"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Exit codes: 0 no behavioral differences, 1 differences found, 2
// operational or usage error.
const (
	exitEqual = iota
	exitDifferences
	exitError
)

// streams pairs the command's output writers: stdout carries only the
// deterministic report, stderr carries progress and errors.
type streams struct {
	stdout io.Writer
	stderr io.Writer
}

// stringSlice is a repeatable string flag (e.g. -exclude-prefix).
type stringSlice []string

func (values *stringSlice) String() string { return strings.Join(*values, ",") }

func (values *stringSlice) Set(value string) error {
	*values = append(*values, value)
	return nil
}

// probeFlags holds the flags shared by `run` and `probe`.
type probeFlags struct {
	a               string
	b               string
	keys            Keys
	timeout         time.Duration
	settleTimeout   time.Duration
	pathPrefix      string
	method          string
	excludePrefixes stringSlice
	maxOps          int
	exactStatus     bool
	jsonOutput      bool
	reportFile      string
	ledgerFile      string
	ledgerBaseline  string
}

func (probe *probeFlags) filter() OpFilter {
	return OpFilter{Method: probe.method, PathPrefix: probe.pathPrefix, MaxOps: probe.maxOps}
}

func registerProbeFlags(flags *flag.FlagSet, probe *probeFlags) {
	flags.StringVar(&probe.a, "a", "", "candidate (after) instance base URL")
	flags.StringVar(&probe.b, "b", "", "base (before) instance base URL")
	flags.StringVar(&probe.keys.ProjectKey, "project-key", DefaultProjectKey, "project API key (seed default)")
	flags.StringVar(&probe.keys.OrgKey, "org-key", DefaultOrgKey, "organization bearer token (seed default)")
	flags.StringVar(&probe.keys.AdminKey, "admin-key", "", "instance admin key (run mode injects a throwaway one)")
	flags.StringVar(&probe.keys.ScimKey, "scim-key", "", "SCIM provisioning token (run mode seeds a fixed one)")
	flags.StringVar(&probe.keys.ProjectKeyB, "project-key-b", "", "same-org sibling project key for permission probes (run mode provisions one)")
	flags.StringVar(&probe.keys.ProjectKeyC, "project-key-c", "", "foreign-org project key for permission probes (run mode provisions one)")
	flags.DurationVar(&probe.timeout, "timeout", 30*time.Second, "per-request timeout")
	flags.DurationVar(&probe.settleTimeout, "settle-timeout", defaultSettleTimeout, "how long to poll a collection for a created entity before calling it invisible (negative disables the wait)")
	flags.StringVar(&probe.pathPrefix, "path-prefix", "", "only probe operations under this path prefix")
	flags.StringVar(&probe.method, "method", "", "only probe this HTTP method")
	flags.Var(&probe.excludePrefixes, "exclude-prefix", "path prefix to skip (repeatable)")
	flags.IntVar(&probe.maxOps, "max-ops", 0, "cap the number of probed operations (0 = all)")
	flags.BoolVar(&probe.exactStatus, "exact-status", false, "compare exact status codes and error bodies (default: classes only, error bodies skipped)")
	flags.BoolVar(&probe.jsonOutput, "json", false, "write the machine report to stdout instead of the summary")
	flags.StringVar(&probe.reportFile, "report", "", "also write the machine report (JSON) to this file")
	flags.StringVar(&probe.ledgerFile, "ledger", "", "write the per-operation ledger to this file (default: ledger.json beside -report)")
	flags.StringVar(&probe.ledgerBaseline, "ledger-baseline", "", "a previous ledger.json (or JSON array of cause slugs) whose causes are already known; only NEW causes fail the run")
}

const usage = `apidiff — live two-instance API behavior diff

usage:
  apidiff run   [-main-ref REF] [-branch-dir DIR] [-work-root DIR]
                [-keep] [-reuse-worktrees] [-skip-install] [-boot-timeout DUR]
                [-pg-url URL -ch-url URL -redis-url URL] [-compose-project NAME]
                [probe flags...]
  apidiff probe -a URL -b URL [-project-key KEY] [-org-key KEY] [-admin-key KEY]
                [-timeout DUR] [-settle-timeout DUR] [-path-prefix P] [-method M]
                [-exclude-prefix P]... [-max-ops N] [-json] [-report FILE]
                [-ledger FILE] [-ledger-baseline FILE]

exit codes: 0 no behavioral differences, 1 differences found, 2 error.
`

// Run executes the apidiff command and returns its documented exit code.
func Run(args []string, stdout, stderr io.Writer) int {
	if stdout == nil || stderr == nil {
		return exitError
	}
	out := streams{stdout: stdout, stderr: stderr}
	if len(args) == 0 {
		fmt.Fprint(out.stderr, usage)
		return exitError
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch args[0] {
	case "probe":
		return runProbeSubcommand(ctx, args[1:], out)
	case "run":
		return runBootSubcommand(ctx, args[1:], out)
	default:
		fmt.Fprintf(out.stderr, "unknown subcommand %q\n%s", args[0], usage)
		return exitError
	}
}

func runProbeSubcommand(ctx context.Context, args []string, out streams) int {
	flags := flag.NewFlagSet("apidiff probe", flag.ContinueOnError)
	flags.SetOutput(out.stderr)
	probe := &probeFlags{excludePrefixes: stringSlice{"/api/gateway"}}
	registerProbeFlags(flags, probe)
	if err := flags.Parse(args); err != nil {
		return exitError
	}
	if probe.a == "" || probe.b == "" {
		fmt.Fprintln(out.stderr, "probe requires -a and -b")
		return exitError
	}
	return probePipeline(ctx, probe, out)
}

func runBootSubcommand(ctx context.Context, args []string, out streams) int {
	flags := flag.NewFlagSet("apidiff run", flag.ContinueOnError)
	flags.SetOutput(out.stderr)
	boot := BootConfig{}
	probe := &probeFlags{excludePrefixes: stringSlice{"/api/gateway"}}
	flags.StringVar(&boot.MainRef, "main-ref", "main", "git ref to boot as the base instance")
	flags.StringVar(&boot.BranchDir, "branch-dir", ".", "checkout to boot as the candidate instance")
	flags.StringVar(&boot.WorkRoot, "work-root", "", "worktree/log root (default <repo>/.apidiff/<timestamp>)")
	flags.BoolVar(&boot.Keep, "keep", false, "keep infra, databases and worktree after the run")
	flags.BoolVar(&boot.ReuseWorktrees, "reuse-worktrees", false, "reuse the existing <work-root>/main worktree")
	flags.BoolVar(&boot.SkipInstall, "skip-install", false, "skip pnpm install in both worktrees")
	flags.DurationVar(&boot.BootTimeout, "boot-timeout", 5*time.Minute, "per-instance health-wait timeout")
	flags.StringVar(&boot.PGURL, "pg-url", "", "external postgres server URL (with -ch-url/-redis-url skips compose)")
	flags.StringVar(&boot.CHURL, "ch-url", "", "external ClickHouse server URL")
	flags.StringVar(&boot.RedisURL, "redis-url", "", "external redis server URL")
	flags.StringVar(&boot.ComposeProject, "compose-project", "apidiff", "compose project name for the managed infra stack")
	envFile := ""
	flags.StringVar(&envFile, "env-file", "", "dotenv file whose DATABASE_URL, CLICKHOUSE_URL and REDIS_URL fill an empty -pg-url, -ch-url and -redis-url (never printed)")
	registerProbeFlags(flags, probe)
	if err := flags.Parse(args); err != nil {
		return exitError
	}
	if envFile != "" {
		applyEnvFile(envFile, &boot)
	}

	// The child processes inherit this context; canceling it kills them.
	bootCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	booted, err := Boot(bootCtx, boot, out.stderr)
	if err != nil {
		fmt.Fprintln(out.stderr, "boot:", err)
		return exitError
	}
	defer booted.Teardown()

	probe.a = booted.A.URL
	probe.b = booted.B.URL
	// Run mode injected a throwaway instance admin key into both instances,
	// seeded a fixed SCIM token, and provisioned the permission-probe
	// fixtures; default the probe credentials to them.
	if probe.keys.AdminKey == "" {
		probe.keys.AdminKey = throwawayInstanceAdminKey
	}
	if probe.keys.ScimKey == "" {
		probe.keys.ScimKey = scimProbeToken
	}
	if probe.keys.ProjectKeyB == "" {
		probe.keys.ProjectKeyB = ProjectKeyB
	}
	if probe.keys.ProjectKeyC == "" {
		probe.keys.ProjectKeyC = ProjectKeyC
	}
	return probePipeline(ctx, probe, out)
}

// probePipeline is the shared compare flow: fetch both specs, diff them,
// probe the operation union in lockstep, then report.
func probePipeline(ctx context.Context, probe *probeFlags, out streams) int {
	if probe.method != "" && !openapidiff.IsHTTPMethod(probe.method) {
		fmt.Fprintf(out.stderr, "invalid HTTP method %q\n", probe.method)
		return exitError
	}
	baseline, err := loadBaseline(probe.ledgerBaseline)
	if err != nil {
		fmt.Fprintln(out.stderr, err)
		return exitError
	}

	client := &http.Client{Timeout: probe.timeout}
	fmt.Fprintf(out.stderr, "fetching %s from both instances\n", SpecPath)
	specs, err := fetchBothSpecs(ctx, client, probe)
	if err != nil {
		fmt.Fprintln(out.stderr, err)
		return exitError
	}
	changes, operations, err := specs.diffAndUnion()
	if err != nil {
		fmt.Fprintln(out.stderr, err)
		return exitError
	}

	selected := SelectOperations(operations, probe.filter())
	fmt.Fprintf(out.stderr, "probing %d operations (lockstep)\n", len(selected))
	result := ProbeAll(ctx, ProbeOptions{
		A:               probe.a,
		B:               probe.b,
		Keys:            probe.keys,
		Schemes:         SecuritySchemes(specs.a, specs.b),
		Timeout:         probe.timeout,
		Filter:          probe.filter(),
		ExcludePrefixes: probe.excludePrefixes,
		ExactStatus:     probe.exactStatus,
		Client:          client,
		Progress:        out.stderr,
		SettleTimeout:   probe.settleTimeout,
	}, operations)

	verdict := runVerdict{report: BuildReport(changes, result), probe: probe}
	verdict.ledger = BuildLedger(operations, verdict.report, baseline)
	if code := emitReport(verdict, out); code != exitEqual {
		return code
	}
	return verdict.exitCode(out)
}

// runVerdict is one completed comparison: what was found, how it groups, and
// the flags that decide the exit code.
type runVerdict struct {
	report Report
	ledger Ledger
	probe  *probeFlags
}

// loadBaseline reads the known-cause set, or nil when no baseline is given.
func loadBaseline(path string) (map[string]bool, error) {
	if path == "" {
		return nil, nil
	}
	return LoadCauseBaseline(path)
}

// exitCode decides the run's verdict. Without a baseline, any difference
// fails. With one, the known causes are the ratchet: they are still
// reported, and only a cause the baseline does not name fails the run, so a
// branch can drive 40 causes to 0 without the tool being red throughout.
func (verdict runVerdict) exitCode(out streams) int {
	if verdict.probe.ledgerBaseline == "" {
		if verdict.report.Differences > 0 {
			return exitDifferences
		}
		return exitEqual
	}
	fmt.Fprintf(out.stderr, "ledger baseline %s: %d known causes, %d new\n",
		verdict.probe.ledgerBaseline, verdict.ledger.Totals.KnownCauses, verdict.ledger.Totals.NewCauses)
	if verdict.ledger.Totals.NewCauses > 0 {
		return exitDifferences
	}
	return exitEqual
}

// fetchedSpecs holds both instances' parsed documents and raw bytes.
type fetchedSpecs struct {
	a, b           map[string]any
	aBytes, bBytes []byte
}

func fetchBothSpecs(ctx context.Context, client *http.Client, probe *probeFlags) (*fetchedSpecs, error) {
	specs := &fetchedSpecs{}
	var err error
	if specs.a, specs.aBytes, err = FetchSpec(ctx, client, probe.a); err != nil {
		return nil, err
	}
	if specs.b, specs.bBytes, err = FetchSpec(ctx, client, probe.b); err != nil {
		return nil, err
	}
	return specs, nil
}

// diffAndUnion runs the spec-level diff (B is the base, A the candidate —
// mirroring openapidiff BASE CANDIDATE argument order) and parses the
// operation union.
func (specs *fetchedSpecs) diffAndUnion() ([]openapidiff.Change, []Operation, error) {
	specDir, err := os.MkdirTemp("", "apidiff-spec-")
	if err != nil {
		return nil, nil, err
	}
	defer os.RemoveAll(specDir)
	changes, err := SpecDiff(specs.bBytes, specs.aBytes, specDir)
	if err != nil {
		return nil, nil, fmt.Errorf("spec diff: %w", err)
	}
	operationsA, err := Operations(specs.a)
	if err != nil {
		return nil, nil, fmt.Errorf("candidate spec: %w", err)
	}
	operationsB, err := Operations(specs.b)
	if err != nil {
		return nil, nil, fmt.Errorf("base spec: %w", err)
	}
	return changes, UnionOperations(operationsA, operationsB), nil
}

// emitReport writes the machine report and ledger files and the stdout
// rendering, which opens with the root-cause summary.
func emitReport(verdict runVerdict, out streams) int {
	if err := verdict.writeFiles(out); err != nil {
		fmt.Fprintln(out.stderr, err)
		return exitError
	}
	if verdict.probe.jsonOutput && verdict.probe.reportFile == "" {
		if err := WriteJSONReport(out.stdout, verdict.report); err != nil {
			fmt.Fprintln(out.stderr, err)
			return exitError
		}
		return exitEqual
	}
	if err := WriteCauseSummary(out.stdout, verdict.ledger); err != nil {
		fmt.Fprintln(out.stderr, err)
		return exitError
	}
	if err := WriteHumanSummary(out.stdout, verdict.report); err != nil {
		fmt.Fprintln(out.stderr, err)
		return exitError
	}
	return exitEqual
}

// writeFiles persists the machine report and the ledger beside it.
func (verdict runVerdict) writeFiles(out streams) error {
	if path := verdict.probe.reportFile; path != "" {
		if err := writeJSONFile(path, func(file *os.File) error { return WriteJSONReport(file, verdict.report) }); err != nil {
			return err
		}
	}
	path := ledgerPath(verdict.probe)
	if path == "" {
		return nil
	}
	if err := writeJSONFile(path, func(file *os.File) error { return WriteLedger(file, verdict.ledger) }); err != nil {
		return err
	}
	fmt.Fprintf(out.stderr, "ledger: %s\n", path)
	return nil
}

// ledgerPath resolves where the ledger goes: -ledger wins, otherwise
// ledger.json lands beside the report file, and nothing is written when
// neither was asked for.
func ledgerPath(probe *probeFlags) string {
	if probe.ledgerFile != "" {
		return probe.ledgerFile
	}
	if probe.reportFile == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(probe.reportFile), "ledger.json")
}

func writeJSONFile(path string, write func(*os.File) error) error {
	file, err := os.Create(path) // #nosec G304 -- operator-supplied output path
	if err != nil {
		return err
	}
	writeErr := write(file)
	closeErr := file.Close()
	if writeErr != nil {
		return fmt.Errorf("write %s: %w", path, writeErr)
	}
	return closeErr
}

// applyEnvFile fills the external server URLs from a dotenv file. Reading the
// file here, with a dotenv parser, is what keeps a shell from ever sourcing
// it: a dotenv file is not a shell script, and a multi-line value it cannot
// parse is echoed back by the shell as an error.
func applyEnvFile(envFile string, boot *BootConfig) {
	values := map[string]string{}
	domain.ReadEnvFile(envFile, values)
	if boot.PGURL == "" {
		boot.PGURL = values["DATABASE_URL"]
	}
	if boot.CHURL == "" {
		boot.CHURL = values["CLICKHOUSE_URL"]
	}
	if boot.RedisURL == "" {
		boot.RedisURL = values["REDIS_URL"]
	}
}
