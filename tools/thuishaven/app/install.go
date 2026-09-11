package app

import (
	"context"
	"fmt"
	"io"
	"os"
	"runtime"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// `haven install` is the machine check: what haven drives but does not own —
// portless, the Node toolchain, the brew formulae behind the managed Postgres
// and Redis, a container runtime — probed all at once, before anything is
// running. Until this existed every one of those was discovered as a failed
// `up`, one at a time, each with its own error message to interpret.
//
// The catalogue and the planning are domain/prereq.go. This file is the part
// that touches the machine: probing it, installing in dependency order, and
// remembering what the developer never wants asked again.

// PrereqTools is how the app layer looks at, and changes, the machine. Kept
// behind a port so the ordering, the refusals and the skip bookkeeping are
// testable with nothing installed and nothing installable.
type PrereqTools interface {
	// BinaryPath resolves a command on PATH; "" when it is not there.
	BinaryPath(name string) string
	// FormulaInstalled reports whether an installed brew formula starts with
	// prefix, and which one matched. Prefix, not equality, because haven
	// adopts whichever postgresql@NN is already on the machine.
	FormulaInstalled(ctx context.Context, prefix string) (string, bool)
	// Install runs an installer with the developer's own terminal attached —
	// `brew install --cask` asks for a password, and a picker that swallowed
	// the prompt would look like a hang.
	Install(ctx context.Context, command string) error
}

// CheckPrereqs probes the machine and returns the full report, in catalogue
// order. Every entry is reported, including the satisfied and the
// not-applicable ones: the value of this command is that the list is always
// the same list, so "it isn't mentioned" never has to mean anything.
func (o *Orchestrator) CheckPrereqs(ctx context.Context) []domain.PrereqStatus {
	found := map[string]domain.Found{}
	for _, p := range domain.Prereqs {
		if p.DarwinOnly && runtime.GOOS != "darwin" {
			// Nothing to probe for: PlanPrereqs reports these not-applicable,
			// and a `brew list` on a machine with no brew is a slow no.
			continue
		}
		for _, c := range p.Candidates {
			found[c.Key] = o.probeCandidate(ctx, c)
		}
	}
	return domain.PlanPrereqs(found, o.PrereqSkips(), runtime.GOOS)
}

// probeCandidate answers one candidate. portless is the one entry with no
// binary of its own to look for: haven resolves it through the proxy adapter
// (a global install, a project-local one, or PORTLESS_BIN) and pins a
// version, so the proxy port is the only thing that can answer honestly
// whether the machine has the portless haven will actually run.
func (o *Orchestrator) probeCandidate(ctx context.Context, c domain.Candidate) domain.Found {
	if c.Key == "portless" {
		return o.probePortless()
	}
	if c.FormulaIsAuthority {
		// haven starts this one with `brew services`, so brew's answer is the
		// only one that predicts whether it can. A binary on PATH from
		// somewhere else would report installed and leave `haven up` to fail
		// with "not installed" — the report contradicting the thing it is
		// supposed to be checking.
		return o.probeFormula(ctx, c)
	}
	var detail []string
	for _, bin := range c.Binaries {
		path := o.prereqTools().BinaryPath(bin)
		if path == "" {
			// ALL of a candidate's binaries have to be there. colima without
			// docker is not a runtime haven can drive, and reporting it as one
			// would move the failure to the first image build.
			return o.probeFormula(ctx, c)
		}
		detail = append(detail, bin)
	}
	if len(c.Binaries) > 0 {
		return domain.Found{Present: true, Detail: strings.Join(detail, " + ")}
	}
	return o.probeFormula(ctx, c)
}

// probeFormula is the fallback for a tool that is installed but whose binary
// is not linked onto PATH — brew keeps postgresql@NN keg-only, so `psql` is
// often absent on a machine that has a perfectly good server installed.
func (o *Orchestrator) probeFormula(ctx context.Context, c domain.Candidate) domain.Found {
	if c.Formula == "" {
		return domain.Found{}
	}
	name, ok := o.prereqTools().FormulaInstalled(ctx, c.Formula)
	return domain.Found{Present: ok, Detail: name}
}

// probePortless folds the proxy's two questions — is one resolvable, and is
// it the pinned one — into the catalogue's present/outdated pair.
func (o *Orchestrator) probePortless() domain.Found {
	if o.proxy == nil || !o.proxy.Installed() {
		return domain.Found{}
	}
	version := o.proxy.Version()
	switch domain.PlanPortless(true, version) {
	case domain.PortlessUpgrade:
		return domain.Found{Present: true, Outdated: true, Detail: version}
	case domain.PortlessUnknownVersion:
		// Installed, will not say what it is. haven's own `up` leaves this
		// alone rather than reinstalling on every launch, and so does this:
		// reporting it outdated would offer an install that never settles.
		return domain.Found{Present: true, Detail: "installed, version unknown"}
	default:
		return domain.Found{Present: true, Detail: version}
	}
}

// InstallPrereqs installs the chosen prerequisites in dependency order,
// narrating each one. It stops at the first failure: the entries depend on
// each other (brew installs the formulae, node provides the npm), so
// continuing past a failure produces a second, more confusing error about a
// cause that is already known.
//
// A manual entry prints its command rather than running it. If it is also
// REQUIRED and anything is ordered after it, the run ends there: the rest are
// installed through it, so attempting them would fail on a cause already on
// screen and blame the wrong tool for it.
func (o *Orchestrator) InstallPrereqs(ctx context.Context, chosen []domain.Chosen) error {
	return o.installPrereqsTo(ctx, os.Stdout, chosen)
}

func (o *Orchestrator) installPrereqsTo(ctx context.Context, w io.Writer, chosen []domain.Chosen) error {
	ordered := domain.OrderPrereqs(chosen)
	if len(ordered) == 0 {
		fmt.Fprintln(w, "nothing selected; nothing installed.")
		return nil
	}
	for i, pick := range ordered {
		p, ok := domain.LookupPrereq(pick.Key)
		if !ok {
			return fmt.Errorf("unknown prerequisite %q — known: %s", pick.Key, strings.Join(domain.PrereqKeys(), ", "))
		}
		candidate, ok := domain.LookupCandidate(p, pick.Candidate)
		if !ok {
			return fmt.Errorf("%s has no option %q", p.Key, pick.Candidate)
		}
		// A declining candidate is an answer, not an install: "none, keep this
		// machine container-free" settles the question rather than putting
		// something on the machine.
		if candidate.Declines {
			if err := o.recordChoice(w, p, candidate); err != nil {
				return err
			}
			continue
		}
		command, manual := candidate.InstallOn(runtime.GOOS)
		if command == "" {
			fmt.Fprintf(w, "\n· %s — haven does not install this one for you. Run:\n    %s\n", p.Name, manual)
			// Carrying on past a REQUIRED one haven cannot install is how the
			// fresh-Mac case produced its worst message: print the Homebrew
			// line, then run `brew install node`, then report "could not
			// install Node.js (exit status 127) — run `brew install node` by
			// hand", which blames the wrong tool. Everything ordered after it
			// is installed THROUGH it, so this is where the run ends.
			if p.Requirement == domain.PrereqRequired && i < len(ordered)-1 {
				return fmt.Errorf("%s has to be installed first — the rest are installed through it. Run the command above, then re-run `haven install`", p.Name)
			}
			continue
		}
		fmt.Fprintf(w, "\n→ %s: %s\n", p.Name, command)
		if err := o.runPrereqInstall(ctx, p, command); err != nil {
			return fmt.Errorf("could not install %s (%w) — run `%s` by hand and try again", p.Name, err, command)
		}
		fmt.Fprintf(w, "✓ %s installed\n", p.Name)
		if candidate.Records != "" {
			// Installing a runtime is also choosing it. Without this the
			// developer would pick colima at the picker and haven would still
			// be guessing the posture on the next run.
			if err := o.recordChoice(w, p, candidate); err != nil {
				return err
			}
		}
		// Installing something answers the question the skip was suppressing,
		// so the skip has served its purpose and would otherwise hide the
		// entry from a later report that should show it satisfied.
		if err := o.unskipPrereq(p.Key); err != nil {
			return err
		}
	}
	return nil
}

// recordChoice writes down the machine setting a candidate stands for, and
// settles the prerequisite it answers so the question stops being asked.
func (o *Orchestrator) recordChoice(w io.Writer, p domain.Prereq, c domain.Candidate) error {
	if c.Records == "" {
		return nil
	}
	changed, err := o.RecordContainerPosture(c.Records)
	if err != nil {
		return err
	}
	if changed {
		fmt.Fprintf(w, "\n· %s: %s — recorded for this machine\n", p.Name, c.Label)
	}
	if !c.Declines {
		return nil
	}
	// Declining is a settled answer, so the entry should not come back as
	// missing on the next run. The skip is the existing machinery for that.
	if _, err := o.SkipPrereqs([]string{p.Key}); err != nil {
		return err
	}
	fmt.Fprintf(w, "  %s\n", domain.PostureLine(domain.PostureNone, domain.PostureRecorded))
	return nil
}

// runPrereqInstall routes portless through the proxy adapter, which owns the
// pinned package name and the "install it by hand like this" error, and
// everything else through the shell command the catalogue declares.
func (o *Orchestrator) runPrereqInstall(ctx context.Context, p domain.Prereq, command string) error {
	if p.Key == "portless" {
		if o.proxy == nil {
			return fmt.Errorf("no portless adapter is wired in")
		}
		return o.proxy.Install()
	}
	return o.prereqTools().Install(ctx, command)
}

// PrereqSkips is the machine-wide "never ask me about this again" set. It is
// machine-wide and not per-worktree deliberately: the prerequisites are
// properties of the machine, and a developer who declined the ClickHouse
// client once should not be asked again by the next checkout.
func (o *Orchestrator) PrereqSkips() map[string]bool {
	if o.store == nil {
		return map[string]bool{}
	}
	skips := o.store.ReadPrereqSkips()
	if skips == nil {
		return map[string]bool{}
	}
	return skips
}

// SkipPrereqs records "never ask again" for each named prerequisite and
// reports which ones actually changed, so a repeat reads as a no-op.
//
// A required prerequisite cannot be skipped: haven does not work without it,
// so the only thing suppressing the question would achieve is a later failure
// with no explanation attached.
func (o *Orchestrator) SkipPrereqs(keys []string) ([]string, error) {
	if o.store == nil {
		return nil, fmt.Errorf("no store is wired in")
	}
	skips := o.PrereqSkips()
	var changed []string
	for _, key := range keys {
		p, ok := domain.LookupPrereq(key)
		if !ok {
			return nil, fmt.Errorf("unknown prerequisite %q — known: %s", key, strings.Join(domain.PrereqKeys(), ", "))
		}
		if p.Requirement == domain.PrereqRequired {
			return nil, fmt.Errorf("%s is required — haven cannot bring a stack up without it, so it is not one you can silence", p.Name)
		}
		if !skips[key] {
			skips[key] = true
			changed = append(changed, key)
		}
	}
	if len(changed) == 0 {
		return nil, nil
	}
	return changed, o.store.WritePrereqSkips(skips)
}

// ResetPrereqSkips clears the whole set, so the next run offers everything
// again. It returns what was cleared, because "nothing was skipped" and "two
// things were" deserve different words.
func (o *Orchestrator) ResetPrereqSkips() ([]string, error) {
	if o.store == nil {
		return nil, fmt.Errorf("no store is wired in")
	}
	skips := o.PrereqSkips()
	cleared := make([]string, 0, len(skips))
	for key := range skips {
		cleared = append(cleared, key)
	}
	sort.Strings(cleared)
	if len(cleared) == 0 {
		return nil, nil
	}
	return cleared, o.store.WritePrereqSkips(map[string]bool{})
}

func (o *Orchestrator) unskipPrereq(key string) error {
	skips := o.PrereqSkips()
	if !skips[key] {
		return nil
	}
	delete(skips, key)
	return o.store.WritePrereqSkips(skips)
}

// ResolvePrereqNames turns the positional form (`haven install clickhouse-client
// runtime=colima`) into choices. An unknown name fails with the list rather
// than being ignored, and an entry with two candidates takes the first unless
// one is named after an `=`.
func ResolvePrereqNames(names []string) ([]domain.Chosen, error) {
	chosen := make([]domain.Chosen, 0, len(names))
	for _, raw := range names {
		key, option, hasOption := strings.Cut(raw, "=")
		p, ok := domain.LookupPrereq(key)
		if !ok {
			return nil, fmt.Errorf("unknown prerequisite %q — known: %s", key, strings.Join(domain.PrereqKeys(), ", "))
		}
		if !hasOption {
			chosen = append(chosen, domain.Chosen{Key: p.Key, Candidate: domain.DefaultChoice(p)})
			continue
		}
		if _, ok := domain.LookupCandidate(p, option); !ok {
			return nil, fmt.Errorf("%s has no option %q — options: %s", p.Key, option, strings.Join(candidateKeys(p), ", "))
		}
		chosen = append(chosen, domain.Chosen{Key: p.Key, Candidate: option})
	}
	return chosen, nil
}

func candidateKeys(p domain.Prereq) []string {
	out := make([]string, 0, len(p.Candidates))
	for _, c := range p.Candidates {
		out = append(out, c.Key)
	}
	return out
}

// AutoPrereqs is what a non-interactive `--yes` installs: everything actionable
// that haven itself needs — required and recommended — and nothing merely
// convenient. An optional prerequisite is installed when it is named, never
// because nobody was there to say no.
func AutoPrereqs(report []domain.PrereqStatus) []domain.Chosen {
	var chosen []domain.Chosen
	for _, st := range report {
		if !st.State.Actionable() || st.Requirement == domain.PrereqOptional {
			continue
		}
		candidate := st.Via
		if candidate == "" {
			candidate = domain.DefaultChoice(st.Prereq)
		}
		chosen = append(chosen, domain.Chosen{Key: st.Key, Candidate: candidate})
	}
	return chosen
}

// prereqTools returns the wired adapter, or a null one that finds nothing and
// refuses to install — so a graph built without it (every test that never
// touches the machine) reports honestly instead of panicking.
func (o *Orchestrator) prereqTools() PrereqTools {
	if o.prereqs == nil {
		return nullPrereqTools{}
	}
	return o.prereqs
}

type nullPrereqTools struct{}

func (nullPrereqTools) BinaryPath(string) string { return "" }
func (nullPrereqTools) FormulaInstalled(context.Context, string) (string, bool) {
	return "", false
}
func (nullPrereqTools) Install(context.Context, string) error {
	return fmt.Errorf("no installer is wired in")
}
