package apidiff

import (
	"context"
	"errors"
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
	a             string
	b             string
	keys          Keys
	timeout       time.Duration
	settleTimeout time.Duration
	// specSettle is how long the FIRST spec fetch waits out an instance whose
	// lane reported ready before it is actually serving. Only `run` sets it:
	// it booted the instance and knows a lane said ready. `probe` is handed
	// two addresses by its caller, where nothing answering means the address
	// is wrong, and waiting five minutes to say so helps nobody.
	specSettle      time.Duration
	pathPrefix      string
	method          string
	excludePrefixes stringSlice
	maxOps          int
	exactStatus     bool
	jsonOutput      bool
	reportFile      string
	ledgerFile      string
	ledgerBaseline  string
	// onOperationDone streams one finding per operation as its comparison
	// completes; nil for the plain `probe` subcommand, which has no run
	// directory to stream into. Set by `run` after Boot succeeds.
	onOperationDone func(Operation, []Finding)
	// activateEntitlement powers the entitled pass; nil for the plain
	// `probe` subcommand (no database) and for a haven-booted run. Set by
	// `run` from Booted.ActivateEntitlement after Boot succeeds.
	activateEntitlement EntitlementActivator
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
                [-dry-run] [-no-haven] [-pg-url URL -ch-url URL -redis-url URL]
                [-compose-project NAME] [probe flags...]
  apidiff probe -a URL -b URL [-project-key KEY] [-org-key KEY] [-admin-key KEY]
                [-timeout DUR] [-settle-timeout DUR] [-path-prefix P] [-method M]
                [-exclude-prefix P]... [-max-ops N] [-json] [-report FILE]
                [-ledger FILE] [-ledger-baseline FILE]

Each run instance is a haven stack under its own run-scoped slug wherever
haven is installed, so a run never reaches the datastores your own stack uses.
-no-haven boots the old way, on compose or on the three named servers.

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
	boot, probe, code, done := parseRunFlags(args, out)
	if done {
		return code
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

	// One JSON line per operation, appended as its comparison completes, so a
	// reader can tail .apidiff/<runID>/findings.jsonl during the run rather
	// than waiting for the final report.
	findings, closeFindings, err := openRunFindingsStream(booted.WorkRoot, out.stderr)
	if err != nil {
		fmt.Fprintln(out.stderr, "findings stream:", err)
		return exitError
	}
	defer closeFindings()

	probe.a = booted.A.URL
	probe.b = booted.B.URL
	probe.activateEntitlement = booted.ActivateEntitlement
	if boot.UseHaven {
		// The SCIM token and the permission-probe projects are inserted with
		// SQL, and the haven path runs none: a stack's database belongs to
		// haven. Both sides are missing the same fixtures, so those operations
		// still compare like against like - unauthorized against unauthorized.
		fmt.Fprintln(out.stderr, "haven path: SCIM and permission-probe fixtures are not provisioned; those operations compare unauthorized on both sides")
	}
	probe.applyRunDefaults()
	probe.onOperationDone = findingsHook(findings, boot.BranchDir, out.stderr)
	return probePipeline(ctx, probe, out)
}

// applyRunDefaults fills the probe credentials `run` mode itself provisioned:
// a throwaway instance-admin key, a fixed SCIM token, and the
// permission-probe project keys.
func (probe *probeFlags) applyRunDefaults() {
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
}

// openRunFindingsStream opens the run's findings.jsonl and returns a single
// close func that writes the run-complete line and closes the file, so the
// caller carries one defer instead of two.
func openRunFindingsStream(runDir string, stderr io.Writer) (*FindingsStream, func(), error) {
	stream, closeFile, err := NewFindingsStream(runDir)
	if err != nil {
		return nil, nil, err
	}
	closeAll := func() {
		if err := stream.Close(); err != nil {
			fmt.Fprintln(stderr, "findings stream:", err)
		}
		if err := closeFile(); err != nil {
			fmt.Fprintln(stderr, "findings stream:", err)
		}
	}
	return stream, closeAll, nil
}

// parseRunFlags parses `apidiff run`'s flags and settles everything decided
// before a real boot starts. done is true when the caller must return code
// immediately — a usage error, or a completed -dry-run — without booting
// anything.
func parseRunFlags(args []string, out streams) (BootConfig, *probeFlags, int, bool) {
	flags := flag.NewFlagSet("apidiff run", flag.ContinueOnError)
	flags.SetOutput(out.stderr)
	boot := BootConfig{}
	probe := &probeFlags{excludePrefixes: stringSlice{"/api/gateway"}, specSettle: specSettleTimeout}
	flags.StringVar(&boot.MainRef, "main-ref", "origin/main", "git ref to boot as the base instance; the remote ref by default, since a local main falls behind without anyone noticing")
	flags.StringVar(&boot.BranchDir, "branch-dir", ".", "checkout to diff (haven path: its HEAD is checked out into its own worktree; the checkout itself is never booted)")
	flags.StringVar(&boot.WorkRoot, "work-root", "", "worktree/log root (default <repo>/.apidiff/<timestamp>)")
	flags.BoolVar(&boot.Keep, "keep", false, "keep infra, databases and worktree after the run")
	flags.BoolVar(&boot.ReuseWorktrees, "reuse-worktrees", false, "reuse the existing <work-root>/main worktree")
	flags.BoolVar(&boot.SkipInstall, "skip-install", false, "skip pnpm install in both worktrees")
	flags.DurationVar(&boot.BootTimeout, "boot-timeout", 5*time.Minute, "per-instance health-wait timeout")
	flags.StringVar(&boot.PGURL, "pg-url", "", "external postgres server URL (with -ch-url/-redis-url skips compose)")
	flags.StringVar(&boot.CHURL, "ch-url", "", "external ClickHouse server URL")
	flags.StringVar(&boot.RedisURL, "redis-url", "", "external redis server URL")
	flags.StringVar(&boot.ComposeProject, "compose-project", "apidiff", "compose project name for the managed infra stack")
	flags.BoolVar(&boot.DryRun, "dry-run", false, "print the plan (refs, worktree paths, slugs, commands) and start nothing")
	noHaven := false
	flags.BoolVar(&noHaven, "no-haven", false, "do not boot the instances as haven stacks; provision compose or the -pg-url/-ch-url/-redis-url servers instead")
	envFile := ""
	flags.StringVar(&envFile, "env-file", "", "dotenv file whose DATABASE_URL, CLICKHOUSE_URL and REDIS_URL fill an empty -pg-url, -ch-url and -redis-url (never printed); not usable with the haven path")
	registerProbeFlags(flags, probe)
	if err := flags.Parse(args); err != nil {
		return boot, probe, exitError, true
	}
	external, err := externalInfra(boot)
	if err != nil {
		fmt.Fprintln(out.stderr, err)
		return boot, probe, exitError, true
	}
	boot.UseHaven = havenSelected(havenOnPath(), noHaven, external)
	if boot.UseHaven && envFile != "" {
		fmt.Fprintln(out.stderr, "-env-file and the haven path are exclusive: -env-file points the instances at the servers that dotenv names, which is the developer's own stack, and haven exists so a run never reaches it. Pass -no-haven to boot on those servers.")
		return boot, probe, exitError, true
	}
	if boot.DryRun {
		return boot, probe, writeDryRunPlanOrError(boot, out), true
	}
	if envFile != "" {
		applyEnvFile(envFile, &boot)
	}
	return boot, probe, exitEqual, false
}

// writeDryRunPlanOrError computes and prints -dry-run's plan, returning the
// exit code the caller reports.
func writeDryRunPlanOrError(boot BootConfig, out streams) int {
	plan, err := PlanBoot(boot)
	if err != nil {
		fmt.Fprintln(out.stderr, err)
		return exitError
	}
	WriteDryRunPlan(out.stdout, plan)
	return exitEqual
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
	specs, err := fetchBothSpecs(ctx, probe, specFetch{
		client:   client,
		settle:   probe.specSettle,
		progress: out.stderr,
	})
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
		A:                   probe.a,
		B:                   probe.b,
		Keys:                probe.keys,
		Schemes:             SecuritySchemes(specs.a, specs.b),
		Timeout:             probe.timeout,
		Filter:              probe.filter(),
		ExcludePrefixes:     probe.excludePrefixes,
		ExactStatus:         probe.exactStatus,
		Client:              client,
		Progress:            out.stderr,
		SettleTimeout:       probe.settleTimeout,
		OnOperationDone:     probe.onOperationDone,
		ActivateEntitlement: probe.activateEntitlement,
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
	// A run that lost a credential did not measure the branch, it measured
	// two refusals. That is an instrument failure, not a verdict about the
	// code, so it exits as an error rather than as "differences" or "equal" —
	// either of which would invite someone to read the numbers.
	if lost := verdict.report.LostCredentials(); len(lost) > 0 {
		for _, check := range lost {
			fmt.Fprintf(out.stderr, "CREDENTIAL LOST: %s %s\n", check.Label, check.Note)
		}
		fmt.Fprintln(out.stderr, "this run's counts are not comparable with any other run: probes made after the loss compared a dead credential, and their agreement is not evidence")
		return exitError
	}
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

// specSettleTimeout is how long an instance whose lane already reported ready
// gets to actually serve its document. Readiness is a lane listening; serving
// is the proxy route registered and the application answering, and those are
// seconds to minutes apart on a cold monolith. A run that fetched exactly once
// died at exit 2 on a 502 the next attempt would not have seen (run
// 20260916-094406), so the first fetch settles rather than decides.
//
// It is the `run` path's window only. A zero window is one attempt, which is
// what `probe` wants: it did not boot the instance, so nothing answering means
// the address it was handed is wrong.
const specSettleTimeout = 5 * time.Minute

// specSettleInterval is how often the settle re-asks. A variable so a test
// can shrink it; nothing but a test ever assigns it.
var specSettleInterval = 5 * time.Second

// notServingYet reports whether err is the instance not being reachable yet
// rather than the instance answering with something wrong. A transport error
// means nothing answered at all; a gateway status means the proxy answered
// for an upstream it could not reach. Every other status is the instance's
// own answer, and waiting cannot change it.
func notServingYet(err error) bool {
	var status *SpecStatusError
	if errors.As(err, &status) {
		return status.Status == http.StatusBadGateway ||
			status.Status == http.StatusServiceUnavailable ||
			status.Status == http.StatusGatewayTimeout
	}
	return true
}

// specFetch is one instance's first spec fetch: where from, how long it may
// settle before the fetch decides, and where its progress is written.
type specFetch struct {
	client   *http.Client
	baseURL  string
	settle   time.Duration
	progress io.Writer
}

// keepWaiting reports whether this failure is worth another attempt: only an
// instance that has not started serving yet, inside the settle window, with
// the run not already canceled.
func (fetch specFetch) keepWaiting(ctx context.Context, err error, deadline time.Time) bool {
	return notServingYet(err) && ctx.Err() == nil && time.Now().Before(deadline)
}

// report writes the settle's progress: the first wait and every sixth after
// it, so a long settle says it is still going without filling the log.
func (fetch specFetch) report(attempt int, err error) {
	if err == nil {
		if attempt > 1 {
			fmt.Fprintf(fetch.progress, "spec from %s served on attempt %d\n", fetch.baseURL, attempt)
		}
		return
	}
	if attempt == 1 || attempt%6 == 0 {
		fmt.Fprintf(fetch.progress, "waiting for %s to serve %s (%v)\n", fetch.baseURL, SpecPath, err)
	}
}

// fetchSpecSettled fetches one instance's spec, waiting out the window between
// its lane reporting ready and the application actually serving. Progress is
// reported rather than going silent, the same way the boot wait does.
func fetchSpecSettled(ctx context.Context, fetch specFetch) (map[string]any, []byte, error) {
	deadline := time.Now().Add(fetch.settle)
	for attempt := 1; ; attempt++ {
		document, body, err := FetchSpec(ctx, fetch.client, fetch.baseURL)
		if err == nil {
			fetch.report(attempt, nil)
			return document, body, nil
		}
		if !fetch.keepWaiting(ctx, err, deadline) {
			return nil, nil, err
		}
		fetch.report(attempt, err)
		select {
		case <-ctx.Done():
			return nil, nil, ctx.Err()
		case <-time.After(specSettleInterval):
		}
	}
}

func fetchBothSpecs(
	ctx context.Context,
	probe *probeFlags,
	fetch specFetch,
) (*fetchedSpecs, error) {
	specs := &fetchedSpecs{}
	var err error
	fetch.baseURL = probe.a
	if specs.a, specs.aBytes, err = fetchSpecSettled(ctx, fetch); err != nil {
		return nil, err
	}
	fetch.baseURL = probe.b
	if specs.b, specs.bBytes, err = fetchSpecSettled(ctx, fetch); err != nil {
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
	return withoutVersionMounts(changes), UnionOperations(operationsA, operationsB), nil
}

// withoutVersionMounts drops the spec changes that only describe a URL version
// mount, for the same reason the union drops the operations (VersionMountPath).
func withoutVersionMounts(changes []openapidiff.Change) []openapidiff.Change {
	kept := make([]openapidiff.Change, 0, len(changes))
	for _, change := range changes {
		if VersionMountPath(change.Path) {
			continue
		}
		kept = append(kept, change)
	}
	return kept
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
