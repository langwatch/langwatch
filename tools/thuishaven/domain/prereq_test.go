package domain

import (
	"strings"
	"testing"
)

// The catalogue's order IS the install order (OrderPrereqs sorts by it), so
// the one thing that would break silently is an entry whose After names
// something below it. Nothing else in the package would notice.
// @scenario "Homebrew installs before anything it installs"
func TestCatalogueOrderRespectsAfter(t *testing.T) {
	seen := map[string]bool{}
	for _, p := range Prereqs {
		for _, dep := range p.After {
			if _, known := LookupPrereq(dep); !known {
				t.Errorf("%s is After %q, which is not in the catalogue", p.Key, dep)
				continue
			}
			if !seen[dep] {
				t.Errorf("%s is After %s but comes before it — the catalogue order is the install order", p.Key, dep)
			}
		}
		seen[p.Key] = true
	}
}

// @scenario "Homebrew installs before anything it installs"
func TestOrderPrereqsPutsBrewFirst(t *testing.T) {
	ordered := OrderPrereqs([]Chosen{
		{Key: "redis", Candidate: "redis"},
		{Key: "postgres", Candidate: "postgres"},
		{Key: "brew", Candidate: "brew"},
	})
	if len(ordered) != 3 {
		t.Fatalf("expected all three back, got %v", ordered)
	}
	if ordered[0].Key != "brew" {
		t.Errorf("brew must install before the formulae it installs, got %v", keysOf(ordered))
	}
}

// @scenario "Node installs before the npm globals"
func TestOrderPrereqsPutsNodeBeforePortless(t *testing.T) {
	ordered := keysOf(OrderPrereqs([]Chosen{
		{Key: "portless", Candidate: "portless"},
		{Key: "node", Candidate: "node"},
	}))
	if ordered[0] != "node" {
		t.Errorf("portless is an npm global — node installs first, got %v", ordered)
	}
}

// @scenario "Homebrew installs before anything it installs"
func TestOrderPrereqsDropsUnknownKeys(t *testing.T) {
	ordered := OrderPrereqs([]Chosen{{Key: "not-a-prerequisite"}, {Key: "redis", Candidate: "redis"}})
	if len(ordered) != 1 || ordered[0].Key != "redis" {
		t.Errorf("an unknown key must be dropped, not ordered by guess: %v", keysOf(ordered))
	}
}

func keysOf(chosen []Chosen) []string {
	out := make([]string, 0, len(chosen))
	for _, c := range chosen {
		out = append(out, c.Key)
	}
	return out
}

// @scenario "A required prerequisite that is missing fails the check"
func TestPlanReportsMissingRequired(t *testing.T) {
	report := PlanPrereqs(map[string]Found{}, nil, "darwin")
	st := statusOf(t, report, "portless")
	if st.State != PrereqMissing {
		t.Errorf("portless state = %v, want missing", st.State)
	}
	if st.Requirement != PrereqRequired {
		t.Errorf("portless is required, got %v", st.Requirement)
	}
	if !strings.Contains(ReadyLine(report), "not ready") {
		t.Errorf("a missing required prerequisite must fail the verdict, got %q", ReadyLine(report))
	}
}

// @scenario "An optional prerequisite that is missing is reported, not demanded"
func TestPlanStaysReadyWhenOnlyOptionalIsMissing(t *testing.T) {
	report := PlanPrereqs(presentExcept("clickhouse-client"), nil, "darwin")
	st := statusOf(t, report, "clickhouse-client")
	if st.State != PrereqMissing {
		t.Errorf("the ClickHouse client state = %v, want missing", st.State)
	}
	if st.Requirement != PrereqOptional {
		t.Errorf("the ClickHouse client is optional, got %v", st.Requirement)
	}
	if strings.Contains(ReadyLine(report), "not ready") {
		t.Errorf("a missing optional prerequisite must not fail the verdict, got %q", ReadyLine(report))
	}
}

// @scenario "Everything present reports ready and installs nothing"
func TestPlanReportsReadyWhenEverythingIsPresent(t *testing.T) {
	report := PlanPrereqs(presentExcept(), nil, "darwin")
	for _, st := range report {
		if st.State != PrereqSatisfied {
			t.Errorf("%s = %v, want satisfied", st.Key, st.State)
		}
	}
	if strings.Contains(ReadyLine(report), "not ready") {
		t.Errorf("verdict = %q, want ready", ReadyLine(report))
	}
}

// @scenario "Either container runtime satisfies the group"
func TestEitherContainerRuntimeSatisfiesTheGroup(t *testing.T) {
	colima := PlanPrereqs(map[string]Found{"colima": {Present: true}}, nil, "darwin")
	if st := statusOf(t, colima, "runtime"); st.State != PrereqSatisfied || st.Via != "colima" {
		t.Errorf("colima must satisfy the runtime group, got %v via %q", st.State, st.Via)
	}
	desktop := PlanPrereqs(map[string]Found{"docker-desktop": {Present: true}}, nil, "darwin")
	if st := statusOf(t, desktop, "runtime"); st.State != PrereqSatisfied || st.Via != "docker-desktop" {
		t.Errorf("Docker Desktop must satisfy the runtime group, got %v via %q", st.State, st.Via)
	}
}

// @scenario "A missing runtime offers the alternatives as one pick"
func TestMissingRuntimeIsOneEntryCarryingBothCandidates(t *testing.T) {
	report := PlanPrereqs(map[string]Found{}, nil, "darwin")
	st := statusOf(t, report, "runtime")
	if st.State != PrereqMissing {
		t.Fatalf("runtime state = %v, want missing", st.State)
	}
	if len(st.Candidates) != 2 {
		t.Fatalf("the runtime must be offered as one entry with both candidates, got %d", len(st.Candidates))
	}
	if st.Via != "" {
		t.Errorf("a real choice must leave Via empty so the picker asks, got %q", st.Via)
	}
	if count := countKeys(report, "runtime"); count != 1 {
		t.Errorf("the runtime appears %d times in the report, want exactly one entry", count)
	}
}

// @scenario "A required prerequisite that is missing fails the check"
func TestOutdatedIsOfferedAndDoesNotCountAsSatisfied(t *testing.T) {
	report := PlanPrereqs(map[string]Found{"portless": {Present: true, Outdated: true, Detail: "0.0.1"}}, nil, "darwin")
	st := statusOf(t, report, "portless")
	if st.State != PrereqOutdated {
		t.Errorf("portless state = %v, want outdated", st.State)
	}
	if !st.State.Actionable() {
		t.Error("an outdated prerequisite must still be offered — installing it is the upgrade")
	}
}

// A machine with colima installed and a stale second candidate must not be
// nagged: satisfied beats outdated whatever order the candidates are in.
// @scenario "Either container runtime satisfies the group"
func TestSatisfiedBeatsOutdatedAcrossCandidates(t *testing.T) {
	report := PlanPrereqs(map[string]Found{
		"colima":         {Present: true, Outdated: true},
		"docker-desktop": {Present: true},
	}, nil, "darwin")
	if st := statusOf(t, report, "runtime"); st.State != PrereqSatisfied {
		t.Errorf("runtime state = %v, want satisfied — one current candidate is enough", st.State)
	}
}

// @scenario "Declining with never is persisted"
func TestSkippedIsReportedInsteadOfOffered(t *testing.T) {
	report := PlanPrereqs(presentExcept("clickhouse-client"), map[string]bool{"clickhouse-client": true}, "darwin")
	st := statusOf(t, report, "clickhouse-client")
	if st.State != PrereqSkipped {
		t.Errorf("state = %v, want skipped", st.State)
	}
	if st.State.Actionable() {
		t.Error("a skipped prerequisite must not be offered again")
	}
}

// A skip recorded for a REQUIRED prerequisite is not honoured: honouring it
// would drop the entry out of MissingRequired and report a machine that
// cannot run haven as ready.
// @scenario "Declining with never is persisted"
func TestSkippingARequiredPrerequisiteIsNotHonoured(t *testing.T) {
	report := PlanPrereqs(map[string]Found{}, map[string]bool{"portless": true}, "darwin")
	if st := statusOf(t, report, "portless"); st.State != PrereqMissing {
		t.Errorf("portless state = %v, want missing — a required prerequisite cannot be skipped", st.State)
	}
	if !strings.Contains(ReadyLine(report), "portless") {
		t.Errorf("the verdict must still name portless, got %q", ReadyLine(report))
	}
}

// @scenario "An optional prerequisite that is missing is reported, not demanded"
func TestMacOSOnlyEntriesAreNotApplicableElsewhere(t *testing.T) {
	report := PlanPrereqs(map[string]Found{}, nil, "linux")
	for _, key := range []string{"brew", "postgres", "redis", "runtime", "clickhouse-client"} {
		if st := statusOf(t, report, key); st.State != PrereqNotApplicable {
			t.Errorf("%s on linux = %v, want not-applicable", key, st.State)
		}
	}
	// The cross-platform ones still report honestly.
	if st := statusOf(t, report, "portless"); st.State != PrereqMissing {
		t.Errorf("portless on linux = %v, want missing", st.State)
	}
}

// @scenario "A prerequisite haven cannot install itself is explained, not attempted"
func TestHomebrewIsTheOnlyManualEntry(t *testing.T) {
	for _, p := range Prereqs {
		if p.Manual() != (p.Key == "brew") {
			t.Errorf("%s manual = %v; only Homebrew installs itself by hand", p.Key, p.Manual())
		}
	}
	brew, _ := LookupPrereq("brew")
	if !strings.Contains(brew.Candidates[0].Manual, "install.sh") {
		t.Errorf("the manual entry must carry the official command, got %q", brew.Candidates[0].Manual)
	}
}

// Every candidate key has to be unique: the probe results are keyed by it, so
// a duplicate would make one prerequisite answer for another.
func TestCandidateKeysAreUnique(t *testing.T) {
	seen := map[string]string{}
	for _, p := range Prereqs {
		for _, c := range p.Candidates {
			if owner, dup := seen[c.Key]; dup {
				t.Errorf("candidate key %q is used by both %s and %s — probes are keyed by it", c.Key, owner, p.Key)
			}
			seen[c.Key] = p.Key
		}
	}
}

// Every entry needs something to probe with, or it would report missing for
// ever and offer an install that changes nothing the next run can see.
func TestEveryCandidateIsProbeable(t *testing.T) {
	for _, p := range Prereqs {
		for _, c := range p.Candidates {
			if len(c.Binaries) == 0 && c.Formula == "" && p.Key != "portless" {
				t.Errorf("%s/%s has no binary and no formula to probe — it can never report installed", p.Key, c.Key)
			}
		}
	}
}

func statusOf(t *testing.T, report []PrereqStatus, key string) PrereqStatus {
	t.Helper()
	for _, st := range report {
		if st.Key == key {
			return st
		}
	}
	t.Fatalf("no %q in the report", key)
	return PrereqStatus{}
}

func countKeys(report []PrereqStatus, key string) int {
	n := 0
	for _, st := range report {
		if st.Key == key {
			n++
		}
	}
	return n
}

// presentExcept builds a probe result where every candidate is present apart
// from the named prerequisites — the "machine that has everything but one"
// the reporting scenarios are about.
func presentExcept(missing ...string) map[string]Found {
	skip := map[string]bool{}
	for _, m := range missing {
		skip[m] = true
	}
	found := map[string]Found{}
	for _, p := range Prereqs {
		if skip[p.Key] {
			continue
		}
		found[p.Candidates[0].Key] = Found{Present: true}
	}
	return found
}
