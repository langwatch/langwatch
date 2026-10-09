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

func TestAcceptedUsersAreGrantedTheirRoleByTheOwnerAfterTheTeamExists(t *testing.T) {
	plan := mustPlan(t, "--size", "tiny")
	org := plan.Orgs[0]
	teamCreated, granted := false, map[string]GrantAttachInput{}
	for step := range plan.Steps() {
		a := step.Action
		if a == nil || a.Org != org.Ref {
			continue
		}
		teamCreated = teamCreated || a.Kind == KindTeamCreate
		if a.Kind != KindGrantAttach {
			continue
		}
		var input GrantAttachInput
		if err := json.Unmarshal(a.Input, &input); err != nil || !teamCreated || a.As != org.Users[0].Ref {
			t.Fatalf("grant %s: err %v, after team %v, as %q", a.Key, err, teamCreated, a.As)
		}
		granted[input.Grants[0].Principal["userId"]] = input
	}
	for _, user := range org.Users {
		input, ok := granted[user.Ref]
		if ok != (user.State == "accepted") {
			t.Fatalf("%s (%s): granted %v", user.Ref, user.State, ok)
		}
		if ok && (len(input.Grants) != 2 || input.Grants[0].Role != user.Role || input.Grants[1].ScopeType != "TEAM") {
			t.Fatalf("%s: grants %+v", user.Ref, input.Grants)
		}
	}
}
