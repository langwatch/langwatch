package seedgen

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

var anchor = time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)

func mustPlan(t *testing.T, args ...string) *Plan {
	t.Helper()
	flags, err := ParseFlags(args, anchor)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := NewPlan(flags)
	if err != nil {
		t.Fatal(err)
	}
	return plan
}

func streamOf(plan *Plan) []string {
	var lines []string
	for step := range plan.Steps() {
		line, _ := json.Marshal(step)
		lines = append(lines, string(line))
	}
	return lines
}

// @scenario "The same seed gives the same logical content"
func TestSameFlagsGiveTheSameStream(t *testing.T) {
	first, second := mustPlan(t, "--size", "small", "--seed", "7"), mustPlan(t, "--size", "small", "--seed", "7")
	a, b := streamOf(first), streamOf(second)
	if len(a) != len(b) {
		t.Fatalf("stream lengths differ: %d and %d", len(a), len(b))
	}
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("step %d differs:\n%s\n%s", i, a[i], b[i])
		}
	}
	if first.Run != second.Run {
		t.Errorf("run ids differ: %s and %s", first.Run, second.Run)
	}
	if other := mustPlan(t, "--size", "small", "--seed", "8"); other.Digest() == first.Digest() {
		t.Error("a different seed gave the same stream")
	}
	if moved := mustPlan(t, "--size", "small", "--seed", "7", "--anchor", "2026-10-08T12:00:00Z"); moved.Digest() == first.Digest() {
		t.Error("a different anchor gave the same stream")
	}
}

// @scenario "Any telemetry size from one span to two million is accepted"
func TestSpansAreExact(t *testing.T) {
	for _, spans := range []int{1, 2_000_000} {
		counts := mustPlan(t, "--spans", itoa(spans)).Estimate().Counts
		if counts["spans"] != spans || counts["logs"] != spans || counts["metricPoints"] != 2*spans {
			t.Errorf("--spans %d: got spans %d, logs %d, metric points %d", spans, counts["spans"], counts["logs"],
				counts["metricPoints"])
		}
	}
	for _, spans := range []string{"0", "2000001"} {
		if _, err := ParseFlags([]string{"--spans", spans}, anchor); !isFlagError(err, "spans") {
			t.Errorf("--spans %s: want a refusal naming --spans, got %v", spans, err)
		}
	}
}

// @scenario "A dry run prints the plan without writing"
func TestDryRunCountsMatchTheTiers(t *testing.T) {
	for _, tier := range Tiers {
		plan := mustPlan(t, "--size", tier.Name, "--private", "0")
		counts := plan.Estimate().Counts
		want := map[string]int{"orgs": tier.Orgs, KindProjectCreate: tier.Projects, KindUserCreate: tier.Users,
			"traces": tier.Traces, "spans": tier.Spans, "logs": tier.Spans, "metricPoints": 2 * tier.Spans}
		for kind, n := range want {
			if counts[kind] != n {
				t.Errorf("%s: %s = %d, want %d", tier.Name, kind, counts[kind], n)
			}
		}
		withPrivate := mustPlan(t, "--size", tier.Name).Estimate().Counts
		if withPrivate["orgs"] != tier.Orgs+tier.Private {
			t.Errorf("%s: %d orgs with the private default, want %d", tier.Name, withPrivate["orgs"], tier.Orgs+tier.Private)
		}
	}
	var printed bytes.Buffer
	mustPlan(t, "--size", "medium", "--dry-run").Estimate().Print(&printed)
	for _, part := range []string{"counts per kind:", "spans", "postgres", "clickhouse", "expected duration:"} {
		if !strings.Contains(printed.String(), part) {
			t.Errorf("dry run output lacks %q:\n%s", part, printed.String())
		}
	}
}

func TestRetentionComesBeforeEveryCellAndTimesStayInTheWindow(t *testing.T) {
	plan := mustPlan(t, "--size", "tiny", "--days", "30")
	retained := map[string]bool{}
	start := anchor.Add(-30 * 24 * time.Hour)
	for step := range plan.Steps() {
		if step.Action != nil && step.Action.Kind == KindRetentionSet {
			retained[step.Action.Org] = true
		}
		if cell := step.Cell; cell != nil {
			if !retained[cell.Org] {
				t.Fatalf("telemetry for %s before its retention", cell.Org)
			}
			if cell.Start.Before(start) || !cell.Start.Before(anchor) {
				t.Fatalf("cell at %s outside [%s, %s)", cell.Start, start, anchor)
			}
		}
	}
	if RetentionDays("enterprise", 30) != 49 || RetentionDays("startup", 30) != 63 || RetentionDays("startup", 20) != 35 {
		t.Error("retention is not the smallest value ≥ days + 14 the plan accepts")
	}
}

func TestPrivateOrgsAreNeverCreated(t *testing.T) {
	plan := mustPlan(t, "--size", "small", "--private", "1")
	for step := range plan.Steps() {
		if a := step.Action; a != nil && a.Kind == KindOrgCreate && a.Ref == "$org:private-1" {
			t.Fatal("the plan creates a private org; storage-seed writes it with a fixed id")
		}
	}
}

func TestBadFlagsNameTheFlag(t *testing.T) {
	for flag, args := range map[string][]string{
		"size": {"--size", "huge"}, "days": {"--days", "0"}, "persona": {"--persona", "nosuch"},
		"shape": {"--shape", "hybrid"},
	} {
		if _, err := ParseFlags(args, anchor); !isFlagError(err, flag) {
			t.Errorf("%v: want a refusal naming --%s, got %v", args, flag, err)
		}
	}
}

func isFlagError(err error, flag string) bool {
	var refusal *FlagError
	return errors.As(err, &refusal) && refusal.Flag == flag && refusal.Accepts != ""
}

func itoa(n int) string {
	encoded, _ := json.Marshal(n)
	return string(encoded)
}

// @scenario "Seeded users, orgs, projects and memberships go through the module APIs"
func TestAcceptedUsersAreAdmittedByTheOwnerAfterTheOrgExists(t *testing.T) {
	plan := mustPlan(t, "--size", "tiny")
	org := plan.Orgs[0]
	founded, admitted := false, map[string]map[string]string{}
	for step := range plan.Steps() {
		a := step.Action
		if a == nil || (a.Ref != org.Ref && a.Org != org.Ref) {
			continue
		}
		founded = founded || a.Kind == KindOrgCreate
		if a.Kind != KindMemberAdd {
			continue
		}
		var input map[string]string
		if err := json.Unmarshal(a.Input, &input); err != nil || !founded || a.As != org.Users[0].Ref {
			t.Fatalf("member %s: err %v, after the org %v, as %q", a.Key, err, founded, a.As)
		}
		admitted[input["user"]] = input
	}
	for _, user := range org.Users[1:] {
		input, ok := admitted[user.Ref]
		if ok != (user.State == "accepted") {
			t.Fatalf("%s (%s): admitted %v", user.Ref, user.State, ok)
		}
		if ok && (input["teamRole"] != user.Role || input["team"] != org.TeamRef() || input["role"] == "") {
			t.Fatalf("%s: member input %+v", user.Ref, input)
		}
	}
	if _, ok := admitted[org.Users[0].Ref]; ok {
		t.Fatal("the owner is admitted again; founding the org made it a member")
	}
}

// @scenario "The seeded admin is an admin of every org the seed creates"
func TestTheAdminJoinsEveryOrgWithAnAdminGrant(t *testing.T) {
	plan := mustPlan(t, "--size", "tiny", "--admin", "admin@example.test")
	adminCreated, joined := 0, map[string]bool{}
	for step := range plan.Steps() {
		a := step.Action
		switch {
		case a == nil:
		case a.Kind == KindUserCreate && a.Ref == AdminRef:
			adminCreated++
		case a.Kind == KindMemberAdd && strings.Contains(string(a.Input), `"user":"`+AdminRef+`"`):
			if adminCreated != 1 || !strings.Contains(string(a.Input), `"role":"ADMIN"`) ||
				!strings.Contains(string(a.Input), `"teamRole":"ADMIN"`) {
				t.Fatalf("admin member action %s", a.Input)
			}
			joined[a.Org] = true
		}
	}
	for _, org := range plan.Orgs {
		if !joined[org.Ref] {
			t.Errorf("the admin does not join %s", org.Ref)
		}
	}
	if adminCreated != 1 {
		t.Errorf("the admin account is created %d times, want once", adminCreated)
	}
}

// @scenario "haven seed creates the orgs it is asked for"
func TestOrgFlagsReplaceTheTierOrgs(t *testing.T) {
	plan := mustPlan(t, "--size", "tiny", "--private", "0", "--org", "name=acme,users=4",
		"--org", "name=globex,plan=free,users=1,persona=enterprise")
	counts := plan.Estimate().Counts
	if counts["orgs"] != 2 || counts[KindOrgCreate] != 2 || counts[KindUserCreate] != 5 || counts[KindProjectCreate] != 2 {
		t.Fatalf("counts %v: want 2 orgs, 5 users, 2 projects", counts)
	}
	if plan.Orgs[0].Key != "acme" || plan.Orgs[1].Persona != "enterprise" {
		t.Fatalf("orgs %+v %+v", plan.Orgs[0], plan.Orgs[1])
	}
	for _, refused := range []string{"name=Acme", "name=acme,plan=enterprise", "name=acme,users=0", "name=acme,colour=red",
		"name=acme,persona=nosuch", "acme"} {
		if _, err := ParseFlags([]string{"--org", refused}, anchor); !isFlagError(err, "org") {
			t.Errorf("--org %s: want a refusal naming --org, got %v", refused, err)
		}
	}
}

// @scenario "haven seed --into sends telemetry into one existing project"
func TestIntoSendsOnlyTelemetry(t *testing.T) {
	plan := mustPlan(t, "--size", "tiny", "--into", "org_1/project_1", "--admin", "admin@example.test")
	for step := range plan.Steps() {
		if step.Action != nil {
			t.Fatalf("--into emitted %s; it creates nothing", step.Action.Kind)
		}
	}
	if counts := plan.Estimate().Counts; counts["orgs"] != 0 || counts["spans"] != 1_500 {
		t.Fatalf("counts %v: want no orgs and the tier's spans", counts)
	}
	for _, args := range [][]string{{"--into", "org_1"}, {"--into", "o/p", "--org", "name=acme"}} {
		if _, err := ParseFlags(args, anchor); !isFlagError(err, "into") {
			t.Errorf("%v: want a refusal naming --into, got %v", args, err)
		}
	}
}

// @scenario "Old telemetry lands at its own time so retention can be tested"
func TestAgeMovesTheHistoryBack(t *testing.T) {
	plan := mustPlan(t, "--size", "tiny", "--days", "30", "--age", "90d")
	end, start := anchor.Add(-90*24*time.Hour), anchor.Add(-120*24*time.Hour)
	for step := range plan.Steps() {
		if cell := step.Cell; cell != nil && (cell.Start.Before(start) || !cell.Start.Before(end)) {
			t.Fatalf("cell at %s outside [%s, %s)", cell.Start, start, end)
		}
	}
	for _, age := range []string{"-1d", "ninety", "340d"} {
		if _, err := ParseFlags([]string{"--age", age, "--days", "30"}, anchor); !isFlagError(err, "age") {
			t.Errorf("--age %s: want a refusal naming --age, got %v", age, err)
		}
	}
}

// @scenario "Each project gets long conversations whose turns share one conversation id"
func TestConversationsShareOneIDAcrossTheirTurns(t *testing.T) {
	plan := mustPlan(t, "--size", "tiny", "--days", "30", "--conversations", "2", "--turns", "15")
	threads := map[string]int{}
	for step := range plan.Steps() {
		cell := step.Cell
		if cell == nil || cell.Turns == 0 {
			continue
		}
		for chunk, err := range plan.Chunks(step) {
			if err != nil {
				t.Fatal(err)
			}
			threads[cell.Thread] += strings.Count(string(chunk.Input), `"key":"gen_ai.conversation.id","value":{"stringValue":"`+cell.Thread+`"}`)
		}
	}
	if len(threads) != 2*6 {
		t.Fatalf("%d conversations, want 2 for each of the tiny tier's 6 projects", len(threads))
	}
	for thread, turns := range threads {
		if turns != 15 {
			t.Errorf("%s has %d turns carrying its id, want 15", thread, turns)
		}
	}
	if counts := plan.Estimate().Counts; counts["spans"] != 1_500 || counts["conversations"] != 12 {
		t.Errorf("counts %v: the conversations come out of the 1500-span budget", counts)
	}
	if small := mustPlan(t, "--spans", "10"); small.Estimate().Counts["conversations"] != 0 {
		t.Error("a budget too small for the conversations still plans them")
	}
	for flag, args := range map[string][]string{"turns": {"--turns", "-1"}, "conversations": {"--conversations", "-1"}} {
		if _, err := ParseFlags(args, anchor); !isFlagError(err, flag) {
			t.Errorf("%v: want a refusal naming --%s, got %v", args, flag, err)
		}
	}
}
