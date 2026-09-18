package domain

import (
	"testing"
	"time"
)

const tsgoGiB = int64(1) << 30

func tsgoAt(pid int, class TsgoClass, rssGiB int64, started time.Time) TsgoProcess {
	return TsgoProcess{PID: pid, Class: class, RSS: rssGiB * tsgoGiB, Started: started}
}

// @scenario "The governor only ever touches tsgo"
func TestIsTsgoCommand(t *testing.T) {
	t.Run("matches the binary path, not the arguments", func(t *testing.T) {
		yes := []string{
			"/x/node_modules/@typescript/native-preview-darwin-arm64/lib/tsgo --lsp --stdio",
			"tsgo --noEmit --project ./tsconfig.tsgo.json",
		}
		no := []string{
			"node dev/scripts/check-queue.mjs ./node_modules/.bin/tsgo.real",
			"grep tsgo server.log",
			"/usr/bin/vim tsgo.go",
			"clickhouse-server --daemon",
		}
		for _, c := range yes {
			if !IsTsgoCommand(c) {
				t.Errorf("expected tsgo: %q", c)
			}
		}
		for _, c := range no {
			if IsTsgoCommand(c) {
				t.Errorf("must never be a candidate: %q", c)
			}
		}
	})
}

func TestClassifyTsgo(t *testing.T) {
	if ClassifyTsgo("/lib/tsgo --lsp --stdio") != TsgoLSP {
		t.Error("an --lsp invocation is a language server")
	}
	if ClassifyTsgo("/lib/tsgo --noEmit -p tsconfig.json") != TsgoRun {
		t.Error("everything else is a run")
	}
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
