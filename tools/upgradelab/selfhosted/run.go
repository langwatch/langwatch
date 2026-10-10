package selfhosted

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/cell"
	"github.com/langwatch/langwatch/tools/upgradelab/generate"
)

//go:embed pages.mjs
var pagesScript []byte

// Options is a run: the plan's config, the seed whose account the walk signs in with, and the
// checkout whose apps/ui resolves @playwright/test.
type Options struct {
	Config
	Seed          int64
	UIDir         string
	DryRun        bool // write the files and the plan, run nothing
	NoAdminEmails bool // the operator never set ADMIN_EMAILS (sh-free's second variant)
}

type runner struct {
	options    Options
	origin     time.Time
	transcript []cell.TranscriptStep
	shots      []cell.Shot
	background []*exec.Cmd
}

// Run executes the plan for options.Path and writes transcript.md, report.md, report.json and shots/
// into the run dir. It returns the report; a failed step stops the run and is the report's Error.
func Run(ctx context.Context, options Options) (*cell.Report, error) {
	profile, ok := cell.Profiles[options.Deployment]
	profile.NoAdminEmails = options.NoAdminEmails
	if !ok || !profile.StopStart {
		return nil, fmt.Errorf("deployment %q is not a self-hosted profile", options.Deployment)
	}
	email, _ := generate.SeedAccount(options.Seed)
	env, err := cell.OperatorEnv(profile, Origin(options.Path), email)
	if err != nil {
		return nil, err
	}
	steps, err := planFor(options, env)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(options.RunDir, "shots"), 0o750); err != nil {
		return nil, err
	}
	run := &runner{options: options, origin: time.Now()}
	report := &cell.Report{Cell: options.Path + "-" + options.Deployment, Deployment: options.Deployment, Shape: profile.Shape, Started: run.origin.Format(time.RFC3339)}
	defer run.stopBackground()
	if options.DryRun {
		return report, run.dryRun(report, steps)
	}
	run.execute(ctx, steps, report)
	if report.Error == "" {
		run.shoot(ctx, "settled", true)
	}
	report.Shots = run.shots
	run.judge(ctx, report, profile.Shape == "sh-licensed")
	return report, run.write(report)
}

// execute runs every step; at the guide's first upgrade command it shoots main and starts the probe and the walk.
func (run *runner) execute(ctx context.Context, steps []Step, report *cell.Report) {
	var poller *cell.Poller
	cancelPoll := func() {}
	for _, step := range steps {
		if step.Phase == "upgrade" && poller == nil {
			run.shoot(ctx, "main", true)
			poller, cancelPoll = run.startPoller(ctx)
		}
		if err := run.exec(ctx, step); err != nil {
			report.Error = err.Error()
			break
		}
	}
	cancelPoll()
	if poller != nil {
		report.Phases = poller.Timeline()
	}
}

func planFor(options Options, env map[string]string) ([]Step, error) {
	switch options.Path {
	case "compose":
		return ComposePlan(options.Config), writeFiles(filepath.Join(options.RunDir, "compose"), map[string]string{"compose.override.yml": ComposeOverride(), ".env": DotEnv(env)})
	case "helm":
		return HelmPlan(options.Config), writeFiles(filepath.Join(options.RunDir, "helm"), map[string]string{"values-production.yaml": HelmValues(env)})
	}
	return nil, fmt.Errorf("path %q: want compose or helm", options.Path)
}

// judge reads the upgraded ledger and licenses through the path's published Postgres port, then every E and U row.
func (run *runner) judge(ctx context.Context, report *cell.Report, licensed bool) {
	judged := cell.SelfHostedRun{Path: run.options.Path, Licensed: licensed, Transcript: run.transcript, Phases: report.Phases, Shots: run.shots, LicenseLost: -1}
	database, schema := "postgresql://prisma:prisma@127.0.0.1:15432/"+composeDB, "mydb"
	if run.options.Path == "helm" {
		database, schema = "postgresql://postgres:upgradelab@127.0.0.1:15433/"+helmDB, "public"
	}
	var err error
	if judged.Ledger, err = cell.LedgerAt(ctx, database, schema); err != nil {
		report.Notes = append(report.Notes, "ledger: "+err.Error())
	}
	if lost, err := cell.LicensesLost(ctx, database, schema); err == nil {
		judged.LicenseLost = lost
	}
	report.Verdicts = cell.JudgeSelfHosted(judged)
}

func (run *runner) dryRun(report *cell.Report, steps []Step) error {
	for _, step := range steps {
		run.transcript = append(run.transcript, cell.TranscriptStep{Phase: step.Phase, Doc: step.Doc, Command: strings.Join(step.Argv, " "), Deviation: step.Deviation, Exit: -1})
	}
	return run.write(report)
}

func writeFiles(dir string, files map[string]string) error {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return err
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			return err
		}
	}
	return nil
}

// exec runs one step and records it; a step with no command (the guide's line we cannot run) is recorded only.
func (run *runner) exec(ctx context.Context, step Step) error {
	record := cell.TranscriptStep{Phase: step.Phase, Doc: step.Doc, Command: strings.Join(step.Argv, " "), Deviation: step.Deviation}
	started := time.Now()
	defer func() {
		record.Ms = time.Since(started).Milliseconds()
		run.transcript = append(run.transcript, record)
	}()
	if len(step.Argv) == 0 {
		return nil
	}
	command := exec.CommandContext(ctx, step.Argv[0], step.Argv[1:]...) // #nosec G204 -- the harness's own plan.
	command.Dir = step.Dir
	if step.Background {
		command.Stdout, command.Stderr = nil, nil
		run.background = append(run.background, command)
		err := command.Start()
		time.Sleep(3 * time.Second) // a port-forward listens within a second or two
		return err
	}
	out, err := command.CombinedOutput()
	record.Output = lastLines(string(out), 20)
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		record.Exit = exit.ExitCode()
	} else if err != nil {
		record.Exit = -1
	}
	if err != nil {
		return fmt.Errorf("%s step %q: %w", step.Phase, record.Command, err)
	}
	return nil
}

func (run *runner) stopBackground() {
	for _, command := range run.background {
		if command.Process != nil {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
	}
}

// startPoller records the api's phases from the guide's first upgrade command on, shoots each new
// one, and runs the cell's browser walk for console errors and failed requests.
func (run *runner) startPoller(ctx context.Context) (*cell.Poller, func()) {
	pollCtx, cancel := context.WithCancel(ctx)
	poller := &cell.Poller{URL: Origin(run.options.Path), Origin: run.origin, Every: 500 * time.Millisecond, Notify: make(chan string, 8),
		PhaseFile: filepath.Join(run.options.RunDir, "phase.txt")}
	go poller.Run(pollCtx)
	email, password := generate.SeedAccount(run.options.Seed)
	walker, err := cell.StartWalker(pollCtx, cell.WalkSpec{Dir: filepath.Join(run.options.UIDir, "apps", "ui"), RunDir: run.options.RunDir,
		URL: Origin(run.options.Path), Email: email, Password: password, Origin: run.origin, Every: 10 * time.Second})
	done := make(chan struct{})
	go run.shootPhases(pollCtx, poller.Notify, done)
	return poller, func() {
		if err == nil {
			walker.Stop(time.Minute)
		}
		cancel()
		<-done
	}
}

func (run *runner) shootPhases(ctx context.Context, phases <-chan string, done chan<- struct{}) {
	defer close(done)
	for {
		select {
		case <-ctx.Done():
			return
		case phase := <-phases:
			if phase != "down" {
				run.shoot(ctx, phase, phase == "ready")
			}
		}
	}
}

// shoot runs pages.mjs for one phase: the holding page (the token console on a fresh install), sign-in,
// and once signed in Ops > Upgrades, a trace list and settings, each into shots/<phase>-<page>.png.
func (run *runner) shoot(ctx context.Context, phase string, signIn bool) {
	email, password := generate.SeedAccount(run.options.Seed)
	name := strings.NewReplacer(":", "-", "/", "-").Replace(phase)
	script := filepath.Join(run.options.RunDir, "pages.mjs")
	args, _ := json.Marshal(map[string]any{"url": Origin(run.options.Path), "email": email, "password": password,
		"shots": filepath.Join(run.options.RunDir, "shots"), "phase": name, "signIn": signIn})
	shotCtx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	var pages []struct{ Page, File, URL, State, Error string }
	err := os.WriteFile(script, pagesScript, 0o600)
	if err == nil {
		command := exec.CommandContext(shotCtx, "node", script, string(args)) // #nosec G204 -- harness-written script.
		command.Dir = filepath.Join(run.options.UIDir, "apps", "ui")
		var out []byte
		if out, err = command.Output(); err == nil {
			err = json.Unmarshal(out, &pages)
		}
	}
	at := time.Since(run.origin).Milliseconds()
	if err != nil {
		run.shots = append(run.shots, cell.Shot{Phase: phase, AtMs: at, Error: err.Error()})
	}
	for _, page := range pages {
		run.shots = append(run.shots, cell.Shot{Phase: phase, AtMs: at, File: filepath.Join("shots", page.File), URL: page.URL, State: page.State, Error: page.Error})
	}
}

func (run *runner) write(report *cell.Report) error {
	var text strings.Builder
	text.WriteString("# Operator transcript\n\n| Phase | Guide line | Command | Deviation | Exit | Ms |\n| --- | --- | --- | --- | --- | --- |\n")
	for _, step := range run.transcript {
		fmt.Fprintf(&text, "| %s | %s | `%s` | %s | %d | %d |\n", step.Phase, step.Doc, strings.ReplaceAll(step.Command, "|", "/"), step.Deviation, step.Exit, step.Ms)
	}
	data, _ := json.MarshalIndent(map[string]any{"report": report, "transcript": run.transcript}, "", "  ")
	for name, content := range map[string]string{"transcript.md": text.String(), "report.md": report.Markdown(), "report.json": string(data)} {
		if err := os.WriteFile(filepath.Join(run.options.RunDir, name), []byte(content), 0o600); err != nil {
			return err
		}
	}
	return nil
}

func lastLines(text string, count int) string {
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	return strings.Join(lines[max(0, len(lines)-count):], "\n")
}
