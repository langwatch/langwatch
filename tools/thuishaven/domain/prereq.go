package domain

import (
	"fmt"
	"sort"
	"strings"
)

// A prerequisite is a tool haven drives but does not own: portless, the Node
// toolchain, the brew formulae behind the managed Postgres and Redis, a
// container runtime. `haven up` discovers a missing one the hard way — as a
// failure, one at a time, at the moment it first needs it. This file is the
// catalogue so `haven install` can ask all of those questions at once, before
// anything is running.
//
// Everything here is pure: what the prerequisites are, how to tell whether one
// is satisfied, and what order to install them in. Probing the machine and
// running installers is the app layer's job (app/install.go), and the picker
// is an adapter — so the catalogue can be reasoned about, and tested, with no
// machine attached.

// Requirement is how much haven needs a prerequisite. It decides what a
// non-interactive run does: a silent `--yes` installs what haven cannot work
// (or works badly) without, and leaves conveniences alone unless named.
type Requirement int

const (
	// PrereqRequired: haven cannot bring a stack up without it.
	PrereqRequired Requirement = iota
	// PrereqRecommended: haven runs, but a documented part of it does not —
	// the Go lanes, the managed Postgres, the managed Redis.
	PrereqRecommended
	// PrereqOptional: a convenience for the developer, never for haven.
	PrereqOptional
)

func (r Requirement) String() string {
	switch r {
	case PrereqRequired:
		return "required"
	case PrereqRecommended:
		return "recommended"
	default:
		return "optional"
	}
}

// Candidate is one way to satisfy a prerequisite. Most have exactly one; the
// container runtime has two, and either one satisfies it — which is why
// satisfaction is a property of the prerequisite and not of a single binary.
type Candidate struct {
	// Key identifies this candidate to the probe. Unique across the catalogue.
	Key string
	// Label is what the picker shows when there is a choice to make.
	Label string
	// Binaries must ALL resolve on PATH for this candidate to count as present.
	// The colima runtime needs colima AND docker; one without the other is not
	// a runtime haven can drive.
	Binaries []string
	// Formula is a brew formula name, matched by prefix so an installed
	// postgresql@15 counts exactly as postgresql@16 does — haven adopts
	// whichever version is already there rather than forcing its own (see
	// adapters/postgresbrew).
	Formula string
	// Install is the shell command that installs this candidate. Empty means
	// haven will not install it: see Manual.
	Install string
	// Manual is what to tell the developer when Install is empty. Homebrew is
	// the case that matters — its installer asks for sudo and rewrites
	// directory ownership, which is not a decision a dev tool makes on someone
	// else's behalf from inside a picker.
	Manual string
}

// Prereq is one entry of the catalogue.
type Prereq struct {
	Key         string
	Name        string
	Summary     string // one line, shown in the list
	Detail      string // the paragraph shown before choosing
	Requirement Requirement
	// Candidates: satisfied when ANY of them is present.
	Candidates []Candidate
	// After names prerequisites that must be installed first. Homebrew installs
	// the brew formulae; node provides the npm that installs portless.
	After []string
	// DarwinOnly marks the ones that only mean something on macOS — haven
	// manages Postgres and Redis through `brew services`, which is a macOS
	// story. Elsewhere they are reported not-applicable rather than missing,
	// because "missing" implies haven could fix it.
	DarwinOnly bool
}

// Manual reports whether no candidate can be installed by haven, so the only
// honest thing to do is print the command and let the developer run it.
func (p Prereq) Manual() bool {
	for _, c := range p.Candidates {
		if c.Install != "" {
			return false
		}
	}
	return true
}

// Prereqs is the catalogue, in install order: every entry's After names only
// entries above it. That order is load-bearing — TestCatalogueOrderRespectsAfter
// pins it — because OrderPrereqs sorts by it rather than re-deriving a
// topological sort at runtime.
var Prereqs = []Prereq{{
	Key:         "brew",
	Name:        "Homebrew",
	Summary:     "the package manager haven installs and runs everything else through",
	Requirement: PrereqRequired,
	DarwinOnly:  true,
	Detail: "haven starts the shared Postgres and Redis with `brew services`, and\n" +
		"    every formula below is a `brew install`. Homebrew's own installer asks\n" +
		"    for your password and changes directory ownership, so haven will not run\n" +
		"    it for you — it prints the one command and gets out of the way.",
	Candidates: []Candidate{{
		Key:      "brew",
		Label:    "Homebrew",
		Binaries: []string{"brew"},
		Manual:   `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`,
	}},
}, {
	Key:         "node",
	Name:        "Node.js",
	Summary:     "the runtime every application lane and the portless proxy run on",
	Requirement: PrereqRequired,
	After:       []string{"brew"},
	Detail: "The ui, api and worker lanes are Node processes, and portless is\n" +
		"    installed as a global npm package — so nothing haven supervises starts\n" +
		"    without it.",
	Candidates: []Candidate{{
		Key:      "node",
		Label:    "node",
		Binaries: []string{"node", "npm"},
		Install:  "brew install node",
	}},
}, {
	Key:         "pnpm",
	Name:        "pnpm",
	Summary:     "the workspace's package manager — one install root, one lockfile",
	Requirement: PrereqRequired,
	After:       []string{"brew"},
	Detail: "Every lane haven starts is `pnpm --filter <package> dev`, and the\n" +
		"    automatic dependency install `up` runs is `pnpm install`. npm and yarn\n" +
		"    are not substitutes here: the repo is a single pnpm workspace (ADR-076).",
	Candidates: []Candidate{{
		Key:      "pnpm",
		Label:    "pnpm",
		Binaries: []string{"pnpm"},
		Install:  "brew install pnpm",
	}},
}, {
	Key:         "go",
	Name:        "Go toolchain",
	Summary:     "builds haven itself and runs the aigateway and nlpgo lanes",
	Requirement: PrereqRecommended,
	After:       []string{"brew"},
	Detail: "Without it the stack still comes up, minus the Go lane: no AI gateway\n" +
		"    and no NLP engine, which looks like a healthy stack right up until\n" +
		"    something calls one of them. It is also what builds haven itself.",
	Candidates: []Candidate{{
		Key:      "go",
		Label:    "go",
		Binaries: []string{"go"},
		Install:  "brew install go",
	}},
}, {
	Key:         "portless",
	Name:        "portless",
	Summary:     "the TLS and hostname proxy every worktree's services are routed through",
	Requirement: PrereqRequired,
	After:       []string{"node"},
	Detail: "haven pins one release and installs it globally through npm. `haven up`\n" +
		"    installs it too, on the first run of a fresh machine — doing it here just\n" +
		"    means the first `up` is not also a download.",
	Candidates: []Candidate{{
		Key:     "portless",
		Label:   "portless",
		Install: "npm install -g " + PortlessPackage(),
	}},
}, {
	Key:         "postgres",
	Name:        "PostgreSQL",
	Summary:     "the shared server haven gives every worktree a database on",
	Requirement: PrereqRecommended,
	After:       []string{"brew"},
	DarwinOnly:  true,
	Detail: "One brew-managed server, one database per worktree slug. haven adopts\n" +
		"    whichever postgresql@NN is already installed rather than forcing its own,\n" +
		"    so this is only offered when there is none at all.",
	Candidates: []Candidate{{
		Key:      "postgres",
		Label:    DefaultPostgresFormula,
		Binaries: []string{"psql"},
		Formula:  "postgresql@",
		Install:  "brew install " + DefaultPostgresFormula,
	}},
}, {
	Key:         "redis",
	Name:        "Redis",
	Summary:     "the shared queue and cache server, partitioned per worktree by database index",
	Requirement: PrereqRecommended,
	After:       []string{"brew"},
	DarwinOnly:  true,
	Detail: "One brew-managed server for the machine; worktrees never collide\n" +
		"    because each gets its own database index. Without it the worker has no\n" +
		"    queues, which reads as a stack that serves pages and runs no jobs.",
	Candidates: []Candidate{{
		Key:      "redis",
		Label:    DefaultRedisFormula,
		Binaries: []string{"redis-server"},
		Formula:  DefaultRedisFormula,
		Install:  "brew install " + DefaultRedisFormula,
	}},
}, {
	Key:         "runtime",
	Name:        "Container runtime",
	Summary:     "runs the observability stack and the sandboxed langy tiers — pick one",
	Requirement: PrereqOptional,
	After:       []string{"brew"},
	DarwinOnly:  true,
	Detail: "Nothing in the day-to-day loop needs one: with LANGWATCH_HAVEN_CH=0 and\n" +
		"    LANGWATCH_HAVEN_OBS=0 the whole application stack runs with no runtime\n" +
		"    installed at all. It buys you the Grafana LGTM stack, the managed\n" +
		"    ClickHouse container, and langy's sandboxed worker tier.\n" +
		"    haven's own stack is built on colima: the VM's ceiling is explicit and\n" +
		"    per-profile, and it needs no license. Docker Desktop works too.",
	Candidates: []Candidate{{
		Key:      "colima",
		Label:    "colima + docker CLI",
		Binaries: []string{"colima", "docker"},
		Install:  "brew install colima docker",
	}, {
		Key:      "docker-desktop",
		Label:    "Docker Desktop",
		Binaries: []string{"docker"},
		Install:  "brew install --cask docker",
	}},
}, {
	Key:         "clickhouse-client",
	Name:        "ClickHouse client",
	Summary:     "query this stack's ClickHouse from a shell (`haven db url clickhouse`)",
	Requirement: PrereqOptional,
	After:       []string{"brew"},
	DarwinOnly:  true,
	Detail: "Purely for you: haven runs the ClickHouse SERVER itself and needs no\n" +
		"    client to do it. Install this when you want a SQL prompt against the URL\n" +
		"    `haven db url clickhouse` prints.",
	Candidates: []Candidate{{
		Key:      "clickhouse-client",
		Label:    "clickhouse",
		Binaries: []string{"clickhouse"},
		Formula:  "clickhouse",
		Install:  "brew install clickhouse",
	}},
}}

// PrereqState is what a probe found.
type PrereqState int

const (
	// PrereqSatisfied: at least one candidate is present and current.
	PrereqSatisfied PrereqState = iota
	// PrereqMissing: no candidate is present.
	PrereqMissing
	// PrereqOutdated: present, but not the version haven pins. Only portless
	// has a pinned version today, and installing it is an upgrade in place.
	PrereqOutdated
	// PrereqSkipped: missing, and the developer said never ask again.
	PrereqSkipped
	// PrereqNotApplicable: a macOS-only entry on another platform. Reported
	// rather than hidden, so the list reads the same everywhere.
	PrereqNotApplicable
)

func (s PrereqState) String() string {
	switch s {
	case PrereqSatisfied:
		return "installed"
	case PrereqOutdated:
		return "outdated"
	case PrereqSkipped:
		return "skipped"
	case PrereqNotApplicable:
		return "n/a"
	default:
		return "missing"
	}
}

// Actionable reports whether this state is one `haven install` can do
// something about — which is the same question as "should the picker offer
// it". A skipped entry is deliberately not actionable: that is what the
// developer asked for, and naming it explicitly is how they take it back.
func (s PrereqState) Actionable() bool { return s == PrereqMissing || s == PrereqOutdated }

// Found is one candidate's probe result, as the app layer measured it.
type Found struct {
	Present bool
	// Detail is what was found, for the report: a version, a path, a formula.
	Detail string
	// Outdated marks a candidate that is present but not the pinned version.
	Outdated bool
}

// PrereqStatus is one catalogue entry with the machine's answer attached.
type PrereqStatus struct {
	Prereq
	State PrereqState
	// Via is the candidate that satisfied it, or the one that would be
	// installed when there is only one way to satisfy it. Empty when there is
	// a real choice still to make.
	Via string
	// Observed is what the probe found — a version, a formula name, the
	// binaries that resolved. Deliberately NOT called Detail: PrereqStatus
	// embeds Prereq, which has a Detail of its own (the paragraph a human
	// reads), and a second field of that name silently shadows it.
	Observed string
}

// Chosen is the candidate to install for an entry the developer picked. It is
// the pair and not just the key, because the container runtime's two
// candidates are a real choice and the answer has to travel with it.
type Chosen struct {
	Key       string // prerequisite key
	Candidate string // candidate key
}

// PlanPrereqs turns probe results into the report. found is keyed by CANDIDATE
// key (so the two container runtimes answer separately), skipped by
// PREREQUISITE key, and goos is the platform, so the macOS-only entries are
// not reported missing on a Linux machine that cannot install them anyway.
func PlanPrereqs(found map[string]Found, skipped map[string]bool, goos string) []PrereqStatus {
	out := make([]PrereqStatus, 0, len(Prereqs))
	for _, p := range Prereqs {
		out = append(out, planOne(p, found, skipped, goos))
	}
	return out
}

func planOne(p Prereq, found map[string]Found, skipped map[string]bool, goos string) PrereqStatus {
	st := PrereqStatus{Prereq: p, State: PrereqMissing}
	if p.DarwinOnly && goos != "darwin" {
		st.State = PrereqNotApplicable
		st.Observed = "macOS only"
		return st
	}
	// A present-but-outdated candidate loses to a present-and-current one, so
	// a machine carrying both is satisfied rather than nagged.
	outdated := -1
	for i, c := range p.Candidates {
		f := found[c.Key]
		switch {
		case f.Present && !f.Outdated:
			st.State, st.Via, st.Observed = PrereqSatisfied, c.Key, f.Detail
			return st
		case f.Present:
			outdated, st.Observed = i, f.Detail
		}
	}
	if outdated >= 0 {
		st.State, st.Via = PrereqOutdated, p.Candidates[outdated].Key
		return st
	}
	// "Never ask again" is not offered for a required prerequisite, and is not
	// honoured if one turns up in the file anyway: a skipped entry drops out
	// of MissingRequired, so honouring it would report a machine that cannot
	// run haven as ready.
	if skipped[p.Key] && p.Requirement != PrereqRequired {
		st.State = PrereqSkipped
	}
	// With one way to satisfy it there is no choice to record; with two, Via
	// stays empty and the picker is what asks.
	if len(p.Candidates) == 1 {
		st.Via = p.Candidates[0].Key
	}
	return st
}

// OrderPrereqs sorts chosen entries into catalogue order, which is install
// order: brew before the formulae it installs, node before the npm globals.
// Unknown keys are dropped rather than guessed at — a caller naming something
// outside the catalogue has already been told so by LookupPrereq.
func OrderPrereqs(chosen []Chosen) []Chosen {
	index := map[string]int{}
	for i, p := range Prereqs {
		index[p.Key] = i
	}
	kept := make([]Chosen, 0, len(chosen))
	for _, c := range chosen {
		if _, ok := index[c.Key]; ok {
			kept = append(kept, c)
		}
	}
	sort.SliceStable(kept, func(i, j int) bool { return index[kept[i].Key] < index[kept[j].Key] })
	return kept
}

// LookupPrereq finds a catalogue entry by key, for the positional form
// (`haven install clickhouse-client`).
func LookupPrereq(key string) (Prereq, bool) {
	for _, p := range Prereqs {
		if p.Key == key {
			return p, true
		}
	}
	return Prereq{}, false
}

// LookupCandidate finds one candidate of one prerequisite.
func LookupCandidate(p Prereq, key string) (Candidate, bool) {
	for _, c := range p.Candidates {
		if c.Key == key {
			return c, true
		}
	}
	return Candidate{}, false
}

// PrereqKeys lists every catalogue key, for the "unknown prerequisite" pointer.
func PrereqKeys() []string {
	keys := make([]string, 0, len(Prereqs))
	for _, p := range Prereqs {
		keys = append(keys, p.Key)
	}
	return keys
}

// DefaultChoice is the candidate a non-interactive run installs for an entry
// with more than one: the first, which the catalogue orders as haven's own
// recommendation. A picker always asks instead of taking it.
func DefaultChoice(p Prereq) string {
	if len(p.Candidates) == 0 {
		return ""
	}
	return p.Candidates[0].Key
}

// MissingRequired names the required entries a report says are not there, so
// a caller can give the verdict in one line.
func MissingRequired(report []PrereqStatus) []string {
	var out []string
	for _, s := range report {
		if s.Requirement == PrereqRequired && s.State.Actionable() {
			out = append(out, s.Name)
		}
	}
	return out
}

// ReadyLine is the one-line verdict the report ends with.
func ReadyLine(report []PrereqStatus) string {
	if missing := MissingRequired(report); len(missing) > 0 {
		return fmt.Sprintf("not ready — missing %s", strings.Join(missing, ", "))
	}
	return "ready — every required prerequisite is installed"
}
