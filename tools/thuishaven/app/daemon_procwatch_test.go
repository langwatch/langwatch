package app

import (
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

type fakeProcTel struct {
	samples [][]domain.WatchedProcess
	kills   [][2]string // class, reason
}

func (f *fakeProcTel) RecordSample(procs []domain.WatchedProcess) {
	f.samples = append(f.samples, procs)
}
func (f *fakeProcTel) RecordKill(class, reason string) {
	f.kills = append(f.kills, [2]string{class, reason})
}
func (f *fakeProcTel) Close() {}

func watchOrch(sys *fakeSystem, tel ProcTelemetry) *Orchestrator {
	return &Orchestrator{
		cfg:     Config{Tsgo: domain.DefaultTsgoLimits(18 << 30)},
		sys:     sys,
		procTel: tel,
		store:   &fakeStore{},
		log:     zap.NewNop(),
	}
}

// @scenario "A runaway whole-tree run is stopped at the hard ceiling"
func TestProcessWatchKillsARunawayTsgo(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)

	t.Run("given a tsgo run above the ceiling among ordinary processes", func(t *testing.T) {
		sys := &fakeSystem{now: now, procSamples: []ProcessSample{
			{PID: 10, RSSBytes: 13 << 30, CPUTime: time.Minute, Elapsed: 5 * time.Minute,
				Command: "/x/lib/tsgo --noEmit -p tsconfig.tsgo.tests.json"},
			{PID: 11, RSSBytes: 20 << 30, CPUTime: time.Hour, Elapsed: time.Hour,
				Command: "/opt/homebrew/bin/node server.cjs"},
		}}
		tel := &fakeProcTel{}
		o := watchOrch(sys, tel)

		t.Run("when the daemon takes its sample", func(t *testing.T) {
			o.governProcesses()

			t.Run("the runaway tsgo is killed and nothing else", func(t *testing.T) {
				if len(sys.killed) != 1 || sys.killed[0] != 10 {
					t.Fatalf("killed = %v, want exactly the tsgo run", sys.killed)
				}
			})

			// @scenario "Every watched tool's footprint becomes queryable history"
			t.Run("both watched classes are recorded for the dashboards", func(t *testing.T) {
				if len(tel.samples) != 1 || len(tel.samples[0]) != 2 {
					t.Fatalf("expected one sample of two watched processes, got %+v", tel.samples)
				}
				// The reason is the attribute the governor dashboards slice
				// on, so the exact wording is part of the contract.
				want := [2]string{"tsgo", "run exceeds the per-run memory ceiling"}
				if len(tel.kills) != 1 || tel.kills[0] != want {
					t.Fatalf("expected the kill counted as %v, got %v", want, tel.kills)
				}
			})
		})
	})
}

// TypeScript 7 renamed the native compiler from `tsgo` to `tsc` and
// lib/tsc.js execve()s it, so this — argv[0] and all — is what ps reports for
// an ordinary `pnpm typecheck` today. It went ungoverned and unobserved while
// the governor selected on the old name.
// @scenario "The compiler is governed under both of its names"
func TestProcessWatchGovernsTheCompilerUnderBothNames(t *testing.T) {
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	t.Run("given a runaway typescript@7 run", func(t *testing.T) {
		sys := &fakeSystem{now: now, procSamples: []ProcessSample{
			{PID: 10, RSSBytes: 13 << 30, CPUTime: time.Minute, Elapsed: 5 * time.Minute,
				Command: "/Users/x/repo/node_modules/.pnpm/@typescript+typescript-darwin-arm64@7.0.2/node_modules/@typescript/typescript-darwin-arm64/lib/tsc --noEmit --project ./tsconfig.tsgo.json"},
		}}
		tel := &fakeProcTel{}
		o := watchOrch(sys, tel)

		t.Run("when the daemon takes its sample", func(t *testing.T) {
			o.governProcesses()

			t.Run("it is reclaimed at the per-run ceiling", func(t *testing.T) {
				if len(sys.killed) != 1 || sys.killed[0] != 10 {
					t.Fatalf("killed = %v, want the runaway tsc run", sys.killed)
				}
			})

			t.Run("and it is observed under the compiler class", func(t *testing.T) {
				if len(tel.samples) != 1 || len(tel.samples[0]) != 1 {
					t.Fatalf("expected one sample of one watched process, got %+v", tel.samples)
				}
				got := tel.samples[0][0]
				if got.Class != domain.TypeScriptCompilerClass || got.Role != domain.TsgoRun {
					t.Fatalf("classed %q/%q, want %q/run", got.Class, got.Role, domain.TypeScriptCompilerClass)
				}
				want := [2]string{domain.TypeScriptCompilerClass, "run exceeds the per-run memory ceiling"}
				if len(tel.kills) != 1 || tel.kills[0] != want {
					t.Fatalf("expected the kill counted as %v, got %v", want, tel.kills)
				}
			})
		})
	})

	t.Run("given a tsc run and a tsgo run that only exceed the budget together", func(t *testing.T) {
		// 7 + 7 = 14 GiB against the 12 GiB budget of an 18 GiB machine, with
		// neither over the per-run ceiling: one combined budget over both
		// names, or each name is weighed against the whole machine alone.
		sys := &fakeSystem{now: now, procSamples: []ProcessSample{
			{PID: 20, RSSBytes: 7 << 30, CPUTime: time.Minute, Elapsed: 10 * time.Minute,
				Command: "/x/lib/tsc --noEmit -p tsconfig.tsgo.json"},
			{PID: 21, RSSBytes: 7 << 30, CPUTime: time.Minute, Elapsed: time.Minute,
				Command: "/y/lib/tsgo --noEmit -p tsconfig.tsgo.tests.json"},
		}}
		tel := &fakeProcTel{}
		o := watchOrch(sys, tel)

		t.Run("when the daemon takes its sample", func(t *testing.T) {
			o.governProcesses()

			t.Run("the youngest of the two is reclaimed", func(t *testing.T) {
				if len(sys.killed) != 1 || sys.killed[0] != 21 {
					t.Fatalf("killed = %v, want the youngest compiler run", sys.killed)
				}
			})

			t.Run("and both were recorded under one class", func(t *testing.T) {
				if len(tel.samples) != 1 || len(tel.samples[0]) != 2 {
					t.Fatalf("expected one sample of two watched processes, got %+v", tel.samples)
				}
				for _, p := range tel.samples[0] {
					if p.Class != domain.TypeScriptCompilerClass {
						t.Fatalf("pid %d classed %q, want %q", p.PID, p.Class, domain.TypeScriptCompilerClass)
					}
				}
			})
		})
	})

	t.Run("given an active typescript@7 language server", func(t *testing.T) {
		sys := &fakeSystem{now: now, procSamples: []ProcessSample{
			{PID: 30, RSSBytes: 2 << 30, CPUTime: time.Minute, Elapsed: time.Hour,
				Command: "/x/lib/tsc --lsp --stdio"},
		}}
		o := watchOrch(sys, &fakeProcTel{})

		t.Run("when the daemon takes its sample", func(t *testing.T) {
			o.governProcesses()
			sys.now = now.Add(50 * time.Minute)
			sys.procSamples[0].CPUTime = 2 * time.Minute // the clock moved
			o.governProcesses()

			t.Run("it keeps the protection its role has always had", func(t *testing.T) {
				if len(sys.killed) != 0 {
					t.Fatalf("an active language server must never be evicted, got %v", sys.killed)
				}
			})
		})
	})
}

// @scenario "Coding agents, dev servers and test workers are observed, never touched"
func TestProcessWatchNeverKillsObserveOnlyClasses(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)

	t.Run("given enormous node, claude and vitest processes", func(t *testing.T) {
		sys := &fakeSystem{now: now, procSamples: []ProcessSample{
			{PID: 1, RSSBytes: 30 << 30, CPUTime: time.Hour, Elapsed: time.Hour, Command: "node dist/server.cjs"},
			{PID: 2, RSSBytes: 30 << 30, CPUTime: time.Hour, Elapsed: time.Hour, Command: "claude bg-spare --bg-spare /x.sock"},
			{PID: 3, RSSBytes: 30 << 30, CPUTime: time.Hour, Elapsed: time.Hour, Command: "node /x/vitest/dist/workers.js"},
		}}
		o := watchOrch(sys, &fakeProcTel{})

		t.Run("when the daemon takes its sample", func(t *testing.T) {
			o.governProcesses()

			if len(sys.killed) != 0 {
				t.Fatalf("observe-only classes must never be killed, got %v", sys.killed)
			}
		})
	})
}

// @scenario "An idle language server is evicted after the idle period"
func TestProcessWatchTracksIdleAcrossTicks(t *testing.T) {
	start := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)

	t.Run("given an LSP whose CPU clock stops moving", func(t *testing.T) {
		sys := &fakeSystem{now: start, procSamples: []ProcessSample{
			{PID: 5, RSSBytes: 2 << 30, CPUTime: time.Minute, Elapsed: time.Hour, Command: "/x/lib/tsgo --lsp --stdio"},
		}}
		o := watchOrch(sys, &fakeProcTel{})

		o.governProcesses() // tick 1: first sight, active
		sys.now = start.Add(50 * time.Minute)
		o.governProcesses() // tick 2: same CPU clock — idle for 50m > 45m TTL

		t.Run("it is evicted once idle past the TTL", func(t *testing.T) {
			if len(sys.killed) != 1 || sys.killed[0] != 5 {
				t.Fatalf("killed = %v, want the idle LSP", sys.killed)
			}
		})
	})

	t.Run("given an LSP that keeps working", func(t *testing.T) {
		sys := &fakeSystem{now: start, procSamples: []ProcessSample{
			{PID: 6, RSSBytes: 2 << 30, CPUTime: time.Minute, Elapsed: time.Hour, Command: "/x/lib/tsgo --lsp --stdio"},
		}}
		o := watchOrch(sys, &fakeProcTel{})

		o.governProcesses()
		sys.now = start.Add(50 * time.Minute)
		sys.procSamples[0].CPUTime = 2 * time.Minute // the clock moved
		o.governProcesses()

		if len(sys.killed) != 0 {
			t.Fatalf("an active LSP must never be idle-evicted, got %v", sys.killed)
		}
	})

	t.Run("given the OS reused the pid for a fresh LSP between ticks", func(t *testing.T) {
		sys := &fakeSystem{now: start, procSamples: []ProcessSample{
			{PID: 7, RSSBytes: 2 << 30, CPUTime: time.Hour, Elapsed: 2 * time.Hour, Command: "/x/lib/tsgo --lsp --stdio"},
		}}
		o := watchOrch(sys, &fakeProcTel{})

		o.governProcesses()
		// A new process on the same pid: LOWER CPU clock, short elapsed. If
		// it inherited the old entry's activity time it would be evicted as
		// idle on its first tick.
		sys.now = start.Add(50 * time.Minute)
		sys.procSamples[0] = ProcessSample{
			PID: 7, RSSBytes: 1 << 30, CPUTime: time.Second, Elapsed: time.Minute,
			Command: "/x/lib/tsgo --lsp --stdio",
		}
		o.governProcesses()

		if len(sys.killed) != 0 {
			t.Fatalf("a reused pid must reset idle tracking, got kills %v", sys.killed)
		}
	})
}

// @scenario "The operator can disable the governor"
func TestProcessWatchDisabled(t *testing.T) {
	sys := &fakeSystem{now: time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC), procSamples: []ProcessSample{
		{PID: 8, RSSBytes: 30 << 30, CPUTime: time.Minute, Elapsed: time.Hour,
			Command: "/x/lib/tsgo --noEmit -p tsconfig.tsgo.json"},
	}}
	tel := &fakeProcTel{}
	o := watchOrch(sys, tel)
	o.cfg.Tsgo.RunMaxRSS = 0

	o.governProcesses()

	if len(sys.killed) != 0 || len(tel.samples) != 0 {
		t.Fatalf("a disabled governor must neither sample nor kill, got kills %v samples %d",
			sys.killed, len(tel.samples))
	}
}
