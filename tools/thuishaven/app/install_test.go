package app

import (
	"bytes"
	"context"
	"errors"
	"runtime"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// fakeTools is a machine with a declared set of binaries and brew formulae on
// it, recording every installer it was asked to run. Nothing here touches the
// real machine, which is the point: the ordering, the refusals and the skip
// bookkeeping are the behavior, and none of it should need a laptop with the
// wrong things installed to exercise.
type fakeTools struct {
	binaries map[string]bool
	formulae []string
	ran      []string
	failOn   string
}

func (f *fakeTools) BinaryPath(name string) string {
	if f.binaries[name] {
		return "/usr/local/bin/" + name
	}
	return ""
}

func (f *fakeTools) FormulaInstalled(_ context.Context, prefix string) (string, bool) {
	for _, name := range f.formulae {
		if strings.HasPrefix(name, prefix) {
			return name, true
		}
	}
	return "", false
}

func (f *fakeTools) Install(_ context.Context, command string) error {
	f.ran = append(f.ran, command)
	if f.failOn != "" && strings.Contains(command, f.failOn) {
		return errors.New("installer exploded")
	}
	return nil
}

// installOrchestrator builds the smallest graph the install command needs.
func installOrchestrator(tools *fakeTools, store *fakeStore, proxy Proxy) *Orchestrator {
	return &Orchestrator{prereqs: tools, store: store, proxy: proxy}
}

// missingPortlessProxy is a machine where portless has never been installed.
type missingPortlessProxy struct {
	fakeProxy
	installs int
}

func (p *missingPortlessProxy) Installed() bool { return false }
func (p *missingPortlessProxy) Version() string { return "" }
func (p *missingPortlessProxy) Install() error  { p.installs++; return nil }

// @scenario "A required prerequisite that is missing fails the check"
func TestCheckPrereqsReportsAMissingRequiredEntry(t *testing.T) {
	o := installOrchestrator(&fakeTools{}, &fakeStore{}, &missingPortlessProxy{})
	report := o.CheckPrereqs(context.Background())
	st := reportEntry(t, report, "portless")
	if st.State != domain.PrereqMissing {
		t.Errorf("portless = %v, want missing", st.State)
	}
	if !strings.Contains(domain.ReadyLine(report), "not ready") {
		t.Errorf("verdict = %q, want not ready", domain.ReadyLine(report))
	}
}

// A tool installed but not linked onto PATH is installed. brew keeps
// postgresql@NN keg-only, so probing `psql` alone reports a machine with a
// perfectly good server as having none — and then offers to install a second.
// @scenario "Everything present reports ready and installs nothing"
func TestCheckPrereqsFallsBackToTheBrewFormula(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("the brew-backed entries are macOS only")
	}
	tools := &fakeTools{binaries: map[string]bool{}, formulae: []string{"postgresql@15"}}
	o := installOrchestrator(tools, &fakeStore{}, &fakeProxy{})
	st := reportEntry(t, o.CheckPrereqs(context.Background()), "postgres")
	if st.State != domain.PrereqSatisfied {
		t.Errorf("postgres = %v, want satisfied — an unlinked keg is still installed", st.State)
	}
	if st.Observed != "postgresql@15" {
		t.Errorf("observed = %q, want the formula that matched", st.Observed)
	}
}

// Every binary a candidate names has to be there. colima with no docker is
// not a runtime haven can drive, and calling it one moves the failure to the
// first image build.
// @scenario "A missing runtime offers the alternatives as one pick"
func TestCheckPrereqsNeedsEveryBinaryOfACandidate(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("the container runtime is macOS only here")
	}
	tools := &fakeTools{binaries: map[string]bool{"colima": true}}
	o := installOrchestrator(tools, &fakeStore{}, &fakeProxy{})
	st := reportEntry(t, o.CheckPrereqs(context.Background()), "runtime")
	if st.State != domain.PrereqMissing {
		t.Errorf("runtime = %v, want missing — colima without docker is not a runtime", st.State)
	}
}

// @scenario "Installs run with the terminal to themselves"
func TestInstallPrereqsRunsInDependencyOrder(t *testing.T) {
	tools := &fakeTools{}
	o := installOrchestrator(tools, &fakeStore{}, &fakeProxy{})
	err := o.installPrereqsTo(context.Background(), &bytes.Buffer{}, []domain.Chosen{
		{Key: "redis", Candidate: "redis"},
		{Key: "node", Candidate: "node"},
	})
	if err != nil {
		t.Fatalf("InstallPrereqs: %v", err)
	}
	if len(tools.ran) != 2 || !strings.Contains(tools.ran[0], "node") {
		t.Errorf("ran %v, want node first", tools.ran)
	}
}

// @scenario "A prerequisite haven cannot install itself is explained, not attempted"
func TestInstallPrereqsExplainsTheManualEntryInsteadOfRunningIt(t *testing.T) {
	tools := &fakeTools{}
	o := installOrchestrator(tools, &fakeStore{}, &fakeProxy{})
	var out bytes.Buffer
	if err := o.installPrereqsTo(context.Background(), &out, []domain.Chosen{{Key: "brew", Candidate: "brew"}}); err != nil {
		t.Fatalf("a manual entry must not be an error: %v", err)
	}
	if len(tools.ran) != 0 {
		t.Errorf("ran %v, want nothing — haven does not run the Homebrew installer", tools.ran)
	}
	if !strings.Contains(out.String(), "install.sh") {
		t.Errorf("output must print the command to run by hand, got %q", out.String())
	}
}

// @scenario "One failed install does not silently skip the rest"
func TestInstallPrereqsStopsAtTheFirstFailure(t *testing.T) {
	tools := &fakeTools{failOn: "pnpm"}
	o := installOrchestrator(tools, &fakeStore{}, &fakeProxy{})
	err := o.installPrereqsTo(context.Background(), &bytes.Buffer{}, []domain.Chosen{
		{Key: "node", Candidate: "node"},
		{Key: "pnpm", Candidate: "pnpm"},
		{Key: "redis", Candidate: "redis"},
	})
	if err == nil {
		t.Fatal("a failed install must fail the run rather than report a success it did not get")
	}
	if !strings.Contains(err.Error(), "pnpm") {
		t.Errorf("error %q must name the prerequisite that failed", err)
	}
	for _, ran := range tools.ran {
		if strings.Contains(ran, "redis") {
			t.Error("the run must stop rather than carry on past a failure its successors may depend on")
		}
	}
}

// portless is installed through the proxy adapter, which owns the pinned
// package and the by-hand error — not through a second `npm install -g` that
// would have to be kept in step with it.
// @scenario "Installs run with the terminal to themselves"
func TestInstallPortlessGoesThroughTheProxyAdapter(t *testing.T) {
	proxy := &missingPortlessProxy{}
	tools := &fakeTools{}
	o := installOrchestrator(tools, &fakeStore{}, proxy)
	if err := o.installPrereqsTo(context.Background(), &bytes.Buffer{}, []domain.Chosen{{Key: "portless", Candidate: "portless"}}); err != nil {
		t.Fatalf("InstallPrereqs: %v", err)
	}
	if proxy.installs != 1 {
		t.Errorf("proxy installs = %d, want 1", proxy.installs)
	}
	if len(tools.ran) != 0 {
		t.Errorf("nothing should be shelled out for portless, ran %v", tools.ran)
	}
}

// @scenario "Declining with never is persisted"
func TestSkipPrereqsRecordsAndIsHonoured(t *testing.T) {
	store := &fakeStore{}
	o := installOrchestrator(&fakeTools{}, store, &fakeProxy{})
	changed, err := o.SkipPrereqs([]string{"clickhouse-client"})
	if err != nil {
		t.Fatalf("SkipPrereqs: %v", err)
	}
	if len(changed) != 1 {
		t.Fatalf("changed = %v, want the one key", changed)
	}
	if !o.PrereqSkips()["clickhouse-client"] {
		t.Error("the skip must be readable back")
	}
	// A repeat is a no-op, so a second run does not report a change it did
	// not make.
	again, err := o.SkipPrereqs([]string{"clickhouse-client"})
	if err != nil || len(again) != 0 {
		t.Errorf("second skip = %v, %v; want no change", again, err)
	}
}

// @scenario "Declining with never is persisted"
func TestSkipPrereqsRefusesARequiredEntry(t *testing.T) {
	o := installOrchestrator(&fakeTools{}, &fakeStore{}, &fakeProxy{})
	if _, err := o.SkipPrereqs([]string{"portless"}); err == nil {
		t.Fatal("a required prerequisite must not be silenceable")
	}
	if o.PrereqSkips()["portless"] {
		t.Error("a refused skip must not be written")
	}
}

// @scenario "A skipped prerequisite is still installed when named"
func TestInstallingASkippedPrerequisiteClearsTheSkip(t *testing.T) {
	store := &fakeStore{prereqSkips: map[string]bool{"clickhouse-client": true}}
	o := installOrchestrator(&fakeTools{}, store, &fakeProxy{})
	chosen, err := ResolvePrereqNames([]string{"clickhouse-client"})
	if err != nil {
		t.Fatalf("ResolvePrereqNames: %v", err)
	}
	if err := o.installPrereqsTo(context.Background(), &bytes.Buffer{}, chosen); err != nil {
		t.Fatalf("InstallPrereqs: %v", err)
	}
	if o.PrereqSkips()["clickhouse-client"] {
		t.Error("installing it answers the question the skip was suppressing — the skip must go")
	}
}

// @scenario "The skips can be cleared"
func TestResetPrereqSkipsClearsEverything(t *testing.T) {
	store := &fakeStore{prereqSkips: map[string]bool{"clickhouse-client": true, "runtime": true}}
	o := installOrchestrator(&fakeTools{}, store, &fakeProxy{})
	cleared, err := o.ResetPrereqSkips()
	if err != nil {
		t.Fatalf("ResetPrereqSkips: %v", err)
	}
	if len(cleared) != 2 {
		t.Errorf("cleared = %v, want both", cleared)
	}
	if len(o.PrereqSkips()) != 0 {
		t.Errorf("skips = %v, want empty", o.PrereqSkips())
	}
	// Nothing to clear reports nothing rather than claiming a change.
	again, err := o.ResetPrereqSkips()
	if err != nil || len(again) != 0 {
		t.Errorf("second reset = %v, %v; want no change", again, err)
	}
}

// @scenario "A non-interactive run with --yes installs what is needed"
func TestAutoPrereqsTakesWhatHavenNeedsAndLeavesConveniences(t *testing.T) {
	report := domain.PlanPrereqs(map[string]domain.Found{}, nil, "darwin")
	chosen := AutoPrereqs(report)
	picked := map[string]string{}
	for _, c := range chosen {
		picked[c.Key] = c.Candidate
	}
	for _, want := range []string{"node", "pnpm", "portless", "postgres", "redis", "go"} {
		if _, ok := picked[want]; !ok {
			t.Errorf("--yes must install %s (required or recommended)", want)
		}
	}
	for _, unwanted := range []string{"clickhouse-client", "runtime", "rtk"} {
		if _, ok := picked[unwanted]; ok {
			t.Errorf("--yes must not install the optional %s — it was never asked for", unwanted)
		}
	}
	// Homebrew is chosen but not run: InstallPrereqs prints its command. It
	// still belongs in the list, or a machine with no brew gets a wall of
	// formula failures and no hint of the cause.
	if _, ok := picked["brew"]; !ok {
		t.Error("--yes must still surface Homebrew, since every formula below it depends on it")
	}
}

// @scenario "A skipped prerequisite is still installed when named"
func TestResolvePrereqNamesRejectsUnknownNames(t *testing.T) {
	if _, err := ResolvePrereqNames([]string{"postgres", "nonsense"}); err == nil {
		t.Fatal("an unknown prerequisite must fail with the list, not be ignored")
	} else if !strings.Contains(err.Error(), "clickhouse-client") {
		t.Errorf("error %q should list what is available", err)
	}
}

// @scenario "A missing runtime offers the alternatives as one pick"
func TestResolvePrereqNamesTakesAnExplicitCandidate(t *testing.T) {
	chosen, err := ResolvePrereqNames([]string{"runtime=docker-desktop"})
	if err != nil {
		t.Fatalf("ResolvePrereqNames: %v", err)
	}
	if chosen[0].Candidate != "docker-desktop" {
		t.Errorf("candidate = %q, want the one named", chosen[0].Candidate)
	}
	if _, err := ResolvePrereqNames([]string{"runtime=podman"}); err == nil {
		t.Error("an option that does not exist must fail rather than fall back to the default")
	}
}

// @scenario "Everything present reports ready and installs nothing"
func TestInstallPrereqsWithNothingChosenInstallsNothing(t *testing.T) {
	tools := &fakeTools{}
	o := installOrchestrator(tools, &fakeStore{}, &fakeProxy{})
	var out bytes.Buffer
	if err := o.installPrereqsTo(context.Background(), &out, nil); err != nil {
		t.Fatalf("InstallPrereqs: %v", err)
	}
	if len(tools.ran) != 0 {
		t.Errorf("ran %v, want nothing", tools.ran)
	}
	if !strings.Contains(out.String(), "nothing installed") {
		t.Errorf("output = %q, want it to say nothing happened", out.String())
	}
}

func reportEntry(t *testing.T, report []domain.PrereqStatus, key string) domain.PrereqStatus {
	t.Helper()
	for _, st := range report {
		if st.Key == key {
			return st
		}
	}
	t.Fatalf("no %q in the report", key)
	return domain.PrereqStatus{}
}
