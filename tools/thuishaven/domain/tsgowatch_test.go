package domain

import (
	"testing"
	"time"
)

const tsgoGiB = int64(1) << 30

func tsgoAt(pid int, class TsgoClass, rssGiB int64, started time.Time) TsgoProcess {
	return TsgoProcess{PID: pid, Class: class, RSS: rssGiB * tsgoGiB, Started: started}
}

// @scenario "The governor only ever touches the TypeScript compiler"
// @scenario "The compiler is governed under both of its names"
func TestIsTypeScriptCompilerCommand(t *testing.T) {
	t.Run("matches the binary path, not the arguments", func(t *testing.T) {
		yes := []string{
			// The preview package's name, still live on machines that have it
			// and on a local build of the TypeScript repo.
			"/x/node_modules/@typescript/native-preview-darwin-arm64/lib/tsgo --lsp --stdio",
			"tsgo --noEmit --project ./tsconfig.tsgo.json",
			// typescript@7 publishes the same Go binary as `tsc`, and
			// lib/tsc.js execve()s it, so the live process IS the compiler.
			"/Users/x/repo/node_modules/.pnpm/@typescript+typescript-darwin-arm64@7.0.2/node_modules/@typescript/typescript-darwin-arm64/lib/tsc --noEmit --project ./tsconfig.tsgo.json",
			"./node_modules/.bin/tsc --noEmit -p tsconfig.tsgo.json",
			"tsc --lsp --stdio",
		}
		no := []string{
			"node dev/scripts/check-queue.mjs ./node_modules/.bin/tsgo.real",
			"node dev/scripts/check-queue.mjs ./node_modules/.bin/tsc.real --noEmit",
			"grep tsgo server.log",
			"grep -rn tsc dev/scripts",
			"/usr/bin/vim tsgo.go",
			"/x/bin/tsclint --fix",
			"/x/bin/mytsc --noEmit",
			"/x/node --tsc",
			"clickhouse-server --daemon",
		}
		for _, c := range yes {
			if !IsTypeScriptCompilerCommand(c) {
				t.Errorf("expected the TypeScript compiler: %q", c)
			}
		}
		for _, c := range no {
			if IsTypeScriptCompilerCommand(c) {
				t.Errorf("must never be a candidate: %q", c)
			}
		}
	})
}

func TestClassifyTsgo(t *testing.T) {
	t.Run("given the preview binary name", func(t *testing.T) {
		if ClassifyTsgo("/lib/tsgo --lsp --stdio") != TsgoLSP {
			t.Error("an --lsp invocation is a language server")
		}
		if ClassifyTsgo("/lib/tsgo --noEmit -p tsconfig.json") != TsgoRun {
			t.Error("everything else is a run")
		}
	})

	// The split is arg-based, so the rename cannot have touched it — pinned
	// because an LSP's protection (its own ceiling, its own idle TTL) hangs
	// off the role and not off the binary's name.
	t.Run("given the typescript@7 binary name", func(t *testing.T) {
		if ClassifyTsgo("/lib/tsc --lsp --stdio") != TsgoLSP {
			t.Error("an --lsp invocation is a language server")
		}
		if ClassifyTsgo("/lib/tsc --noEmit -p tsconfig.tsgo.json") != TsgoRun {
			t.Error("everything else is a run")
		}
	})
}

// @scenario "The compiler is governed under both of its names"
func TestClassifyWatchedProcessPutsBothCompilerNamesInOneClass(t *testing.T) {
	t.Run("given the compiler under each of its names", func(t *testing.T) {
		cases := map[string]TsgoClass{
			"/Users/x/repo/node_modules/.pnpm/@typescript+typescript-darwin-arm64@7.0.2/node_modules/@typescript/typescript-darwin-arm64/lib/tsc --noEmit --project ./tsconfig.tsgo.json": TsgoRun,
			"/x/lib/tsgo --noEmit -p tsconfig.tsgo.json": TsgoRun,
			"/x/lib/tsc --lsp --stdio":                   TsgoLSP,
			"/x/lib/tsgo --lsp --stdio":                  TsgoLSP,
		}

		t.Run("each lands in the one class, with its own role", func(t *testing.T) {
			for command, role := range cases {
				w, ok := ClassifyWatchedProcess(command)
				if !ok {
					t.Fatalf("%q must be watched", command)
				}
				// One class, so limits, dashboards and reap events aggregate
				// the one compiler instead of splitting the budget in two.
				if w.Class != TypeScriptCompilerClass {
					t.Errorf("%q classed %q, want %q", command, w.Class, TypeScriptCompilerClass)
				}
				if w.Role != role {
					t.Errorf("%q role %q, want %q", command, w.Role, role)
				}
			}
		})
	})

	t.Run("given a process that only mentions the compiler", func(t *testing.T) {
		t.Run("it is not watched as the compiler", func(t *testing.T) {
			w, ok := ClassifyWatchedProcess("/usr/bin/grep -rn tsc dev/scripts")
			if ok && w.Class == TypeScriptCompilerClass {
				t.Fatalf("an argument mention must never be the compiler, got %+v", w)
			}
		})
	})
}

func TestGovernTsgo(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	limits := TsgoLimits{
		RunMaxRSS:   12 * tsgoGiB,
		LSPMaxRSS:   4 * tsgoGiB,
		LSPIdleTTL:  45 * time.Minute,
		TotalBudget: 12 * tsgoGiB,
	}

	// @scenario "A runaway whole-tree run is stopped at the hard ceiling"
	t.Run("given a run above the per-run ceiling", func(t *testing.T) {
		kills := GovernTsgo([]TsgoProcess{tsgoAt(1, TsgoRun, 13, now)}, limits)
		if len(kills) != 1 || kills[0].PID != 1 {
			t.Fatalf("expected the runaway stopped, got %+v", kills)
		}
	})

	// @scenario "A run under every ceiling is left alone"
	t.Run("given a run within every ceiling and budget", func(t *testing.T) {
		kills := GovernTsgo([]TsgoProcess{tsgoAt(1, TsgoRun, 10, now)}, limits)
		if len(kills) != 0 {
			t.Fatalf("expected nothing stopped, got %+v", kills)
		}
	})

	// @scenario "Over the machine budget, idle language servers go first"
	t.Run("given the budget exceeded with an idle language server present", func(t *testing.T) {
		idleLSP := TsgoProcess{PID: 3, Class: TsgoLSP, RSS: 3 * tsgoGiB, Started: now.Add(-3 * time.Hour), IdleFor: time.Hour}
		procs := []TsgoProcess{
			tsgoAt(1, TsgoRun, 6, now.Add(-10*time.Minute)),
			tsgoAt(2, TsgoRun, 5, now.Add(-2*time.Minute)),
			idleLSP,
		}
		kills := GovernTsgo(procs, limits)

		// 6+5+3 = 14 GiB against a 12 GiB budget: evicting the idle LSP alone
		// brings the total to 11 GiB, so no run needs to die.
		if len(kills) != 1 || kills[0].PID != 3 {
			t.Fatalf("expected only the idle language server reclaimed, got %+v", kills)
		}
	})

	// @scenario "Over the machine budget, the youngest run goes before the oldest"
	t.Run("given the budget exceeded by two runs alone", func(t *testing.T) {
		procs := []TsgoProcess{
			tsgoAt(1, TsgoRun, 8, now.Add(-10*time.Minute)), // the older, further along
			tsgoAt(2, TsgoRun, 7, now.Add(-1*time.Minute)),  // the younger
		}
		kills := GovernTsgo(procs, limits)

		if len(kills) != 1 || kills[0].PID != 2 {
			t.Fatalf("expected the youngest run stopped and the oldest kept, got %+v", kills)
		}
	})

	// @scenario "An idle language server is evicted after the idle period"
	t.Run("given language servers on both sides of the idle period", func(t *testing.T) {
		procs := []TsgoProcess{
			{PID: 1, Class: TsgoLSP, RSS: 2 * tsgoGiB, Started: now.Add(-3 * time.Hour), IdleFor: time.Hour},
			{PID: 2, Class: TsgoLSP, RSS: 2 * tsgoGiB, Started: now.Add(-3 * time.Hour), IdleFor: time.Minute},
		}
		kills := GovernTsgo(procs, limits)

		if len(kills) != 1 || kills[0].PID != 1 {
			t.Fatalf("expected only the idle language server evicted, got %+v", kills)
		}
	})

	// @scenario "An oversized language server is evicted regardless of activity"
	t.Run("given an active language server above its ceiling", func(t *testing.T) {
		procs := []TsgoProcess{{PID: 1, Class: TsgoLSP, RSS: 5 * tsgoGiB, Started: now, IdleFor: 0}}
		kills := GovernTsgo(procs, limits)
		if len(kills) != 1 {
			t.Fatalf("expected the oversized language server evicted, got %+v", kills)
		}
	})

	t.Run("given budget pressure with only active language servers over", func(t *testing.T) {
		// Active LSPs within their own ceiling are never budget-killed: they
		// are somebody's editor session, and the pressure is almost always a
		// run that will finish.
		procs := []TsgoProcess{
			{PID: 1, Class: TsgoLSP, RSS: 3 * tsgoGiB, Started: now, IdleFor: 0},
			{PID: 2, Class: TsgoLSP, RSS: 3 * tsgoGiB, Started: now, IdleFor: 0},
			{PID: 3, Class: TsgoLSP, RSS: 3 * tsgoGiB, Started: now, IdleFor: 0},
			{PID: 4, Class: TsgoLSP, RSS: 3 * tsgoGiB, Started: now, IdleFor: 0},
			{PID: 5, Class: TsgoLSP, RSS: 3 * tsgoGiB, Started: now, IdleFor: 0},
		}
		if kills := GovernTsgo(procs, limits); len(kills) != 0 {
			t.Fatalf("active in-ceiling language servers are never budget-killed, got %+v", kills)
		}
	})

	// One compiler, one budget: the two names have to be weighed together or
	// each half of a machine's compilers is governed against the whole budget.
	// @scenario "The compiler is governed under both of its names"
	t.Run("given a tsc run and a tsgo run that only exceed the budget together", func(t *testing.T) {
		procs := governedSubset(t, []sampled{
			{command: "/x/lib/tsc --noEmit -p tsconfig.tsgo.json", rssGiB: 7, started: now.Add(-10 * time.Minute)},
			{command: "/y/lib/tsgo --noEmit -p tsconfig.tsgo.json", rssGiB: 7, started: now.Add(-1 * time.Minute)},
		})

		// 7 + 7 = 14 GiB against a 12 GiB budget, and neither is over the
		// 12 GiB per-run ceiling on its own: drop either from the sum and
		// nothing would be reclaimed at all.
		kills := GovernTsgo(procs, limits)

		if len(kills) != 1 || kills[0].PID != 2 {
			t.Fatalf("expected the youngest of the two compilers stopped, got %+v", kills)
		}
		if kills[0].Reason != "combined tsgo footprint exceeds the machine budget" {
			t.Fatalf("expected the combined-budget reason, got %q", kills[0].Reason)
		}
	})

	// @scenario "The operator can disable the governor"
	t.Run("given the per-run ceiling is disabled", func(t *testing.T) {
		off := limits
		off.RunMaxRSS = 0
		kills := GovernTsgo([]TsgoProcess{tsgoAt(1, TsgoRun, 20, now)}, off)
		if len(kills) != 0 {
			t.Fatalf("a disabled governor considers nothing, got %+v", kills)
		}
	})
}

// sampled is one live process as ps would report it, for the tests that start
// from a command line rather than from an already-classified process.
type sampled struct {
	command string
	rssGiB  int64
	started time.Time
}

// governedSubset is what the daemon's tick does, in the two lines that matter
// here: classify every sampled process and keep the ones in the compiler
// class. Going through the classifier is the point — it is what decides
// whether a `tsc` process reaches the governor at all.
func governedSubset(t *testing.T, samples []sampled) []TsgoProcess {
	t.Helper()
	var procs []TsgoProcess
	for i, s := range samples {
		w, ok := ClassifyWatchedProcess(s.command)
		if !ok || w.Class != TypeScriptCompilerClass {
			t.Fatalf("%q must reach the governor, got %+v ok=%v", s.command, w, ok)
		}
		procs = append(procs, TsgoProcess{
			PID: i + 1, Class: w.Role, RSS: s.rssGiB * tsgoGiB, Started: s.started,
		})
	}
	return procs
}

func TestParsePSDuration(t *testing.T) {
	cases := map[string]time.Duration{
		"52.46":       52*time.Second + 460*time.Millisecond,
		"4:47.17":     4*time.Minute + 47*time.Second + 170*time.Millisecond,
		"05:38:38":    5*time.Hour + 38*time.Minute + 38*time.Second,
		"01-04:06:44": 28*time.Hour + 6*time.Minute + 44*time.Second,
		"0:53.92":     53*time.Second + 920*time.Millisecond,
	}
	for in, want := range cases {
		got, ok := ParsePSDuration(in)
		if !ok || got != want {
			t.Errorf("ParsePSDuration(%q) = %v/%v, want %v", in, got, ok, want)
		}
	}
	for _, bad := range []string{"", "abc", "1:2:3:4", "-5:00", "1..2"} {
		if _, ok := ParsePSDuration(bad); ok {
			t.Errorf("ParsePSDuration(%q) must refuse to guess", bad)
		}
	}
}

func TestDefaultTsgoLimits(t *testing.T) {
	t.Run("the budget never undercuts the per-run ceiling", func(t *testing.T) {
		small := DefaultTsgoLimits(8 << 30) // 8 GiB machine: two thirds would be ~5.3 GiB
		if small.TotalBudget < small.RunMaxRSS {
			t.Fatalf("budget %d undercuts the run ceiling %d", small.TotalBudget, small.RunMaxRSS)
		}
	})
	t.Run("a bigger machine gets a proportional budget", func(t *testing.T) {
		big := DefaultTsgoLimits(36 << 30)
		if want := int64(36<<30) * 2 / 3; big.TotalBudget != want {
			t.Fatalf("budget = %d, want two thirds of RAM (%d)", big.TotalBudget, want)
		}
	})
}
