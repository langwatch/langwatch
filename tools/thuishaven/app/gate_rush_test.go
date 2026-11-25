package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// init points every test in this package at a rush home with no shims, so a
// developer's own rush gate never changes what another test sees.
func init() {
	_ = os.Setenv("RUSH_HOME", filepath.Join(os.TempDir(), "haven-test-no-rush"))
}

// fakeRush makes a rush home whose gate holds shims for programs, and a
// runnable rush when runnable is set.
func fakeRush(t *testing.T, runnable bool, programs ...string) {
	t.Helper()
	home := t.TempDir()
	bin := filepath.Join(home, "gate", "bin")
	if err := os.MkdirAll(bin, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, p := range programs {
		if err := os.WriteFile(filepath.Join(bin, p), []byte("#!/bin/sh\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("RUSH_HOME", home)
	rush := filepath.Join(home, "rush")
	if runnable {
		if err := os.WriteFile(rush, []byte("#!/bin/sh\n"), 0o700); err != nil { //nolint:gosec // the fixture needs the exec bit
			t.Fatal(err)
		}
	}
	t.Setenv("RUSH_BIN", rush)
}

func redAndFull() (*fakeStore, *fakeSystem) {
	now := time.Now()
	return &fakeStore{heavyRuns: 999, hasWrittenPressure: true, pressure: domain.PressureRecord{
		Version: domain.PressureRecordVersion, Level: "red", WrittenAt: now,
	}}, &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: now}
}

// @scenario "Haven steps aside for programs rush's gate owns"
func TestGateStandsDownForRushOwnedProgramsEvenAtRed(t *testing.T) {
	fakeRush(t, true, "tsc", "vitest", "oxlint")
	for _, command := range []string{"tsc -b", "pnpm typecheck", "pnpm test:unit run src/x", "vitest run", "oxlint --quiet src"} {
		store, sys := redAndFull()
		if reply := ask(t, gateOrch(store, sys), bashPayload(command)); !isBareDefer(reply) {
			t.Errorf("%q: want a bare answer while rush owns it, got %+v", command, reply)
		}
	}
}

// @scenario "Haven keeps its gate for programs rush's gate does not own"
func TestGateKeepsRefusingWhatRushDoesNotOwn(t *testing.T) {
	t.Run("given shims for tsc and vitest only, other heavy runs are still refused at red", func(t *testing.T) {
		fakeRush(t, true, "tsc", "vitest")
		for _, command := range []string{"pnpm lint", "oxfmt --write f.ts", "tsc -b && oxfmt --check f.ts"} {
			store, sys := redAndFull()
			if reply := ask(t, gateOrch(store, sys), bashPayload(command)); reply.Specific.PermissionDecision != "deny" {
				t.Errorf("%q: want a deny at red, got %+v", command, reply.Specific)
			}
		}
	})
	t.Run("given a shim but no runnable rush, tsc is still refused at red", func(t *testing.T) {
		fakeRush(t, false, "tsc")
		store, sys := redAndFull()
		if reply := ask(t, gateOrch(store, sys), bashPayload("tsc -b")); reply.Specific.PermissionDecision != "deny" {
			t.Errorf("want a deny at red, got %+v", reply.Specific)
		}
	})
}

// @scenario "haven status names rush's gate as the queue for what it owns"
func TestStatusNamesRushGateQueue(t *testing.T) {
	fakeRush(t, true, "vitest", "tsc")
	s := buildSlotsStatus(slotsInput{Budget: 8, Pressure: domain.Green, Now: slotNow, RushGate: rushGatePrograms()})
	out := captureStdout(t, func() { printSlots(s) })
	if !strings.Contains(out, "queue: rush gate (tsc, vitest)") {
		t.Errorf("status slots block lacks the rush gate line:\n%s", out)
	}
	fakeRush(t, true)
	s = buildSlotsStatus(slotsInput{Budget: 8, Pressure: domain.Green, Now: slotNow, RushGate: rushGatePrograms()})
	if out := captureStdout(t, func() { printSlots(s) }); strings.Contains(out, "rush gate") {
		t.Errorf("with rush's gate off the block names it anyway:\n%s", out)
	}
}

// @scenario "haven's own UI rebuild never waits behind agent runs"
func TestStackUIRebuildSkipsTheQueues(t *testing.T) {
	if !strings.Contains(UIBuildShell, "HAVEN_STACK_BUILD=1 "+nxCacheEnv+"pnpm") {
		t.Errorf("the stack UI rebuild does not mark itself for with-build-slot.sh:\n%s", UIBuildShell)
	}
}
