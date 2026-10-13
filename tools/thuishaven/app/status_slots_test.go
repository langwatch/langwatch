package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

var slotNow = time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)

func typecheckHolder(pid int, worktree string, held time.Duration) domain.SlotClaim {
	return domain.SlotClaim{
		PID: pid, Class: "typecheck", Units: 2, Worktree: "/src/.worktrees/" + worktree,
		Label: "tsc -b", StartedAt: slotNow.Add(-held),
	}
}

// @scenario "Status shows the shared check budget and who holds it"
func TestStatusShowsSlotBudgetAndHolders(t *testing.T) {
	s := buildSlotsStatus(slotsInput{
		Budget: 8, Pressure: domain.Green, Now: slotNow,
		Holders: []domain.SlotClaim{typecheckHolder(4121, "feat-x", 72*time.Second), typecheckHolder(4122, "feat-y", 5*time.Second)},
	})
	out := captureStdout(t, func() { printSlots(s) })
	for _, want := range []string{"4/8 units (green)", "typecheck 4", "pid 4121", "feat-x", "tsc -b", "1m12s", "pid 4122", "5s"} {
		if !strings.Contains(out, want) {
			t.Errorf("status slots block lacks %q:\n%s", want, out)
		}
	}
	if lines := strings.Count(strings.TrimSpace(out), "\n") + 1; lines != 3 {
		t.Errorf("got %d lines, want a summary and one per holder:\n%s", lines, out)
	}
	b, err := json.Marshal(map[string]any{"slots": s})
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Slots struct {
			Used, Budget int
			Pressure     string
			Holders      []struct {
				Class       string
				PID         int
				HeldSeconds int
			}
		}
	}
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if got.Slots.Used != 4 || got.Slots.Budget != 8 || got.Slots.Pressure != "green" || len(got.Slots.Holders) != 2 || got.Slots.Holders[0].HeldSeconds != 72 {
		t.Errorf("slots JSON = %s", b)
	}
}

// @scenario "Status lists waiting runs in queue order"
func TestStatusListsWaitersInQueueOrder(t *testing.T) {
	s := buildSlotsStatus(slotsInput{
		Budget: 8, Pressure: domain.Amber, Now: slotNow,
		Waiters: []domain.SlotClaim{
			{PID: 9, Class: "typecheck", Units: 2, Worktree: "/w/feat-y", StartedAt: slotNow.Add(-5 * time.Second)},
			{PID: 8, Class: "test", Units: 4, Worktree: "/w/issue9", StartedAt: slotNow.Add(-40 * time.Second)},
		},
	})
	out := captureStdout(t, func() { printSlots(s) })
	first, second := strings.Index(out, "waiting #1 test"), strings.Index(out, "waiting #2 typecheck")
	if first < 0 || second < first || !strings.Contains(out, "waited 40s") || !strings.Contains(out, "4u") {
		t.Errorf("waiters not in queue order with class, units and wait:\n%s", out)
	}
}

// @scenario "Status caps the slot lines at ten"
func TestStatusCapsSlotLines(t *testing.T) {
	var holders, waiters []domain.SlotClaim
	for i := range 12 {
		holders = append(holders, domain.SlotClaim{PID: 100 + i, Class: "lint", Units: 1, StartedAt: slotNow})
		waiters = append(waiters, domain.SlotClaim{PID: 200 + i, Class: "lint", Units: 1, StartedAt: slotNow.Add(time.Duration(i) * time.Second)})
	}
	s := buildSlotsStatus(slotsInput{Budget: 12, Now: slotNow, Holders: holders, Waiters: waiters})
	out := captureStdout(t, func() { printSlots(s) })
	if len(s.Holders) != 10 || len(s.Waiters) != 10 || !strings.Contains(out, "+2 more holders") || !strings.Contains(out, "+2 more waiting") {
		t.Errorf("holders %d, waiters %d:\n%s", len(s.Holders), len(s.Waiters), out)
	}
}

// @scenario "Status warns when a launcher uses a fallback lock folder"
func TestStatusWarnsOnFallbackLockFolder(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	dir := filepath.Join(home, ".cache", "langwatch", "tsc-slots")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "slot-1"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	o := statusOrch(&fakeStore{}, &fakeSystem{totalMemory: 64 << 30})
	s := o.collectSlots(nil, nil, slotNow)
	out := captureStdout(t, func() { printSlots(s) })
	if !strings.Contains(out, "warn fallback tsc-slots in use by 1 run") || strings.Contains(out, "vitest-slots") {
		t.Errorf("fallback warning wrong:\n%s", out)
	}
	if !strings.HasPrefix(out, "ok   slots — 0/") {
		t.Errorf("summary line wrong:\n%s", out)
	}
}

// @scenario "Status shows the shared check budget and who holds it"
func TestStatusJSONCarriesSlots(t *testing.T) {
	store := &fakeStore{waiterClaims: []domain.SlotClaim{{PID: 7, Class: "test", Units: 4, StartedAt: time.Now()}}}
	o := statusOrch(store, &fakeSystem{totalMemory: 64 << 30})
	out := captureStdout(t, func() { _ = o.Status(true, "", false) })
	var got struct {
		Slots *struct {
			Budget  int `json:"budget"`
			Waiters []struct {
				Position int    `json:"position"`
				Class    string `json:"class"`
			} `json:"waiters"`
		} `json:"slots"`
	}
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("status --json is not valid JSON: %v\n%s", err, out)
	}
	if got.Slots == nil || got.Slots.Budget <= 0 || len(got.Slots.Waiters) != 1 || got.Slots.Waiters[0].Class != "test" {
		t.Errorf("slots = %+v", got.Slots)
	}
}
