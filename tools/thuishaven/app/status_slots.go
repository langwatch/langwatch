package app

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// slotsShown caps the holder and waiter lines in `haven status`; the rest is "+N more".
const slotsShown = 10

// fallbackSlotDirs are the lock folders a launcher uses when it finds no haven.
var fallbackSlotDirs = []string{"tsc-slots", "vitest-slots"}

// slotsStatus is the shared check budget as `haven status` reports it (JSON key `slots`).
type slotsStatus struct {
	Used     int    `json:"used"`
	Budget   int    `json:"budget"`
	Pressure string `json:"pressure"`
	// Capacity says the budget and why: "quiet, load 1.2 on 10 cores: 10 units".
	Capacity    string               `json:"capacity,omitempty"`
	ByClass     map[string]int       `json:"byClass"`
	Holders     []slotHolderStatus   `json:"holders"`
	MoreHolders int                  `json:"moreHolders,omitempty"`
	Waiters     []slotWaiterStatus   `json:"waiters"`
	MoreWaiters int                  `json:"moreWaiters,omitempty"`
	Fallback    []slotFallbackStatus `json:"fallback,omitempty"`
	// RushGate is the programs rush's gate queues; their runs hold no haven slot.
	RushGate []string `json:"rushGate,omitempty"`
}

type slotHolderStatus struct {
	Class       string `json:"class"`
	Units       int    `json:"units"`
	Worktree    string `json:"worktree,omitempty"`
	PID         int    `json:"pid,omitempty"`
	Label       string `json:"label,omitempty"`
	HeldSeconds int    `json:"heldSeconds"`
}

type slotWaiterStatus struct {
	Position      int    `json:"position"`
	Class         string `json:"class"`
	Units         int    `json:"units"`
	Worktree      string `json:"worktree,omitempty"`
	PID           int    `json:"pid"`
	Label         string `json:"label,omitempty"`
	WaitedSeconds int    `json:"waitedSeconds"`
}

type slotFallbackStatus struct {
	Folder string `json:"folder"`
	Runs   int    `json:"runs"`
}

// slotsInput is what the block is built from: holders as the semaphore reads
// them, waiters in any order (StartedAt is when each queued; the block sorts them).
type slotsInput struct {
	Budget   int
	Capacity string
	Pressure domain.Pressure
	Holders  []domain.SlotClaim
	Waiters  []domain.SlotClaim
	Fallback map[string]int
	RushGate []string
	Now      time.Time
}

// unnamedSlotClass names a unit taken by a run that records no claim.
const unnamedSlotClass = "unnamed"

func buildSlotsStatus(in slotsInput) slotsStatus {
	s := slotsStatus{Budget: in.Budget, Capacity: in.Capacity, Pressure: in.Pressure.String(), ByClass: map[string]int{}}
	holders := make([]slotHolderStatus, 0, len(in.Holders))
	for _, h := range in.Holders {
		class := h.Class
		if h.PID <= 0 || class == "" {
			class = unnamedSlotClass
		}
		s.Used += h.Units
		s.ByClass[class] += h.Units
		holders = append(holders, slotHolderStatus{
			Class: class, Units: h.Units, Worktree: filepath.Base(h.Worktree), PID: max(h.PID, 0),
			Label: h.Label, HeldSeconds: seconds(in.Now, h.StartedAt),
		})
	}
	sort.SliceStable(holders, func(a, b int) bool { return holders[a].Class < holders[b].Class })
	s.Holders, s.MoreHolders = capSlots(holders)
	queued := append([]domain.SlotClaim(nil), in.Waiters...)
	sort.SliceStable(queued, func(a, b int) bool { return queued[a].StartedAt.Before(queued[b].StartedAt) })
	waiters := make([]slotWaiterStatus, 0, len(queued))
	for i, w := range queued {
		waiters = append(waiters, slotWaiterStatus{
			Position: i + 1, Class: w.Class, Units: w.Units, Worktree: filepath.Base(w.Worktree), PID: w.PID,
			Label: w.Label, WaitedSeconds: seconds(in.Now, w.StartedAt),
		})
	}
	s.Waiters, s.MoreWaiters = capSlots(waiters)
	s.RushGate = in.RushGate
	for _, folder := range fallbackSlotDirs {
		if n := in.Fallback[folder]; n > 0 {
			s.Fallback = append(s.Fallback, slotFallbackStatus{Folder: folder, Runs: n})
		}
	}
	return s
}

func capSlots[T any](all []T) ([]T, int) {
	if len(all) <= slotsShown {
		return all, 0
	}
	return all[:slotsShown], len(all) - slotsShown
}

func seconds(now, since time.Time) int {
	if since.IsZero() || now.Before(since) {
		return 0
	}
	return int(now.Sub(since).Seconds())
}

// printSlots is the human block: one summary line, one line per holder and waiter.
func printSlots(s slotsStatus) {
	fmt.Printf("%s slots — %d/%d units (%s)%s\n", statusMark(s.Used <= s.Budget), s.Used, s.Budget, s.Pressure, classSummary(s.ByClass))
	if s.Capacity != "" {
		fmt.Printf("       capacity: %s\n", s.Capacity)
	}
	for _, h := range s.Holders {
		fmt.Printf("       %-9s %du  pid %-6d %-20s %-24s %s\n", h.Class, h.Units, h.PID, h.Worktree, h.Label, secondsText(h.HeldSeconds))
	}
	if s.MoreHolders > 0 {
		fmt.Printf("       +%d more holders\n", s.MoreHolders)
	}
	for _, w := range s.Waiters {
		fmt.Printf("       waiting #%d %-9s %du  pid %-6d %-20s waited %s\n", w.Position, w.Class, w.Units, w.PID, w.Worktree, secondsText(w.WaitedSeconds))
	}
	if s.MoreWaiters > 0 {
		fmt.Printf("       +%d more waiting\n", s.MoreWaiters)
	}
	if len(s.RushGate) > 0 {
		fmt.Printf("       queue: rush gate (%s)\n", strings.Join(s.RushGate, ", "))
	}
	for _, f := range s.Fallback {
		fmt.Printf("warn fallback %s in use by %d run(s) (a launcher that found no haven)\n", f.Folder, f.Runs)
	}
}

func classSummary(byClass map[string]int) string {
	classes := make([]string, 0, len(byClass))
	for c := range byClass {
		classes = append(classes, c)
	}
	sort.Strings(classes)
	parts := make([]string, 0, len(classes))
	for _, c := range classes {
		parts = append(parts, fmt.Sprintf("%s %d", c, byClass[c]))
	}
	if len(parts) == 0 {
		return ""
	}
	return "  " + strings.Join(parts, " · ")
}

func secondsText(s int) string { return (time.Duration(s) * time.Second).String() }

// collectSlots gathers the block from the budget, the given claims and the fallback folders.
func (o *Orchestrator) collectSlots(holders, waiters []domain.SlotClaim, now time.Time) slotsStatus {
	capacity, pressure := o.slotBudget(now)
	return buildSlotsStatus(slotsInput{
		Budget: capacity.Units, Capacity: capacity.Describe(), Pressure: pressure, Holders: holders, Waiters: waiters, Fallback: fallbackSlotRuns(),
		RushGate: rushGatePrograms(), Now: now,
	})
}

// slotBudget is the capacity and level `haven machine slot run` would resolve now:
// the daemon's published level when fresh, else measured (cmd/slot.go resolveSlotPressure).
func (o *Orchestrator) slotBudget(now time.Time) (domain.Capacity, domain.Pressure) {
	rec, ok := o.store.ReadPressure()
	mem := o.sys.MemStat()
	level := domain.ClassifyPressure(mem)
	if ok && rec.Version == domain.PressureRecordVersion && now.Sub(rec.WrittenAt) <= domain.PressureStaleAfter {
		level = domain.ReadPressure(rec, ok, now)
	}
	pressure := domain.ResolveCheckPressure(o.cfg.CheckPressure, level, o.cfg.CheckEnv.CI)
	return o.capacityAt(pressure, mem), pressure
}

// fallbackSlotRuns counts the entries in each fallback lock folder under ~/.cache/langwatch.
func fallbackSlotRuns() map[string]int {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	out := map[string]int{}
	for _, folder := range fallbackSlotDirs {
		entries, err := os.ReadDir(filepath.Join(home, ".cache", "langwatch", folder))
		if err == nil {
			out[folder] = len(entries)
		}
	}
	return out
}
